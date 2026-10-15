/**
 * Tracks users with an open Meeting Assist panel (SSE) per session.
 * Auto-Assist runs only for active viewers — add-on must be open.
 */

const viewersBySession = new Map<string, Map<string, number>>();

function sessionMap(sessionId: string): Map<string, number> {
  const key = sessionId.trim();
  let map = viewersBySession.get(key);
  if (!map) {
    map = new Map();
    viewersBySession.set(key, map);
  }
  return map;
}

/** Register a connected panel viewer; returns unsubscribe. Ref-counted per user. */
export function registerMeetingAssistViewer(
  sessionId: string,
  userId: string,
): () => void {
  const sid = sessionId.trim();
  const uid = userId.trim();
  if (!sid || !uid) return () => {};

  const map = sessionMap(sid);
  map.set(uid, (map.get(uid) ?? 0) + 1);

  return () => {
    const m = viewersBySession.get(sid);
    if (!m) return;
    const n = (m.get(uid) ?? 1) - 1;
    if (n <= 0) m.delete(uid);
    else m.set(uid, n);
    if (m.size === 0) viewersBySession.delete(sid);
  };
}

export function getActiveMeetingAssistViewerIds(sessionId: string): string[] {
  const map = viewersBySession.get(sessionId.trim());
  if (!map?.size) return [];
  return [...map.keys()];
}

/** Test helper */
export function clearMeetingAssistActiveViewers(): void {
  viewersBySession.clear();
}
