/**
 * Personalize proposal section bodies for a deal via proposal-content AI agent.
 * Cover visuals (hero) are adapted separately in proposal-visuals.
 */

import {
  callAiServiceAgent,
  AI_SERVICE_DEFAULT_TIMEOUT_MS,
  AI_SERVICE_JOB_TIMEOUT_MS,
} from "@/service/ai/ai-service-client";
import {
  normalizeProposalSections,
  parseProposalSections,
  type ProposalSection,
} from "@/lib/proposal-sections";

export type ProposalPersonalizeContext = {
  customerName: string;
  companyName: string;
  companyDomain?: string | null;
  companyIndustry?: string | null;
  companyEmployeeCount?: number | null;
  dealTitle: string;
  dealStage?: string | null;
  dealAmount?: string | null;
  dealNotes?: string | null;
  contactName?: string | null;
  contactEmail?: string | null;
  date: string;
  vendorName: string;
  /** @deprecated Prefer `product.name` */
  productName?: string | null;
  /** Free-text product/topic from coworker (scopes content + cover). */
  productHint?: string | null;
  product?: {
    name: string;
    tagline?: string | null;
    description?: string | null;
    specifications?: string | null;
    sku?: string | null;
    price?: string | null;
    currency?: string | null;
    category?: string | null;
  } | null;
  quoteLines?: Array<{
    name: string;
    quantity: number | null;
    unitPrice: string | null;
    description: string | null;
  }>;
  /** Optional author direction when rewriting a single section */
  authorDirection?: string | null;
};

type AgentResponse = {
  ok?: boolean;
  sections?: unknown;
  warnings?: string[];
  status?: string;
  reason?: string;
};

function mergeByKey(
  skeleton: ProposalSection[],
  generated: ProposalSection[],
): ProposalSection[] {
  const byId = new Map(generated.map((s) => [s.id, s]));
  const byKey = new Map(generated.map((s) => [s.key, s]));
  return skeleton.map((src) => {
    const hit = byId.get(src.id) ?? byKey.get(src.key);
    if (!hit) return src;
    return {
      ...src,
      title: hit.title?.trim() || src.title,
      body: hit.body?.trim() || src.body,
    };
  });
}

function looksLikeTemplatePlaceholder(body: string): boolean {
  const b = body.trim();
  if (!b) return true;
  return (
    /\[Capability \d+\]/.test(b) ||
    /Edit this section/i.test(b) ||
    /Replace with your catalog/i.test(b) ||
    /\[describe\]/i.test(b) ||
    /Summarize commercial terms here/i.test(b)
  );
}

function applyMeetingNotesFallback(
  sections: ProposalSection[],
  context: ProposalPersonalizeContext,
): ProposalSection[] {
  const notes = context.dealNotes?.trim();
  if (!notes) return sections;

  const customer = context.companyName || context.customerName || "the customer";
  const vendor = context.vendorName || "Our team";

  return sections.map((s) => {
    const key = s.key.toLowerCase();
    const body = s.body?.trim() ?? "";

    if (key === "introduction" || /introduction/i.test(s.title ?? "")) {
      if (!body || looksLikeTemplatePlaceholder(body)) {
        return {
          ...s,
          body: [
            `Following our meeting with ${customer}, ${vendor} is pleased to submit this proposal for ${context.dealTitle}.`,
            "",
            notes.slice(0, 4000),
          ].join("\n"),
        };
      }
      const excerpt = notes.slice(0, 120).toLowerCase();
      if (excerpt && !body.toLowerCase().includes(excerpt)) {
        return {
          ...s,
          body: `${body}\n\nMeeting summary:\n${notes.slice(0, 2500)}`,
        };
      }
      return s;
    }

    if (key === "scope" && looksLikeTemplatePlaceholder(body)) {
      return {
        ...s,
        body: body
          .replace("[Capability 1]", "Requirements captured in the meeting")
          .replace("[Capability 2]", "Platform configuration and integrations")
          .replace("[Capability 3]", "Training, UAT, and go-live support"),
      };
    }

    return s;
  });
}

function seedEmptySectionBodies(
  sections: ProposalSection[],
  context: ProposalPersonalizeContext,
): ProposalSection[] {
  const notes = context.dealNotes?.trim();
  if (!notes) return sections;

  return sections.map((s) => {
    if (s.body?.trim()) return s;
    const isIntro =
      s.key === "introduction" || /introduction/i.test(s.title ?? "");
    if (!isIntro) return s;
    const customer = context.companyName || context.customerName || "your organization";
    return {
      ...s,
      body: `This proposal for ${customer} addresses ${context.dealTitle}.\n\n${notes.slice(0, 4000)}`,
    };
  });
}

function finalizeProposalSections(
  sections: ProposalSection[],
  context: ProposalPersonalizeContext,
  aiUsed: boolean,
): ProposalSection[] {
  const normalized = normalizeProposalSections(sections);
  if (!aiUsed) {
    return applyMeetingNotesFallback(
      seedEmptySectionBodies(normalized, context),
      context,
    );
  }
  return applyMeetingNotesFallback(normalized, context);
}

export async function personalizeProposalSections(input: {
  sections: ProposalSection[];
  context: ProposalPersonalizeContext;
  vendorName?: string;
  /** Interactive regenerate uses a shorter timeout; post-meeting jobs use the job default. */
  timeoutMs?: number;
}): Promise<{ sections: ProposalSection[]; warnings: string[] }> {
  const skeleton = normalizeProposalSections(input.sections);
  if (skeleton.length === 0) {
    return { sections: skeleton, warnings: [] };
  }

  const agent = await callAiServiceAgent<AgentResponse>(
    "proposal-content",
    {
      sections: skeleton,
      context: input.context,
      vendorName: input.vendorName || input.context.vendorName,
    },
    {
      timeoutMs: input.timeoutMs ?? AI_SERVICE_JOB_TIMEOUT_MS,
    },
  );

  if (!agent) {
    return {
      sections: finalizeProposalSections(skeleton, input.context, false),
      warnings: [
        "AI service unavailable; filled the draft from your meeting notes and template.",
      ],
    };
  }

  const warnings = [
    ...(Array.isArray(agent.warnings)
      ? agent.warnings.filter((w): w is string => typeof w === "string")
      : []),
  ];

  const parsed = parseProposalSections(agent.sections);
  if (parsed.length === 0) {
    warnings.push("AI returned no sections; used the token-merged template.");
    return {
      sections: finalizeProposalSections(skeleton, input.context, false),
      warnings,
    };
  }

  const merged = normalizeProposalSections(mergeByKey(skeleton, parsed));
  const withFallback = finalizeProposalSections(merged, input.context, true);
  if (agent.status === "failed" || agent.reason) {
    if (!warnings.length) {
      warnings.push(
        "AI personalization was incomplete; review the draft carefully.",
      );
    }
  }

  return { sections: withFallback, warnings };
}
