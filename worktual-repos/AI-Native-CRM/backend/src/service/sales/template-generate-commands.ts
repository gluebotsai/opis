/**
 * AI generate proposal / quote template sections (preview only — save via PATCH).
 */

import { callAiServiceAgent, AI_SERVICE_JOB_TIMEOUT_MS } from "@/service/ai/ai-service-client";
import {
  canEditInvoiceTemplates,
  canManageDocumentTemplates,
} from "@/service/auth/rbac";
import {
  ForbiddenError,
  requireModuleEnabled,
  requireRole,
} from "@/service/auth/require-role";
import {
  defaultDocumentBlueprint,
  parseBlueprintAssetsDetailed,
  parseDocumentBlueprint,
  type BlueprintAsset,
  type DocumentBlueprint,
} from "@/lib/document-blueprint";
import {
  defaultStandardProposalSections,
  parseProposalSections,
  type ProposalSection,
} from "@/lib/proposal-sections";
import {
  defaultStandardQuoteSections,
  parseQuoteDocumentSections,
  type QuoteDocumentSection,
} from "@/lib/quote-document-sections";
import {
  defaultStandardInvoiceSections,
  parseInvoiceDocumentSections,
  type InvoiceDocumentSection,
} from "@/lib/invoice-document-sections";
import {
  applyTemplateEditPatches,
  type TemplateEditPayload,
  type TemplateSectionRow,
} from "@/lib/template-edit-patch";
import { propagateHeaderLogoAcrossPages } from "@/lib/template-logo-patch";
import { updateInvoiceTemplateLogo } from "@/dao/finance/invoice-template-service";
import { updateProposalTemplateLogo } from "@/dao/sales/proposal-template-service";
import { updateQuoteTemplateLogo } from "@/dao/sales/quote-template-service";

/** ~8 MB decoded; base64 is ~4/3 larger (multi-page PDF samples). */
const MAX_SAMPLE_BASE64_CHARS = Math.ceil(8 * 1024 * 1024 * (4 / 3)) + 64;

export type TemplateGenerateInput = {
  brief?: string;
  sampleText?: string;
  sampleFileBase64?: string;
  sampleFilename?: string;
  existingSections?: Array<{
    id?: string;
    key?: string;
    title?: string;
    body?: string;
    sortOrder?: number;
  }>;
  organizationName?: string;
};

function validateSampleFile(
  input: TemplateGenerateInput,
  kind: "proposal" | "quote" | "invoice",
): string | null {
  if (!input.sampleFileBase64) return null;
  if (input.sampleFileBase64.length > MAX_SAMPLE_BASE64_CHARS) {
    return "Sample file must be 8 MB or smaller.";
  }
  const name = (input.sampleFilename ?? "").toLowerCase();
  if (!name.endsWith(".pdf") && !name.endsWith(".docx")) {
    return "Sample file must be a PDF or Word (.docx) document.";
  }
  return null;
}

function commandError(err: unknown, fallback: string) {
  if (err instanceof ForbiddenError) {
    return {
      ok: false as const,
      error: err.message,
      status: 403 as const,
    };
  }
  return {
    ok: false as const,
    error: err instanceof Error ? err.message : fallback,
  };
}

type AgentResponse = {
  ok?: boolean;
  sections?: unknown;
  blueprint?: unknown;
  assets?: unknown;
  warnings?: string[];
  status?: string;
  reason?: string;
};

function normalizeBrief(input: TemplateGenerateInput): {
  brief: string;
  sampleText: string;
} {
  return {
    brief: (input.brief ?? "").trim(),
    sampleText: (input.sampleText ?? "").trim(),
  };
}

type FinalizeOk = {
  ok: true;
  blueprint: DocumentBlueprint;
  assets: BlueprintAsset[];
  warnings: string[];
  agentSections: unknown;
};

type FinalizeErr = {
  ok: false;
  error: string;
  status: 413 | 422 | 503;
};

function finalizeSampleCloneResult(
  agent: AgentResponse | null,
  hasFile: boolean,
  kind: "proposal" | "quote" | "invoice",
  opts?: { allowNonPageClone?: boolean },
): FinalizeOk | FinalizeErr {
  const warnings = [
    ...(Array.isArray(agent?.warnings)
      ? agent!.warnings.filter((w): w is string => typeof w === "string")
      : []),
  ];

  if (!hasFile) {
    const blueprint =
      parseDocumentBlueprint(agent?.blueprint) ??
      defaultDocumentBlueprint(kind);
    const { assets } = parseBlueprintAssetsDetailed(agent?.assets);
    return {
      ok: true,
      blueprint,
      assets,
      warnings,
      agentSections: agent?.sections,
    };
  }

  if (!agent) {
    return {
      ok: false,
      error:
        "Template clone service is unavailable. Try again in a moment — we will not substitute a different layout.",
      status: 503,
    };
  }

  if (agent.ok === false || agent.status === "failed") {
    return {
      ok: false,
      error:
        "Could not clone this sample. Check that the PDF/DOCX is not password-protected and try again.",
      status: 422,
    };
  }

  const parsed = parseBlueprintAssetsDetailed(agent.assets);
  if (parsed.dropped.length > 0) {
    const tooMany = parsed.truncatedByCount;
    return {
      ok: false,
      error: tooMany
        ? `This sample has too many embedded images to store (${parsed.dropped
            .slice(0, 6)
            .join(", ")}${parsed.dropped.length > 6 ? "…" : ""}). Try a shorter PDF or fewer pages.`
        : `Some sample images were too large to store (${parsed.dropped
            .slice(0, 6)
            .join(", ")}${parsed.dropped.length > 6 ? "…" : ""}). Try again — we now compress images automatically; if it persists, use a smaller file.`,
      status: 413,
    };
  }

  const blueprint = parseDocumentBlueprint(agent.blueprint);
  const allowNonPageClone = opts?.allowNonPageClone === true;
  if (
    !blueprint ||
    (!allowNonPageClone && blueprint.mode !== "page-clone")
  ) {
    return {
      ok: false,
      error:
        "Clone did not produce an exact page layout. Please retry — we will not use a redesigned template.",
      status: 422,
    };
  }

  if (allowNonPageClone && blueprint.mode !== "page-clone") {
    return {
      ok: true,
      blueprint,
      assets: parsed.assets,
      warnings,
      agentSections: agent.sections,
    };
  }

  // Pages reproduced from real text/images (page-clone.ts vector path) carry
  // their content directly in blueprint.html, not as a raster "page-*" asset —
  // count the page wrapper divs themselves rather than requiring an asset.
  const pageWrapperCount = (blueprint.html.match(/class="bp-page-clone\b/g) ?? [])
    .length;
  const rasterPageAssetCount = parsed.assets.filter((a) =>
    a.id.toLowerCase().startsWith("page-"),
  ).length;
  const pageCount = Math.max(pageWrapperCount, rasterPageAssetCount);
  if (pageCount === 0) {
    return {
      ok: false,
      error:
        "Could not create an exact visual clone from this PDF/DOCX. Ensure the file opens normally and is not password-protected, then retry.",
      status: 422,
    };
  }

  return {
    ok: true,
    blueprint,
    assets: parsed.assets,
    warnings,
    agentSections: agent.sections,
  };
}

export async function generateProposalTemplateCommand(
  input: TemplateGenerateInput,
) {
  try {
    await requireRole(
      canManageDocumentTemplates,
      "You cannot generate proposal templates.",
    );
    const fileErr = validateSampleFile(input, "proposal");
    if (fileErr) {
      return { ok: false as const, error: fileErr, status: 400 as const };
    }
    const { brief, sampleText } = normalizeBrief(input);
    const hasFile = Boolean(input.sampleFileBase64);
    if (brief.length < 8 && sampleText.length < 40 && !hasFile) {
      return {
        ok: false as const,
        error: "Provide a short brief or upload a PDF/DOCX sample.",
        status: 400 as const,
      };
    }

    const agent = await callAiServiceAgent<AgentResponse>(
      "document-template",
      {
        kind: "proposal",
        brief,
        sampleText,
        organizationName: input.organizationName ?? "",
        existingSections: input.existingSections ?? [],
        sampleFileBase64: input.sampleFileBase64 ?? null,
        sampleFilename: input.sampleFilename ?? null,
      },
      { timeoutMs: AI_SERVICE_JOB_TIMEOUT_MS },
    );

    const finalized = finalizeSampleCloneResult(agent, hasFile, "proposal");
    if (!finalized.ok) {
      return {
        ok: false as const,
        error: finalized.error,
        status: finalized.status,
      };
    }

    let sections: ProposalSection[];
    if (finalized.agentSections != null) {
      sections = parseProposalSections(finalized.agentSections);
    } else if (hasFile) {
      sections = defaultStandardProposalSections();
    } else {
      sections = defaultStandardProposalSections();
      finalized.warnings.push(
        "AI service unavailable; showing the standard proposal skeleton.",
      );
    }
    if (sections.length === 0) {
      if (hasFile) {
        sections = defaultStandardProposalSections();
      } else {
        sections = defaultStandardProposalSections();
        finalized.warnings.push(
          "No usable sections returned; using standard skeleton.",
        );
      }
    }

    return {
      ok: true as const,
      kind: "proposal" as const,
      sections,
      blueprint: finalized.blueprint,
      assets: finalized.assets,
      warnings: finalized.warnings,
    };
  } catch (err) {
    return commandError(err, "Failed to generate proposal template.");
  }
}

export async function generateQuoteTemplateCommand(
  input: TemplateGenerateInput,
) {
  try {
    const { canUploadCommercialDocumentTemplates } = await import(
      "@/service/auth/rbac"
    );
    await requireRole(
      canUploadCommercialDocumentTemplates,
      "Only admins can upload quote templates.",
    );
    await requireModuleEnabled(
      "sales",
      "You cannot generate quote templates.",
    );
    const fileErr = validateSampleFile(input, "quote");
    if (fileErr) {
      return { ok: false as const, error: fileErr, status: 400 as const };
    }
    const { brief, sampleText } = normalizeBrief(input);
    const hasFile = Boolean(input.sampleFileBase64);
    if (brief.length < 8 && sampleText.length < 40 && !hasFile) {
      return {
        ok: false as const,
        error: "Provide a short brief or upload a PDF/DOCX sample.",
        status: 400 as const,
      };
    }

    const agent = await callAiServiceAgent<AgentResponse>(
      "document-template",
      {
        kind: "quote",
        brief,
        sampleText,
        organizationName: input.organizationName ?? "",
        existingSections: input.existingSections ?? [],
        sampleFileBase64: input.sampleFileBase64 ?? null,
        sampleFilename: input.sampleFilename ?? null,
      },
      { timeoutMs: AI_SERVICE_JOB_TIMEOUT_MS },
    );

    const finalized = finalizeSampleCloneResult(agent, hasFile, "quote");
    if (!finalized.ok) {
      return {
        ok: false as const,
        error: finalized.error,
        status: finalized.status,
      };
    }

    let sections: QuoteDocumentSection[];
    if (finalized.agentSections != null) {
      sections = parseQuoteDocumentSections(finalized.agentSections);
    } else {
      sections = defaultStandardQuoteSections();
      if (!hasFile) {
        finalized.warnings.push(
          "AI service unavailable; showing the standard quotation skeleton.",
        );
      }
    }
    if (sections.length === 0) {
      sections = defaultStandardQuoteSections();
      if (!hasFile) {
        finalized.warnings.push(
          "No usable sections returned; using standard skeleton.",
        );
      }
    }

    return {
      ok: true as const,
      kind: "quote" as const,
      sections,
      blueprint: finalized.blueprint,
      assets: finalized.assets,
      warnings: finalized.warnings,
    };
  } catch (err) {
    return commandError(err, "Failed to generate quote template.");
  }
}

export type TemplateChatStep =
  | "idle"
  | "awaiting_name"
  | "awaiting_description"
  | "done";

export type TemplateChatContext = {
  templateId?: string;
  templateName?: string;
  blueprint?: DocumentBlueprint | null;
  assets?: BlueprintAsset[];
  sections?: TemplateSectionRow[];
};

export type TemplateChatInput = {
  message: string;
  currentStep: TemplateChatStep;
  /** What the UI decided this turn — agent phrases the reply; does not invent a new flow. */
  turnHint: string;
  createName?: string;
  templateNames?: string[];
  hasSample?: boolean;
  /** When true, skip structured template edits (create-flow phrasing only). */
  skipEdit?: boolean;
  /** Open template or unsaved draft — enables chat-driven edits. */
  templateContext?: TemplateChatContext;
};

export type TemplateChatEditResult = {
  sections?: TemplateSectionRow[];
  blueprint?: DocumentBlueprint | null;
  assets?: BlueprintAsset[];
  rename?: string;
  makeActive?: boolean;
  applied?: string[];
};

type TemplateChatAgentResponse = {
  ok?: boolean;
  reply?: string;
  nextStep?: TemplateChatStep;
  createName?: string;
  confirmActive?: boolean | null;
  requestLogoUpload?: boolean;
  triggerGenerateStandard?: boolean;
  startCreate?: boolean;
  applyLogoAllPages?: boolean;
  navigateHref?: string;
  sectionUpdates?: TemplateEditPayload["sectionUpdates"];
  textReplacements?: TemplateEditPayload["textReplacements"];
  rename?: string;
  makeActive?: boolean;
  source?: string;
  reason?: string;
};

export async function generateInvoiceTemplateCommand(
  input: TemplateGenerateInput,
) {
  try {
    const { canUploadCommercialDocumentTemplates } = await import(
      "@/service/auth/rbac"
    );
    await requireRole(
      canUploadCommercialDocumentTemplates,
      "Only admins can upload invoice templates.",
    );
    await requireModuleEnabled(
      "finance",
      "You cannot generate invoice templates.",
    );
    const fileErr = validateSampleFile(input, "invoice");
    if (fileErr) {
      return { ok: false as const, error: fileErr, status: 400 as const };
    }
    const { brief, sampleText } = normalizeBrief(input);
    const hasFile = Boolean(input.sampleFileBase64);
    if (brief.length < 8 && sampleText.length < 40 && !hasFile) {
      return {
        ok: false as const,
        error: "Provide a short brief or upload a PDF/DOCX sample.",
        status: 400 as const,
      };
    }

    const agent = await callAiServiceAgent<AgentResponse>(
      "document-template",
      {
        kind: "invoice",
        brief,
        sampleText,
        organizationName: input.organizationName ?? "",
        existingSections: input.existingSections ?? [],
        sampleFileBase64: input.sampleFileBase64 ?? null,
        sampleFilename: input.sampleFilename ?? null,
      },
      { timeoutMs: AI_SERVICE_JOB_TIMEOUT_MS },
    );

    const finalized = finalizeSampleCloneResult(agent, hasFile, "invoice");
    if (!finalized.ok) {
      return {
        ok: false as const,
        error: finalized.error,
        status: finalized.status,
      };
    }

    let sections: InvoiceDocumentSection[];
    if (finalized.agentSections != null) {
      sections = parseInvoiceDocumentSections(finalized.agentSections);
    } else {
      sections = defaultStandardInvoiceSections();
      if (!hasFile) {
        finalized.warnings.push(
          "AI service unavailable; showing the standard invoice skeleton.",
        );
      }
    }
    if (sections.length === 0) {
      sections = defaultStandardInvoiceSections();
      if (!hasFile) {
        finalized.warnings.push(
          "No usable sections returned; using standard skeleton.",
        );
      }
    }

    return {
      ok: true as const,
      kind: "invoice" as const,
      sections,
      blueprint: finalized.blueprint,
      assets: finalized.assets,
      warnings: finalized.warnings,
    };
  } catch (err) {
    return commandError(err, "Failed to generate invoice template.");
  }
}

function offlineChatReply(
  input: TemplateChatInput,
  kind: "proposal" | "quote" | "invoice",
): string {
  const label =
    kind === "quote" ? "quote" : kind === "invoice" ? "invoice" : "proposal";
  switch (input.currentStep) {
    case "awaiting_name":
      return `What should we call this ${label} template?`;
    case "awaiting_description":
      return input.hasSample
        ? "Send when ready — I'll clone your sample exactly."
        : `Upload a sample PDF or Word (.docx), or say “standard”.`;
    case "done":
      return "Should this become the Active template? Reply yes or no.";
    default:
      return `Happy to help with your ${label} templates — what would you like to know?`;
  }
}

function normalizeChatStep(step: string | undefined): TemplateChatStep {
  if (
    step === "awaiting_name" ||
    step === "awaiting_description" ||
    step === "done" ||
    step === "idle"
  ) {
    return step;
  }
  return "idle";
}

async function chatTemplateAssistCommand(
  kind: "proposal" | "quote" | "invoice",
  input: TemplateChatInput,
) {
  try {
    if (kind === "proposal") {
      await requireRole(
        canManageDocumentTemplates,
        "You cannot edit proposal templates.",
      );
    } else if (kind === "quote") {
      await requireRole(
        canManageDocumentTemplates,
        "You cannot edit quote templates.",
      );
      await requireModuleEnabled(
        "sales",
        "You cannot edit quote templates.",
      );
    } else {
      await requireRole(
        canEditInvoiceTemplates,
        "You cannot edit invoice templates.",
      );
      await requireModuleEnabled(
        "finance",
        "You cannot edit invoice templates.",
      );
    }

    const message = (input.message ?? "").trim();
    const step = input.currentStep ?? "idle";
    const createName = (input.createName ?? "").trim();
    const names = (input.templateNames ?? [])
      .map((n) => n.trim())
      .filter(Boolean)
      .slice(0, 40);

    const agent = await callAiServiceAgent<TemplateChatAgentResponse>(
      "document-template-chat",
      {
        kind,
        message,
        currentStep: step,
        turnHint: input.turnHint ?? "",
        createName,
        templateNames: names,
        hasSample: Boolean(input.hasSample),
        templateContext: input.templateContext ?? null,
      },
      { timeoutMs: 30_000 },
    );

    if (!agent) {
      return {
        ok: true as const,
        text: offlineChatReply(input, kind),
        nextStep: step,
        fromAgent: false,
        source: "heuristic" as const,
        reason: "llm_unavailable",
      };
    }

    const ctx = input.templateContext;
    let edits: TemplateChatEditResult | undefined;
    const sectionUpdates = agent.sectionUpdates;
    const textReplacements = agent.textReplacements;
    const hasPatches =
      (Array.isArray(sectionUpdates) && sectionUpdates.length > 0) ||
      (Array.isArray(textReplacements) && textReplacements.length > 0) ||
      agent.rename ||
      agent.makeActive !== undefined;

    if (hasPatches && ctx) {
      const blueprint = parseDocumentBlueprint(ctx.blueprint) ?? ctx.blueprint ?? null;
      const { assets } = parseBlueprintAssetsDetailed(ctx.assets ?? []);
      const sectionRows: TemplateSectionRow[] = (ctx.sections ?? []).map((s) => ({
        id: s.id,
        key: s.key,
        title: s.title,
        body: s.body,
        sortOrder: s.sortOrder,
      }));
      const patched = applyTemplateEditPatches({
        sections: sectionRows,
        blueprint,
        assets,
        edits: {
          sectionUpdates,
          textReplacements,
          rename: agent.rename,
          makeActive: agent.makeActive,
        },
      });
      if (
        patched.applied.length ||
        agent.rename ||
        agent.makeActive !== undefined
      ) {
        edits = {
          sections: patched.sections,
          blueprint: patched.blueprint ?? null,
          assets: patched.assets,
          ...(agent.rename ? { rename: agent.rename } : {}),
          ...(typeof agent.makeActive === "boolean"
            ? { makeActive: agent.makeActive }
            : {}),
          applied: patched.applied,
        };
      }
    }

    if (agent.applyLogoAllPages && ctx?.blueprint) {
      const blueprint =
        parseDocumentBlueprint(ctx.blueprint) ?? ctx.blueprint ?? null;
      if (blueprint) {
        const propagated = propagateHeaderLogoAcrossPages(
          blueprint,
          ctx.assets ?? [],
        );
        if (propagated) {
          const { assets: parsedAssets } = parseBlueprintAssetsDetailed(
            propagated.assets,
          );
          edits = {
            ...(edits ?? {}),
            sections: edits?.sections ?? ctx.sections,
            blueprint: propagated.blueprint,
            assets: parsedAssets,
            applied: [...(edits?.applied ?? []), "logo:all-pages"],
          };
        }
      }
    }

    const reply =
      (agent.reply ?? "").trim() || offlineChatReply(input, kind);

    return {
      ok: true as const,
      text: reply,
      fromAgent: agent.source !== "heuristic",
      nextStep: normalizeChatStep(agent.nextStep ?? step),
      ...(agent.createName?.trim()
        ? { createName: agent.createName.trim() }
        : {}),
      ...(typeof agent.confirmActive === "boolean"
        ? { confirmActive: agent.confirmActive }
        : {}),
      ...(agent.requestLogoUpload ? { requestLogoUpload: true } : {}),
      ...(agent.triggerGenerateStandard
        ? { triggerGenerateStandard: true }
        : {}),
      ...(agent.startCreate ? { startCreate: true } : {}),
      ...(agent.applyLogoAllPages ? { applyLogoAllPages: true } : {}),
      ...(typeof agent.navigateHref === "string" && agent.navigateHref.trim()
        ? { navigateHref: agent.navigateHref.trim() }
        : {}),
      ...(edits ? { edits } : {}),
      ...(agent.source ? { source: agent.source } : {}),
      ...(agent.reason ? { reason: agent.reason } : {}),
    };
  } catch (err) {
    return commandError(err, "Failed to reach the template assistant.");
  }
}

export async function chatProposalTemplateCommand(input: TemplateChatInput) {
  return chatTemplateAssistCommand("proposal", input);
}

export async function chatQuoteTemplateCommand(input: TemplateChatInput) {
  return chatTemplateAssistCommand("quote", input);
}

export async function chatInvoiceTemplateCommand(input: TemplateChatInput) {
  return chatTemplateAssistCommand("invoice", input);
}

const MAX_LOGO_BASE64_CHARS = 3_500_000;

function validateLogoUpload(input: {
  dataBase64?: string;
  mime?: string;
}): { ok: true; mime: string; dataBase64: string } | { ok: false; error: string; status: 400 } {
  const dataBase64 = (input.dataBase64 ?? "").trim();
  const mime = (input.mime ?? "").trim();
  if (!dataBase64) {
    return { ok: false, error: "Choose a logo image to upload.", status: 400 };
  }
  if (!mime.startsWith("image/")) {
    return {
      ok: false,
      error: "Logo must be PNG, JPEG, WebP, or SVG.",
      status: 400,
    };
  }
  if (dataBase64.length > MAX_LOGO_BASE64_CHARS) {
    return {
      ok: false,
      error: "Logo image is too large (max ~2.5 MB).",
      status: 400,
    };
  }
  return { ok: true, mime, dataBase64 };
}

export async function updateDocumentTemplateLogoCommand(
  kind: "proposal" | "quote" | "invoice",
  id: string,
  input: { dataBase64?: string; mime?: string },
) {
  try {
    if (kind === "proposal") {
      await requireRole(
        canManageDocumentTemplates,
        "You cannot edit proposal templates.",
      );
    } else if (kind === "quote") {
      await requireRole(
        canManageDocumentTemplates,
        "You cannot edit quote templates.",
      );
      await requireModuleEnabled("sales", "You cannot edit quote templates.");
    } else {
      await requireRole(
        canEditInvoiceTemplates,
        "You cannot edit invoice templates.",
      );
      await requireModuleEnabled("finance", "You cannot edit invoice templates.");
    }

    const logo = validateLogoUpload(input);
    if (!logo.ok) {
      return { ok: false as const, error: logo.error, status: logo.status };
    }

    const template =
      kind === "proposal"
        ? await updateProposalTemplateLogo(id, logo)
        : kind === "quote"
          ? await updateQuoteTemplateLogo(id, logo)
          : await updateInvoiceTemplateLogo(id, logo);

    return { ok: true as const, id: template.id, template };
  } catch (err) {
    return commandError(err, "Failed to update template logo.");
  }
}
