import type { DbClient } from "../lib/rls.js";
import type { NoAgentBehavior } from "./channel-policies.js";
import type { RoutingFailureReason } from "./routing.js";
import { resolveChannelPolicy } from "./channel-policies.js";
import {
  transitionConversation,
  type ConversationStatus,
} from "./conversation-transitions.js";

export type NoAgentReasonCode =
  | "no_agent"
  | "all_agents_busy"
  | "all_agents_rejected"
  | "routing_exhausted"
  | RoutingFailureReason;

export type NoAgentOutcome = {
  behavior: NoAgentBehavior;
  status: ConversationStatus;
  customerMessage: string;
  reasonCode: NoAgentReasonCode;
};

/** Digital channels resume the bot with a busy message when no agent is available. */
const BOT_RESUME_CHANNELS = new Set(["webchat", "chat", "whatsapp", "instagram", "facebook"]);

export const DEFAULT_BUSY_MESSAGE =
  "All our live agents are currently busy. Please continue chatting with our AI assistant or try again later.";

export const DEFAULT_OUT_OF_HOURS_MESSAGE =
  "We are currently outside business hours. Please try again during our working hours, or continue chatting with our AI assistant.";

export const DEFAULT_HANDOFF_HOLD_MESSAGE =
  "Please hold while we connect you with an agent.";

const DEFAULT_WAITING_MESSAGE =
  "Please hold — we are connecting you with the next available agent.";

const DEFAULT_CLOSE_MESSAGE =
  "No agents are available right now. Please try again later.";

export function isOutOfHoursReason(reasonCode?: NoAgentReasonCode | null): boolean {
  return reasonCode === "outside_business_hours" || reasonCode === "no_shift_coverage";
}

export function formatConnectedToAgentMessage(agentName: string): string {
  const name = agentName.trim() || "our agent";
  return `You are connected to live agent ${name}.`;
}

/** Webchat uses system bubbles; WhatsApp / Instagram / Facebook use normal bot bubbles. */
export function customerNoticeSenderType(channel: string): "system" | "bot" {
  return channel === "webchat" ? "system" : "bot";
}

export async function resolveNoAgentCustomerMessage(
  db: DbClient,
  organizationId: string,
  input: {
    channel: string;
    channelConfigId?: string | null;
    webchatId?: string | null;
    behavior: NoAgentBehavior;
    reasonCode?: NoAgentReasonCode;
  },
): Promise<string> {
  const outOfHours = isOutOfHoursReason(input.reasonCode);

  if (input.channel === "webchat" && input.webchatId) {
    const key = outOfHours ? "outOfHoursMessage" : "queueBusyMessage";
    const rows = await db.$queryRaw<{ message: string | null }[]>`
      SELECT NULLIF(trim(config.personalisation ->> ${key}), '') AS message
      FROM accounts.setup_webchat_configs config
      INNER JOIN accounts.setup_channel_configs channel ON channel.id = config.channel_config_id
      WHERE channel.organization_id = ${organizationId}::bigint
        AND config.webchat_id = ${input.webchatId}
      LIMIT 1
    `;
    if (rows[0]?.message) return rows[0].message;
  }

  if (outOfHours) return DEFAULT_OUT_OF_HOURS_MESSAGE;

  if (input.channelConfigId) {
    const policy = await resolveChannelPolicy(db, organizationId, {
      channel: input.channel as "webchat" | "email" | "whatsapp" | "instagram" | "facebook",
      channelConfigId: input.channelConfigId,
    });
    if (policy.handoffMessage?.trim()) {
      if (input.behavior === "queue_and_notify") {
        return policy.handoffMessage.trim();
      }
    }
  }

  if (input.behavior === "queue_and_notify") return DEFAULT_WAITING_MESSAGE;
  if (input.behavior === "close_with_message") return DEFAULT_CLOSE_MESSAGE;
  return DEFAULT_BUSY_MESSAGE;
}

/**
 * Apply configured no-agent behavior after routing exhaustion.
 * - queue_and_notify: remain queued
 * - bot_continue: return to bot
 * - close_with_message: close conversation
 */
export async function applyNoAgentBehavior(
  db: DbClient,
  organizationId: string,
  conversationId: string,
  input: {
    channel: string;
    channelConfigId?: string | null;
    webchatId?: string | null;
    reasonCode?: NoAgentOutcome["reasonCode"];
    currentStatus?: ConversationStatus;
  },
): Promise<NoAgentOutcome> {
  const reasonCode = input.reasonCode ?? "no_agent";
  let behavior: NoAgentBehavior = BOT_RESUME_CHANNELS.has(input.channel)
    ? "bot_continue"
    : "queue_and_notify";

  if (input.channelConfigId) {
    const policy = await resolveChannelPolicy(db, organizationId, {
      channel: input.channel as "webchat" | "email" | "whatsapp" | "instagram" | "facebook",
      channelConfigId: input.channelConfigId,
    });
    // Only canonical policies are explicitly configured; derived/persisted
    // fallbacks hard-code queue_and_notify which must not override the
    // digital-channel default of busy message + bot resume.
    if (policy.source === "canonical") {
      behavior = policy.noAgentBehavior;
    }
  }

  const customerMessage = await resolveNoAgentCustomerMessage(db, organizationId, {
    channel: input.channel,
    channelConfigId: input.channelConfigId,
    webchatId: input.webchatId,
    behavior,
    reasonCode,
  });

  if (behavior === "bot_continue") {
    await transitionConversation(
      db,
      organizationId,
      conversationId,
      "routing_exhausted_to_bot",
      { reason: reasonCode },
    );
    return { behavior, status: "bot_active", customerMessage, reasonCode };
  }

  if (behavior === "close_with_message") {
    await transitionConversation(
      db,
      organizationId,
      conversationId,
      "routing_exhausted_to_close",
      { reason: reasonCode },
    );
    return { behavior, status: "closed", customerMessage, reasonCode };
  }

  // queue_and_notify — ensure conversation stays/returns to queued
  if (input.currentStatus === "assigned") {
    await db.$executeRaw`
      UPDATE ccass.conversations
      SET
        status = 'queued',
        lifecycle_state = 'waiting',
        bot_active = FALSE,
        nlp_enabled = FALSE,
        assigned_agent_id = NULL,
        assigned_user_id = NULL,
        assigned_at = NULL,
        updated_at = NOW()
      WHERE id = ${conversationId}::bigint
        AND organization_id = ${organizationId}::bigint
    `;
  }

  return { behavior, status: "queued", customerMessage, reasonCode };
}
