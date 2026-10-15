/**
 * Push CRM session replacement to open tabs (force sign-in elsewhere).
 * Each SSE connection is keyed by user id + auth_sessions token.
 */

export type CrmSessionReplacedPayload = {
  userId: string;
  email: string;
  activeToken: string;
};

type Connection = {
  userId: string;
  email: string;
  token: string;
  send: (event: string, data: unknown) => void;
};

const connections = new Set<Connection>();

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function registerCrmSessionListener(input: {
  userId: string;
  email: string;
  token: string;
  send: (event: string, data: unknown) => void;
}): () => void {
  const conn: Connection = {
    userId: input.userId.trim(),
    email: normalizeEmail(input.email),
    token: input.token.trim(),
    send: input.send,
  };
  connections.add(conn);
  return () => {
    connections.delete(conn);
  };
}

/** Notify tabs whose cookie token is no longer the active CRM session. */
export function publishCrmSessionReplaced(
  payload: CrmSessionReplacedPayload,
): void {
  const userId = payload.userId.trim();
  const email = normalizeEmail(payload.email);
  const activeToken = payload.activeToken.trim();
  if (!email || !activeToken) return;

  for (const conn of [...connections]) {
    const sameAccount =
      conn.email === email ||
      (userId && conn.userId === userId);
    if (!sameAccount) continue;
    if (conn.token === activeToken) continue;
    try {
      conn.send("revoked", {
        code: "session_revoked_elsewhere",
        at: Date.now(),
      });
    } catch {
      connections.delete(conn);
    }
  }
}
