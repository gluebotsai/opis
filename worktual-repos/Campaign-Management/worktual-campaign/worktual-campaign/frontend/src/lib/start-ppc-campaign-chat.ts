/**
 * Helpers to start PPC-focused create-campaign chats.
 */

import {
  chatPathForDraft,
  startCreateCampaignChat,
} from "@/lib/start-create-campaign-chat";
import type { PpcNetwork, PpcTemplatePlan } from "@/lib/ppc-templates-store";
import { ppcNetworkLabel } from "@/lib/ppc-templates-store";
import type { PpcAdTemplate } from "@/lib/ppc-templates-store";
import { summarizePpcPlanForChat } from "@/lib/ppc-plan-form-store";

export function startPpcCampaignChat(options: {
  chatBasePath?: string;
  network?: PpcNetwork;
  initialUserMessage?: string;
  fromTemplate?: PpcAdTemplate;
  fromPlan?: { name: string; plan: PpcTemplatePlan };
}): { draftId: string; path: string } {
  const chatBasePath = options.chatBasePath || "/campaigns/create";
  const now = new Date().toISOString();
  const network =
    options.network ||
    options.fromTemplate?.plan.network ||
    options.fromPlan?.plan.network;
  const networkLabel = network ? ppcNetworkLabel(network) : null;

  const assistantIntro = networkLabel
    ? `I'll help you plan a ${networkLabel} PPC ad only — not email/SMS/WhatsApp.\n` +
      (options.fromPlan
        ? "I have your form fields below. Say “create the plan” when you want the PPC plan card, or tell me what to change."
        : `Share the campaign name, goal, and objective` +
          (network === "google"
            ? ", plus search keywords (match type optional: broad, phrase, or exact)"
            : ", plus age/geo targeting (and image vs video if useful)") +
          `. We'll build an ad plan card (not live spend yet).`)
    : "I'll help you plan a PPC ad only — not email/SMS/WhatsApp.\n" +
      "First — is this for Meta (Facebook/Instagram) or Google Ads?\n" +
      "Then share the campaign name, goal, and objective.";

  const messages: Array<{
    id: string;
    role: "user" | "assistant";
    text: string;
    createdAt: string;
  }> = [
    {
      id: crypto.randomUUID(),
      role: "assistant",
      text: assistantIntro,
      createdAt: now,
    },
  ];

  if (options.fromTemplate) {
    const t = options.fromTemplate;
    messages.push({
      id: crypto.randomUUID(),
      role: "assistant",
      text:
        `Using template “${t.name}” as a starting point for ${ppcNetworkLabel(t.network)}.\n` +
        `Tell me what to change (budget, geo, headlines), or say “create the plan” when ready.`,
      createdAt: now,
    });
  }

  if (options.fromPlan) {
    messages.push({
      id: crypto.randomUUID(),
      role: "user",
      text: summarizePpcPlanForChat(options.fromPlan.plan),
      createdAt: now,
    });
  }

  if (options.initialUserMessage?.trim()) {
    messages.push({
      id: crypto.randomUUID(),
      role: "user",
      text: options.initialUserMessage.trim(),
      createdAt: now,
    });
  }

  const draft = startCreateCampaignChat({
    chatBasePath,
    useLibrarySelection: false,
    seed: {
      name: options.fromPlan
        ? options.fromPlan.name
        : options.fromTemplate
          ? `PPC · ${options.fromTemplate.name}`
          : networkLabel
            ? `Untitled ${networkLabel} PPC`
            : "Untitled PPC campaign",
      channels: ["ppc"],
      goal: options.fromTemplate?.description || options.fromPlan?.plan.objective || "",
      status: "drafting",
      dirty: true,
      messages,
    },
  });

  return {
    draftId: draft.id,
    path: chatPathForDraft(draft.id, chatBasePath),
  };
}
