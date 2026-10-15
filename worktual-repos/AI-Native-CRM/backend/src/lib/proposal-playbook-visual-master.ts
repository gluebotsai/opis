/**
 * Build / detect a page-clone visual master for a learned proposal playbook.
 */

import {
  callAiServiceAgent,
  AI_SERVICE_JOB_TIMEOUT_MS,
} from "@/service/ai/ai-service-client";
import {
  parseBlueprintAssetsDetailed,
  parseDocumentBlueprint,
  type BlueprintAsset,
  type DocumentBlueprint,
} from "@/lib/document-blueprint";
import { isPageCloneBlueprint } from "@/service/sales/document-clone-personalize";

export type VisualMaster = {
  blueprint: DocumentBlueprint;
  assets: BlueprintAsset[];
  warnings: string[];
};

export type VisualMasterBuildFailure = {
  reason: string;
  warnings: string[];
  agentStatus?: string;
};

const VISUAL_MASTER_MAX_ATTEMPTS = 3;

export function playbookHasVisualMaster(playbook: {
  blueprint?: unknown;
  assets?: unknown;
}): boolean {
  const bp = parseDocumentBlueprint(playbook.blueprint);
  const { assets } = parseBlueprintAssetsDetailed(playbook.assets);
  return Boolean(bp && isPageCloneBlueprint(bp) && assets.length > 0);
}

/** True when page-* assets carry editable pdf-text (not raster-only JPEG pages). */
export function playbookAssetsHaveVectorText(assets: unknown): boolean {
  const { assets: parsed } = parseBlueprintAssetsDetailed(assets);
  return parsed.some(
    (asset) =>
      /^page-\d+$/i.test(asset.id) &&
      Boolean(asset.pageHtml?.trim()) &&
      /pdf-text/i.test(asset.pageHtml),
  );
}

export function playbookHasRasterOnlyVisualMaster(playbook: {
  blueprint?: unknown;
  assets?: unknown;
}): boolean {
  return (
    playbookHasVisualMaster(playbook) &&
    !playbookAssetsHaveVectorText(playbook.assets)
  );
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type DocumentTemplateAgentResponse = {
  ok?: boolean;
  status?: string;
  reason?: string;
  blueprint?: unknown;
  assets?: unknown;
  warnings?: string[];
};

/** Parse a document-template agent payload into a visual master when possible. */
export function parseVisualMasterFromAgentResponse(
  agent: DocumentTemplateAgentResponse | null,
): { master: VisualMaster } | VisualMasterBuildFailure {
  if (!agent) {
    return {
      reason: "ai_service_unavailable",
      warnings: [],
    };
  }

  const warnings = Array.isArray(agent.warnings)
    ? agent.warnings.filter((w): w is string => typeof w === "string")
    : [];

  const blueprint = parseDocumentBlueprint(agent.blueprint);
  const { assets, dropped } = parseBlueprintAssetsDetailed(agent.assets);

  if (blueprint && isPageCloneBlueprint(blueprint) && assets.length > 0) {
    if (dropped.length) {
      warnings.push(
        `Some page assets were omitted (${dropped.slice(0, 4).join(", ")}).`,
      );
    }
    return {
      master: {
        blueprint,
        assets,
        warnings,
      },
    };
  }

  return {
    reason:
      typeof agent.reason === "string" && agent.reason.trim()
        ? agent.reason.trim()
        : agent.status === "failed"
          ? "clone_failed"
          : "invalid_page_clone",
    warnings,
    agentStatus: agent.status,
  };
}

/**
 * Clone a winning proposal PDF into a reusable page-clone visual master.
 * Does not require RBAC — used by corpus jobs / backfill scripts.
 */
export async function buildVisualMasterFromPdf(input: {
  contentBase64: string;
  filename: string;
  organizationId?: string;
  organizationName?: string;
}): Promise<VisualMaster | null> {
  const result = await buildVisualMasterFromPdfDetailed(input);
  if (!result.ok) {
    console.warn(
      "[visual-master] clone failed",
      input.filename,
      result.failure.reason,
      result.failure.agentStatus ?? "",
      result.failure.warnings.slice(0, 3),
    );
    return null;
  }
  return result.master;
}

export async function buildVisualMasterFromPdfDetailed(input: {
  contentBase64: string;
  filename: string;
  organizationId?: string;
  organizationName?: string;
}): Promise<
  | { ok: true; master: VisualMaster; attempts: number }
  | { ok: false; failure: VisualMasterBuildFailure; attempts: number }
> {
  let lastFailure: VisualMasterBuildFailure = {
    reason: "clone_failed",
    warnings: [],
  };

  for (let attempt = 1; attempt <= VISUAL_MASTER_MAX_ATTEMPTS; attempt += 1) {
    const agent = await callAiServiceAgent<DocumentTemplateAgentResponse>(
      "document-template",
      {
        kind: "proposal",
        brief: "Clone winning proposal visual master for playbook generation.",
        sampleText: "",
        organizationName: input.organizationName ?? "",
        organizationId: input.organizationId,
        existingSections: [],
        sampleFileBase64: input.contentBase64,
        sampleFilename: input.filename,
      },
      { timeoutMs: Math.max(AI_SERVICE_JOB_TIMEOUT_MS, 180_000) },
    );

    const parsed = parseVisualMasterFromAgentResponse(agent);
    if ("master" in parsed) {
      return { ok: true, master: parsed.master, attempts: attempt };
    }
    lastFailure = parsed;

    if (attempt < VISUAL_MASTER_MAX_ATTEMPTS) {
      await sleepMs(1500 * attempt);
    }
  }

  return { ok: false, failure: lastFailure, attempts: VISUAL_MASTER_MAX_ATTEMPTS };
}
