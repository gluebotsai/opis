export type WebchatMessage = {
  from: "user" | "bot";
  text: string;
  at: string;
};

export type WebchatSession = {
  conversationId: string;
  webchatId: string;
  visitorId: string;
  organizationId?: string;
  routingQueueId?: string | null;
  handoffStarted?: boolean;
  lastCustomerMessageId?: string;
  pageUrl?: string;
  consent?: { accepted: boolean };
  prechatAnswers?: Record<string, string>;
  messages: WebchatMessage[];
  createdAt: string;
  startupReady?: Promise<void>;
  startupComplete?: boolean;
  resumedFromDurableStore?: boolean;
  /** First bot line was generated because the configured greeting was empty. */
  pendingOpening?: boolean;
};

function sessionKey(webchatId: string, visitorId: string): string {
  return `${webchatId}:${visitorId}`;
}

export class WebchatSessionStore {
  private sessions = new Map<string, WebchatSession>();

  get(webchatId: string, visitorId: string): WebchatSession | undefined {
    return this.sessions.get(sessionKey(webchatId, visitorId));
  }

  getOrCreate(
    webchatId: string,
    visitorId: string,
    conversationId: string,
    meta?: {
      pageUrl?: string;
      consent?: { accepted: boolean };
      prechatAnswers?: Record<string, string>;
    },
  ): WebchatSession {
    const key = sessionKey(webchatId, visitorId);
    const existing = this.sessions.get(key);
    if (existing) {
      return existing;
    }

    const session: WebchatSession = {
      conversationId,
      webchatId,
      visitorId,
      pageUrl: meta?.pageUrl,
      consent: meta?.consent,
      prechatAnswers: meta?.prechatAnswers,
      messages: [],
      createdAt: new Date().toISOString(),
    };
    this.sessions.set(key, session);
    return session;
  }

  addMessage(webchatId: string, visitorId: string, message: WebchatMessage): void {
    const session = this.sessions.get(sessionKey(webchatId, visitorId));
    if (!session) return;
    session.messages.push(message);
  }

  replaceConversationId(webchatId: string, visitorId: string, conversationId: string): void {
    const session = this.sessions.get(sessionKey(webchatId, visitorId));
    if (!session) return;
    session.conversationId = conversationId;
  }

  markStartupComplete(webchatId: string, visitorId: string): void {
    const session = this.sessions.get(sessionKey(webchatId, visitorId));
    if (!session) return;
    session.startupComplete = true;
  }

  end(webchatId: string, visitorId: string): void {
    this.sessions.delete(sessionKey(webchatId, visitorId));
  }
}
