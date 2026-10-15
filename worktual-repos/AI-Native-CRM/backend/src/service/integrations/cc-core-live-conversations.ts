import { ccCoreApiBaseUrl } from "@/service/integrations/cc-core-voice";

const LIVE_STATUSES = new Set(["bot_active", "queued", "assigned", "active"]);
const LIVE_CHANNELS = new Set([
  "webchat",
  "email",
  "voice",
  "whatsapp",
  "instagram",
  "facebook",
]);
const LIVE_WITH = new Set(["bot", "queue", "agent"]);

export type LiveConversation = {
  conversationId: string;
  channel:
    | "webchat"
    | "email"
    | "voice"
    | "whatsapp"
    | "instagram"
    | "facebook";
  status: "bot_active" | "queued" | "assigned" | "active";
  with: "bot" | "queue" | "agent";
  assignedUserId: string | null;
  startedAt: string;
  updatedAt: string;
};

export type LiveConversationsResult =
  | {
      ok: true;
      contactId: string | null;
      matchedAs: string | null;
      live: boolean;
      channels: string[];
      conversations: LiveConversation[];
    }
  | {
      ok: false;
      error: string;
      status?: number;
    };

function textOrNull(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

function parseConversation(value: unknown): LiveConversation | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const conversationId = textOrNull(row.conversationId);
  const channel = textOrNull(row.channel);
  const status = textOrNull(row.status);
  const owner = textOrNull(row.with);
  const startedAt = textOrNull(row.startedAt);
  const updatedAt = textOrNull(row.updatedAt);
  if (
    !conversationId ||
    !channel ||
    !LIVE_CHANNELS.has(channel) ||
    !status ||
    !LIVE_STATUSES.has(status) ||
    !owner ||
    !LIVE_WITH.has(owner) ||
    !startedAt ||
    !updatedAt
  ) {
    return null;
  }
  return {
    conversationId,
    channel: channel as LiveConversation["channel"],
    status: status as LiveConversation["status"],
    with: owner as LiveConversation["with"],
    assignedUserId: textOrNull(row.assignedUserId),
    startedAt,
    updatedAt,
  };
}

export async function lookupLiveConversations(input: {
  organizationId: string;
  identifier: string;
}): Promise<LiveConversationsResult> {
  const organizationId = input.organizationId.trim();
  const identifier = input.identifier.trim();
  if (!/^\d+$/.test(organizationId) || !identifier) {
    return { ok: false, error: "invalid_live_conversation_lookup" };
  }

  const key = process.env.CC_CORE_INTERNAL_SERVICE_KEY?.trim();
  if (!key) {
    return { ok: false, error: "cc_core_key_not_configured" };
  }

  let response: Response;
  try {
    response = await fetch(
      `${ccCoreApiBaseUrl()}/internal/v1/contacts/live-conversations`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-service-key": key,
        },
        body: JSON.stringify({ organizationId, identifier }),
        signal: AbortSignal.timeout(8_000),
      },
    );
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? `cc_core_live_lookup_failed: ${error.message}`
          : "cc_core_live_lookup_failed",
    };
  }

  const text = await response.text();
  let payload: Record<string, unknown>;
  try {
    payload = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    return {
      ok: false,
      error: "cc_core_live_lookup_invalid_json",
      status: response.status,
    };
  }

  if (!response.ok) {
    const message =
      textOrNull(payload.message) ??
      textOrNull(payload.error) ??
      `cc_core_http_${response.status}`;
    return { ok: false, error: message, status: response.status };
  }

  if (
    typeof payload.live !== "boolean" ||
    !Array.isArray(payload.channels) ||
    !Array.isArray(payload.conversations)
  ) {
    return {
      ok: false,
      error: "cc_core_live_lookup_invalid_response",
      status: response.status,
    };
  }
  const conversations = payload.conversations.map(parseConversation);
  if (
    conversations.some((item) => item == null) ||
    payload.live !== (conversations.length > 0)
  ) {
    return {
      ok: false,
      error: "cc_core_live_lookup_invalid_response",
      status: response.status,
    };
  }

  const channels = payload.channels.map(textOrNull);
  if (channels.some((channel) => !channel || !LIVE_CHANNELS.has(channel))) {
    return {
      ok: false,
      error: "cc_core_live_lookup_invalid_response",
      status: response.status,
    };
  }

  const contactId = textOrNull(payload.contactId);
  const matchedAs = textOrNull(payload.matchedAs);
  if (!contactId || contactId !== identifier || !matchedAs) {
    return {
      ok: false,
      error: "cc_core_live_lookup_identity_not_matched",
      status: response.status,
    };
  }

  return {
    ok: true,
    contactId,
    matchedAs,
    live: payload.live,
    channels: channels as string[],
    conversations: conversations as LiveConversation[],
  };
}
