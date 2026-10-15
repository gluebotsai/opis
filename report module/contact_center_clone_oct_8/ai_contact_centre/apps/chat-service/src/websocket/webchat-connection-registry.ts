import type { WebSocket } from "ws";

export type WebchatConnection = {
  webchatId: string;
  visitorId: string;
  conversationId?: string;
  ws: WebSocket;
};

const UNREGISTER_GRACE_MS = 45_000;

export class WebchatConnectionRegistry {
  private readonly byConversation = new Map<string, WebchatConnection>();
  private readonly bySession = new Map<string, WebchatConnection>();
  private readonly pendingUnregister = new Map<string, NodeJS.Timeout>();

  private sessionKey(webchatId: string, visitorId: string): string {
    return `${webchatId}:${visitorId}`;
  }

  registerPresence(connection: Pick<WebchatConnection, "webchatId" | "visitorId" | "ws">): void {
    const sessionKey = this.sessionKey(connection.webchatId, connection.visitorId);
    const pending = this.pendingUnregister.get(sessionKey);
    if (pending) {
      clearTimeout(pending);
      this.pendingUnregister.delete(sessionKey);
    }

    const previous = this.bySession.get(sessionKey);
    this.bySession.set(sessionKey, {
      webchatId: connection.webchatId,
      visitorId: connection.visitorId,
      conversationId: previous?.conversationId,
      ws: connection.ws,
    });
  }

  register(connection: WebchatConnection): void {
    const sessionKey = this.sessionKey(connection.webchatId, connection.visitorId);
    const pending = this.pendingUnregister.get(sessionKey);
    if (pending) {
      clearTimeout(pending);
      this.pendingUnregister.delete(sessionKey);
    }

    const previous = this.bySession.get(sessionKey);
    if (
      previous?.conversationId &&
      connection.conversationId &&
      previous.conversationId !== connection.conversationId
    ) {
      this.byConversation.delete(previous.conversationId);
    }

    if (connection.conversationId) {
      this.byConversation.set(connection.conversationId, connection);
    }
    this.bySession.set(sessionKey, connection);
  }

  getBySession(webchatId: string, visitorId: string): WebchatConnection | undefined {
    const connection = this.bySession.get(this.sessionKey(webchatId, visitorId));
    if (!connection || connection.ws.readyState !== connection.ws.OPEN) {
      return undefined;
    }
    return connection;
  }

  getByWebchatId(webchatId: string): WebchatConnection | undefined {
    for (const connection of this.bySession.values()) {
      if (connection.webchatId === webchatId && connection.ws.readyState === connection.ws.OPEN) {
        return connection;
      }
    }
    return undefined;
  }

  scheduleUnregister(webchatId: string, visitorId: string, conversationId?: string): void {
    const sessionKey = this.sessionKey(webchatId, visitorId);
    const pending = this.pendingUnregister.get(sessionKey);
    if (pending) {
      clearTimeout(pending);
    }

    const timeout = setTimeout(() => {
      this.pendingUnregister.delete(sessionKey);
      const mapped = this.bySession.get(sessionKey);
      if (mapped && (!conversationId || mapped.conversationId === conversationId)) {
        if (mapped.conversationId) {
          this.byConversation.delete(mapped.conversationId);
        }
        this.bySession.delete(sessionKey);
      }
    }, UNREGISTER_GRACE_MS);

    this.pendingUnregister.set(sessionKey, timeout);
  }

  unregister(webchatId: string, visitorId: string, conversationId?: string): void {
    this.scheduleUnregister(webchatId, visitorId, conversationId);
  }

  getByConversation(conversationId: string): WebchatConnection | undefined {
    const connection = this.byConversation.get(conversationId);
    if (!connection || connection.ws.readyState !== connection.ws.OPEN) {
      return undefined;
    }
    return connection;
  }
}
