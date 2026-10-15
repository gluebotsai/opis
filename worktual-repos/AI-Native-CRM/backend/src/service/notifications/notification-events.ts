/**
 * In-process pub/sub so admin notification SSE clients refresh when a
 * new lead event is fan-out to their user id.
 */

export type NotificationEventPayload = {
  userId: string;
  organizationId?: string;
  notificationId?: string;
  kind?: string;
};

type Listener = (payload: NotificationEventPayload) => void;

const byUser = new Map<string, Set<Listener>>();

export function subscribeUserNotifications(
  userId: string,
  listener: Listener,
): () => void {
  const key = userId.trim();
  let set = byUser.get(key);
  if (!set) {
    set = new Set();
    byUser.set(key, set);
  }
  set.add(listener);
  return () => {
    set!.delete(listener);
    if (set!.size === 0) byUser.delete(key);
  };
}

export function publishUserNotification(
  payload: NotificationEventPayload,
): void {
  const set = byUser.get(payload.userId.trim());
  if (!set?.size) return;
  for (const listener of [...set]) {
    try {
      listener(payload);
    } catch (err) {
      console.error("notification event listener failed", err);
    }
  }
}
