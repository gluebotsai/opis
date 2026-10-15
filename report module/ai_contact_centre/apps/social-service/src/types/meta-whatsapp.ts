export type MetaWebhookVerificationQuery = {
  "hub.mode"?: string;
  "hub.verify_token"?: string;
  "hub.challenge"?: string;
};

export type MetaWebhookPayload = {
  object?: string;
  entry?: MetaWebhookEntry[];
};

export type MetaWebhookEntry = {
  id: string;
  changes: MetaWebhookChange[];
};

export type MetaWebhookChange = {
  field: string;
  value: MetaWebhookValue;
};

export type MetaWebhookValue = {
  messaging_product?: string;
  metadata?: {
    display_phone_number?: string;
    phone_number_id?: string;
  };
  contacts?: Array<{
    profile?: { name?: string };
    wa_id: string;
  }>;
  messages?: MetaInboundMessage[];
  statuses?: MetaMessageStatus[];
};

export type MetaInboundMessage = {
  id: string;
  from: string;
  timestamp: string;
  type: string;
  text?: { body: string };
  image?: MetaMediaMessage;
  audio?: MetaMediaMessage;
  video?: MetaMediaMessage;
  document?: MetaMediaMessage & { filename?: string };
  sticker?: MetaMediaMessage;
  location?: {
    latitude: number;
    longitude: number;
    name?: string;
    address?: string;
  };
  button?: { text: string; payload: string };
  interactive?: {
    type: string;
    button_reply?: { id: string; title: string };
    list_reply?: { id: string; title: string; description?: string };
  };
  context?: {
    from?: string;
    id?: string;
  };
};

export type MetaMediaMessage = {
  id: string;
  mime_type?: string;
  sha256?: string;
  caption?: string;
};

export type MetaMessageStatus = {
  id: string;
  status: "sent" | "delivered" | "read" | "failed";
  timestamp: string;
  recipient_id: string;
  errors?: Array<{ code: number; title: string }>;
};

export type NormalizedWhatsAppInbound = {
  eventId: string;
  tenantId: string;
  channelConfigId: string;
  channelType: "whatsapp";
  externalThreadId: string;
  externalMessageId: string;
  customerRef: string;
  customerName: string | null;
  body: string;
  messageType: string;
  phoneNumberId: string;
  occurredAt: string;
  metadata: Record<string, unknown>;
};

export type MetaTemplateComponent = {
  type: "header" | "body" | "button";
  sub_type?: "quick_reply" | "url";
  index?: string | number;
  parameters?: Array<
    | { type: "text"; text: string }
    | { type: "currency"; currency: { fallback_value: string; code: string; amount_1000: number } }
    | { type: "date_time"; date_time: { fallback_value: string } }
    | { type: "image"; image: { link: string } }
    | { type: "document"; document: { link: string } }
    | { type: "video"; video: { link: string } }
    | { type: "payload"; payload: string }
  >;
};

export type MetaSendTemplateInput = {
  to: string;
  templateName: string;
  languageCode: string;
  components?: MetaTemplateComponent[];
};

export type MetaSendMessageResult = {
  messaging_product: "whatsapp";
  contacts: Array<{ input: string; wa_id: string }>;
  messages: Array<{ id: string }>;
};

export type MetaTemplateCategory = "MARKETING" | "UTILITY" | "AUTHENTICATION";

export type MetaCreateTemplateButton =
  | { type: "QUICK_REPLY"; text: string }
  | { type: "URL"; text: string; url: string }
  | { type: "PHONE_NUMBER"; text: string; phone_number: string };

export type MetaCreateTemplateComponent =
  | { type: "BODY"; text: string }
  | { type: "FOOTER"; text: string }
  | {
      type: "HEADER";
      format?: "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT";
      text?: string;
      example?: { header_handle?: string[]; header_text?: string[] };
    }
  | { type: "BUTTONS"; buttons: MetaCreateTemplateButton[] };

export type MetaSubmitTemplateApprovalInput = {
  name: string;
  language: string;
  category: MetaTemplateCategory;
  allowCategoryChange?: boolean;
  components: MetaCreateTemplateComponent[];
};

export type MetaSubmitTemplateApprovalResult = {
  id: string;
  status: string;
  category: string;
};

export type MetaTemplateApprovalStatus = {
  id: string;
  name: string;
  language: string;
  status: string;
  category: string | null;
  rejectedReason: string | null;
  /** Present when Meta components were requested (`return_template=true`). */
  components?: unknown[] | null;
};

export type MetaListTemplateApprovalStatusResult = {
  data: MetaTemplateApprovalStatus[];
};

export type MetaGetMessageTemplateInput = {
  templateName?: string;
  templateId?: string;
  language?: string;
  status?: string;
  returnTemplate?: boolean;
};

export type MetaListMessageTemplatesInput = {
  templateName?: string;
  language?: string;
  status?: string;
  returnTemplate?: boolean;
};
