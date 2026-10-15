export type MetaMessengerWebhookVerificationQuery = {
  "hub.mode"?: string;
  "hub.verify_token"?: string;
  "hub.challenge"?: string;
};

export type MetaMessengerWebhookPayload = {
  object?: string;
  entry?: MetaMessengerWebhookEntry[];
};

export type MetaMessengerWebhookEntry = {
  id: string;
  time?: number;
  messaging?: MetaMessengerMessagingEvent[];
  standby?: MetaMessengerMessagingEvent[];
};

export type MetaMessengerMessagingEvent = {
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: number;
  message?: {
    mid?: string;
    text?: string;
    is_echo?: boolean;
    quick_reply?: { payload?: string };
    attachments?: Array<{ type?: string; payload?: { url?: string } }>;
  };
  message_edit?: {
    mid?: string;
    text?: string;
    num_edit?: number;
  };
  postback?: {
    mid?: string;
    payload?: string;
    title?: string;
  };
};

export type NormalizedMessengerInbound = {
  eventId: string;
  tenantId: string;
  channelConfigId: string;
  channelType: "facebook" | "instagram";
  externalThreadId: string;
  externalMessageId: string;
  customerRef: string;
  customerName: string | null;
  body: string;
  messageType: string;
  pageId: string;
  igBusinessAccountId: string | null;
  occurredAt: string;
  metadata: Record<string, unknown>;
};

export type MetaMessengerSendResult = {
  recipient_id?: string;
  message_id?: string;
};
