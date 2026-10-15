/**
 * Score a user-built requirement+proposal slot (LLM pair agent).
 * Used by the sync pair-score endpoint before submit; the corpus job persists
 * that score and does not rematch.
 */

import {
  AI_SERVICE_JOB_TIMEOUT_MS,
  callAiServiceAgent,
} from "@/service/ai/ai-service-client";

const SCORE_TIMEOUT_MS = Math.max(AI_SERVICE_JOB_TIMEOUT_MS, 180_000);
export const PAIR_SCORE_TEXT_CHARS = 8_000;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function normalizePairExtractText(text: string): string {
  return String(text || "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function readPairAgentConfidence(
  pairResult: {
    pairs?: Array<{ confidence?: number; gaps?: string[] }>;
    source?: string;
    reason?: string;
  } | null,
): {
  confidence: number;
  gaps: string[];
  source: string;
  reason?: string;
} {
  const first = Array.isArray(pairResult?.pairs) ? pairResult.pairs[0] : null;
  const rec = asRecord(first);
  const confidence = Number(rec.confidence ?? first?.confidence);
  if (!Number.isFinite(confidence)) {
    throw new Error("Pair scoring did not return a confidence value.");
  }
  return {
    confidence: Math.max(0, Math.min(1, confidence)),
    gaps: Array.isArray(first?.gaps) ? first.gaps.map((gap) => String(gap)) : [],
    source: String(pairResult?.source || "ai"),
    reason: pairResult?.reason,
  };
}

export async function ingestCorpusFileText(input: {
  filename: string;
  kind: "requirement" | "proposal";
  contentBase64: string;
  organizationId: string;
}): Promise<{ fullText: string; pageCount: number | null; reason?: string }> {
  const ingest = await callAiServiceAgent<{
    ok?: boolean;
    fullText?: string;
    pageCount?: number;
    reason?: string;
  }>(
    "proposal-corpus-ingest",
    {
      filename: input.filename,
      kind: input.kind,
      contentBase64: input.contentBase64,
      organizationId: input.organizationId,
    },
    { timeoutMs: SCORE_TIMEOUT_MS },
  );
  if (!ingest) {
    throw new Error(
      "Could not read this file. Check that the AI service is running, then retry.",
    );
  }
  return {
    fullText: normalizePairExtractText(String(ingest.fullText || "")),
    pageCount: ingest.pageCount ?? null,
    reason: ingest.reason,
  };
}

export async function scoreExplicitRequirementProposalPair(input: {
  organizationId: string;
  requirement: { filename: string; fullText?: string; contentBase64?: string };
  proposal: { filename: string; fullText?: string; contentBase64?: string };
}): Promise<{
  confidence: number;
  gaps: string[];
  source: string;
  reason?: string;
}> {
  let reqText = normalizePairExtractText(String(input.requirement.fullText || ""));
  let propText = normalizePairExtractText(String(input.proposal.fullText || ""));
  if (!reqText && input.requirement.contentBase64) {
    const ingested = await ingestCorpusFileText({
      filename: input.requirement.filename,
      kind: "requirement",
      contentBase64: input.requirement.contentBase64,
      organizationId: input.organizationId,
    });
    reqText = ingested.fullText;
  }
  if (!propText && input.proposal.contentBase64) {
    const ingested = await ingestCorpusFileText({
      filename: input.proposal.filename,
      kind: "proposal",
      contentBase64: input.proposal.contentBase64,
      organizationId: input.organizationId,
    });
    propText = ingested.fullText;
  }
  if (!reqText || !propText) {
    throw new Error(
      "Could not read text from one or both files. Use a text-based PDF or DOCX, then retry.",
    );
  }

  const pairResult = await callAiServiceAgent<{
    ok?: boolean;
    pairs?: Array<{ confidence?: number; gaps?: string[] }>;
    source?: string;
    reason?: string;
    error?: string;
  }>(
    "proposal-corpus-pair",
    {
      requirements: [
        {
          itemId: "req",
          filename: input.requirement.filename,
          kind: "requirement",
          fullText: reqText.slice(0, PAIR_SCORE_TEXT_CHARS),
        },
      ],
      proposals: [
        {
          itemId: "prop",
          filename: input.proposal.filename,
          kind: "proposal",
          fullText: propText.slice(0, PAIR_SCORE_TEXT_CHARS),
        },
      ],
      organizationId: input.organizationId,
    },
    { timeoutMs: SCORE_TIMEOUT_MS },
  );
  if (!pairResult) {
    throw new Error(
      "AI service is not running on port 8000, so the pair could not be scored.",
    );
  }
  if (pairResult.ok === false) {
    const reason = String(pairResult.reason || pairResult.error || "").trim();
    throw new Error(
      reason
        ? `Pair scoring failed (${reason}).`
        : "Pair scoring did not return an LLM result.",
    );
  }

  return readPairAgentConfidence(pairResult);
}
