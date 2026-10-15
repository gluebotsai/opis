import { useCallback, useEffect, useRef } from "react";
import { fetchNotifications } from "@/services/notifications";
import {
  setIncomingToast,
  setUnreadCount,
  useAppDispatch,
  useAppSelector,
} from "@/store";

/** Keep unread count in Redux; push a toast when unread count increases. */
export function useNotificationsSync() {
  const dispatch = useAppDispatch();
  const userId = useAppSelector((s) => s.auth.user?.id);
  const prevUnreadRef = useRef(0);
  const initializedRef = useRef(false);

  const applyFetch = useCallback(
    (res: Awaited<ReturnType<typeof fetchNotifications>>) => {
      if (!res.ok) return;
      const prev = prevUnreadRef.current;
      if (initializedRef.current && res.unreadCount > prev) {
        const newest = res.items.find((item) => !item.readAt);
        if (newest) {
          dispatch(
            setIncomingToast({
              id: newest.id,
              title: newest.title,
              body: newest.body,
              href: newest.href,
            }),
          );
        }
      }
      initializedRef.current = true;
      prevUnreadRef.current = res.unreadCount;
      dispatch(setUnreadCount(res.unreadCount));
    },
    [dispatch],
  );

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    const syncFromServer = () => {
      void fetchNotifications(30).then((res) => {
        if (!cancelled) applyFetch(res);
      });
    };

    syncFromServer();

    const es = new EventSource("/api/notifications/events", {
      withCredentials: true,
    });
    const onUnread = (ev: MessageEvent) => {
      try {
        const data = JSON.parse(String(ev.data)) as { unreadCount?: number };
        if (typeof data.unreadCount !== "number") return;
        if (
          initializedRef.current &&
          data.unreadCount > prevUnreadRef.current
        ) {
          syncFromServer();
          return;
        }
        prevUnreadRef.current = data.unreadCount;
        dispatch(setUnreadCount(data.unreadCount));
      } catch {
        /* ignore */
      }
    };
    es.addEventListener("unread", onUnread as EventListener);
    es.addEventListener("refresh", syncFromServer as EventListener);
    return () => {
      cancelled = true;
      es.close();
    };
  }, [applyFetch, dispatch, userId]);
}
