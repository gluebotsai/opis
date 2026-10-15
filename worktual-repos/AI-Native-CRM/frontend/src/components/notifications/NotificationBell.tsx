import { Bell, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { Link } from "react-router-dom";
import {
  clearAllNotificationsRequest,
  fetchNotifications,
  markAllNotificationsReadRequest,
  markNotificationReadRequest,
  type NotificationView,
} from "@/services/notifications";
import {
  setIncomingToast,
  setUnreadCount,
  useAppDispatch,
  useAppSelector,
} from "@/store";
import { WORKTUAL_ICON_BUTTON } from "@/lib/worktual-control-tokens";

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const sec = Math.round(ms / 1000);
  if (sec < 45) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
}

export function NotificationBell() {
  const dispatch = useAppDispatch();
  const unreadCount = useAppSelector((s) => s.notifications.unreadCount);
  const incomingToast = useAppSelector((s) => s.notifications.incomingToast);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationView[]>([]);
  const [pending, startTransition] = useTransition();
  const rootRef = useRef<HTMLDivElement>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reload = useCallback(() => {
    startTransition(async () => {
      const res = await fetchNotifications(30);
      if (!res.ok) return;
      setItems(res.items);
      dispatch(setUnreadCount(res.unreadCount));
    });
  }, [dispatch]);

  const dismissToast = useCallback(() => {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }
    dispatch(setIncomingToast(null));
  }, [dispatch]);

  const openPanel = useCallback(() => {
    dismissToast();
    setOpen(true);
  }, [dismissToast]);

  useEffect(() => {
    if (!incomingToast) return;
    reload();
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => {
      dispatch(setIncomingToast(null));
      toastTimerRef.current = null;
    }, 5000);
    return () => {
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
        toastTimerRef.current = null;
      }
    };
  }, [dispatch, incomingToast, reload]);

  useEffect(() => {
    if (!open) return;
    reload();
    const onPointer = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, reload]);

  const onOpenItem = (item: NotificationView) => {
    dismissToast();
    if (!item.readAt) {
      void markNotificationReadRequest(item.id).then(() => {
        setItems((prev) =>
          prev.map((n) =>
            n.id === item.id ? { ...n, readAt: new Date().toISOString() } : n,
          ),
        );
        dispatch(setUnreadCount(Math.max(0, unreadCount - 1)));
      });
    }
    setOpen(false);
  };

  const onMarkAll = () => {
    startTransition(async () => {
      const res = await markAllNotificationsReadRequest();
      if (!res.ok) return;
      setItems((prev) =>
        prev.map((n) => ({
          ...n,
          readAt: n.readAt ?? new Date().toISOString(),
        })),
      );
      dispatch(setUnreadCount(0));
    });
  };

  const onClearAll = () => {
    if (items.length === 0) return;
    startTransition(async () => {
      const res = await clearAllNotificationsRequest();
      if (!res.ok) return;
      setItems([]);
      dispatch(setUnreadCount(0));
    });
  };

  const badge =
    unreadCount > 99 ? "99+" : unreadCount > 0 ? String(unreadCount) : null;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        className={`relative ${WORKTUAL_ICON_BUTTON}`}
        aria-label={
          unreadCount > 0
            ? `Notifications, ${unreadCount} unread`
            : "Notifications"
        }
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => {
          if (open) {
            setOpen(false);
            return;
          }
          openPanel();
        }}
      >
        <Bell className="size-[18px] shrink-0" strokeWidth={2.25} aria-hidden />
        {badge ? (
          <span
            className="pointer-events-none absolute -right-1 -top-1 z-10 inline-flex h-[17px] min-w-[17px] max-w-[2.25rem] items-center justify-center rounded-full border-2 border-surface bg-text-danger px-1 text-[9px] font-semibold leading-none tabular-nums text-white"
            aria-hidden
          >
            {badge}
          </span>
        ) : null}
      </button>

      {incomingToast && !open ? (
        <div
          role="status"
          aria-live="polite"
          className="absolute right-0 top-full z-[60] mt-2 w-[min(calc(100vw-1.5rem),17.5rem)] overflow-hidden rounded-lg border border-border-default bg-surface shadow-lg"
        >
          <div className="flex items-start gap-2 px-3 py-2.5">
            <button
              type="button"
              className="min-w-0 flex-1 text-left hover:opacity-90"
              onClick={openPanel}
            >
              <p className="truncate text-sm font-semibold leading-5 text-text-primary">
                {incomingToast.title}
              </p>
              {incomingToast.body ? (
                <p className="mt-0.5 line-clamp-2 text-xs leading-4 text-text-secondary">
                  {incomingToast.body}
                </p>
              ) : null}
            </button>
            <button
              type="button"
              className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-text-caption hover:bg-state-hover hover:text-text-primary"
              aria-label="Dismiss notification"
              onClick={dismissToast}
            >
              <X className="size-3.5" strokeWidth={1.75} />
            </button>
          </div>
          <div className="flex border-t border-border-default">
            {incomingToast.href ? (
              <Link
                to={incomingToast.href}
                className="flex-1 px-3 py-1.5 text-center text-[11px] font-medium text-brand hover:bg-state-hover"
                onClick={dismissToast}
              >
                Open
              </Link>
            ) : null}
            <button
              type="button"
              className={`px-3 py-1.5 text-[11px] font-medium text-text-secondary hover:bg-state-hover hover:text-text-primary ${
                incomingToast.href ? "flex-1 border-l border-border-default" : "w-full"
              }`}
              onClick={openPanel}
            >
              View all
            </button>
          </div>
        </div>
      ) : null}

      {open ? (
        <div
          role="dialog"
          aria-label="Notifications"
          className="absolute right-0 top-full z-50 mt-2 w-[min(100vw-1.5rem,22rem)] overflow-hidden rounded-xl border border-border-default bg-surface shadow-lg"
        >
          <div className="flex items-center justify-between gap-2 border-b border-border-default px-3 py-2.5">
            <p className="text-sm font-semibold text-text-primary">
              Notifications
            </p>
            <div className="flex shrink-0 items-center gap-2">
              {unreadCount > 0 ? (
                <button
                  type="button"
                  className="text-xs font-medium text-brand hover:underline disabled:opacity-50"
                  onClick={onMarkAll}
                  disabled={pending}
                >
                  Mark all read
                </button>
              ) : null}
              {items.length > 0 ? (
                <button
                  type="button"
                  className="text-xs font-medium text-text-secondary hover:text-text-primary hover:underline disabled:opacity-50"
                  onClick={onClearAll}
                  disabled={pending}
                >
                  Clear
                </button>
              ) : null}
            </div>
          </div>

          <ul className="max-h-[min(70vh,24rem)] overflow-y-auto">
            {items.length === 0 ? (
              <li className="px-3 py-8 text-center text-sm text-text-caption">
                {pending
                  ? "Loading…"
                  : "No notifications yet. You are alerted for records assigned to you. Escalations and overdue items also reach admins."}
              </li>
            ) : (
              items.map((item) => {
                const unread = !item.readAt;
                const inner = (
                  <>
                    <div className="flex items-start justify-between gap-2">
                      <p
                        className={`text-sm leading-5 ${
                          unread
                            ? "font-semibold text-text-primary"
                            : "font-medium text-text-primary"
                        }`}
                      >
                        {item.title}
                      </p>
                      {unread ? (
                        <span
                          className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brand"
                          aria-hidden
                        />
                      ) : null}
                    </div>
                    {item.body ? (
                      <p className="mt-0.5 text-xs leading-4 text-text-secondary">
                        {item.body}
                      </p>
                    ) : null}
                    <p className="mt-1 text-[11px] text-text-caption">
                      {relativeTime(item.createdAt)}
                    </p>
                  </>
                );

                return (
                  <li
                    key={item.id}
                    className={`border-b border-border-default/70 last:border-b-0 ${
                      unread ? "bg-brand/5" : ""
                    }`}
                  >
                    {item.href ? (
                      <Link
                        to={item.href}
                        className="block px-3 py-2.5 transition-colors hover:bg-state-hover"
                        onClick={() => onOpenItem(item)}
                      >
                        {inner}
                        <p className="mt-1 text-[11px] font-medium text-brand">
                          Open →
                        </p>
                      </Link>
                    ) : (
                      <button
                        type="button"
                        className="block w-full px-3 py-2.5 text-left transition-colors hover:bg-state-hover"
                        onClick={() => onOpenItem(item)}
                      >
                        {inner}
                      </button>
                    )}
                  </li>
                );
              })
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
