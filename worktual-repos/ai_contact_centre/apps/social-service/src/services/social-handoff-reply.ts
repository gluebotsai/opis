import type { SocialHandoffResult } from "./cc-core-social-client.js";

export const AGENTS_BUSY_MESSAGE =
  "All our live agents are currently busy. Please continue chatting with our AI assistant or try again later.";

export const HANDOFF_HOLD_MESSAGE =
  "Please hold while we connect you with an agent.";

export function resolveSocialHandoffReply(input: {
  handoff: SocialHandoffResult | null;
  handoffMessage?: string | null;
}): { text: string; routed: boolean } {
  if (input.handoff?.assignment || input.handoff?.queued) {
    return {
      text:
        input.handoff.systemMessage?.body?.trim() ||
        input.handoffMessage?.trim() ||
        HANDOFF_HOLD_MESSAGE,
      routed: true,
    };
  }

  return {
    text: input.handoff?.systemMessage?.body ?? AGENTS_BUSY_MESSAGE,
    routed: false,
  };
}
