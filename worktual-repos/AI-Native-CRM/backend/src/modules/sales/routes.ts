import type { FastifyPluginAsync } from "fastify";
import {
  checkDuplicateDealsCommand,
  createDealActivityCommand,
  createDealCommand,
  deleteDealActivityCommand,
  deleteDealCommand,
  exportDealsCommand,
  getDealCommand,
  getDealFormOptionsCommand,
  listDealHistoryCommand,
  listDealsBoardCommand,
  listDealsCommand,
  updateDealCommand,
  updateDealStageCommand,
} from "@/service/sales/deal-commands";
import { getDealBuyingGroup } from "@/service/companies/buying-group";
import { ForbiddenError } from "@/service/auth/require-role";
import {
  acceptQuoteCommand,
  createQuoteCommand,
  createQuoteTemplateCommand,
  deleteQuoteCommand,
  deleteQuoteTemplateCommand,
  getQuoteCommand,
  getQuoteFormOptionsCommand,
  getQuotePdfCommand,
  getQuoteDocxCommand,
  getQuoteCsvCommand,
  getQuoteTemplateCommand,
  listDealQuotesCommand,
  listQuoteTemplatesCommand,
  listPendingDiscountApprovalsCommand,
  listQuotesCommand,
  markQuoteSentCommand,
  resendQuoteCommand,
  rejectQuoteCommand,
  updateQuoteCommand,
  rewriteQuoteSectionCommand,
  updateQuoteDocumentAssetCommand,
  updateQuoteTemplateCommand,
} from "@/service/sales/quote-commands";
import {
  createProposalCommand,
  createProposalTemplateCommand,
  createProposalVersionCommand,
  deleteProposalCommand,
  deleteProposalTemplateCommand,
  getProposalCommand,
  getProposalPdfCommand,
  getProposalDocxCommand,
  getProposalTemplateCommand,
  listProposalTemplatesCommand,
  listProposalsForDealCommand,
  personalizeProposalCommand,
  rewriteProposalSectionCommand,
  patchProposalSectionCommand,
  patchProposalDocumentTextCommand,
  patchProposalBlueprintHtmlCommand,
  updateProposalDocumentAssetCommand,
  shareProposalCommand,
  sendProposalCommand,
  resendProposalCommand,
  updateProposalCommand,
  updateProposalTemplateCommand,
} from "@/service/sales/proposal-commands";
import { createProposalFromPlaybookCommand } from "@/service/sales/proposal-from-playbook-commands";
import {
  getProposalGenerationRunCommand,
  retryProposalGenerationRunCommand,
} from "@/service/sales/proposal-run-commands";
import {
  chatProposalTemplateCommand,
  chatQuoteTemplateCommand,
  generateProposalTemplateCommand,
  generateQuoteTemplateCommand,
  updateDocumentTemplateLogoCommand,
} from "@/service/sales/template-generate-commands";
import {
  approveProposalCommand,
  approveQuoteCommand,
  rejectQuoteDiscountCommand,
} from "@/service/sales/document-approval";
import { requireSessionOrApiKey, withUser } from "../../middlewares/auth.js";
import { sendSuccess, sendError, sendResult } from "../../helpers/response.js";


export const salesRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: { search?: string } }>(
    "/deals/board",
    async (request, reply) => {
      const userId = await requireSessionOrApiKey(request, reply, "deals");
      if (!userId) return;
      return withUser(userId, async () => {
        const result = await listDealsBoardCommand(request.query.search);
        return sendSuccess(reply, result);
      });
    },
  );

  app.get<{
    Querystring: {
      page?: string;
      pageSize?: string;
      search?: string;
      stage?: string;
    };
  }>("/deals", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "deals");
    if (!userId) return;
    return withUser(userId, async () => {
      const page = Math.max(1, Number(request.query.page) || 1);
      const pageSize = Math.min(
        100,
        Math.max(1, Number(request.query.pageSize) || 20),
      );
      const result = await listDealsCommand({
        page,
        pageSize,
        search: request.query.search,
        stage: request.query.stage,
      });
      return sendSuccess(reply, result);
    });
  });

  app.get("/deals/form-options", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "deals");
    if (!userId) return;
    return withUser(userId, async () => {
      const options = await getDealFormOptionsCommand();
      return sendSuccess(reply, options);
    });
  });

  app.post<{
    Body: {
      companyId?: string | null;
      contactId?: string | null;
      excludeDealId?: string | null;
    };
  }>("/deals/duplicates/check", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "deals");
    if (!userId) return;
    return withUser(userId, async () => {
      const result = await checkDuplicateDealsCommand(request.body ?? {});
      return sendResult(reply, result);
    });
  });

  app.get<{
    Querystring: {
      search?: string;
      stage?: string;
      ownerUserId?: string;
      format?: string;
    };
  }>("/deals/export", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "deals");
    if (!userId) return;
    return withUser(userId, async () => {
      const result = await exportDealsCommand({
        search: request.query.search,
        stage: request.query.stage,
        ownerUserId: request.query.ownerUserId,
        format: request.query.format,
      });
      return sendResult(reply, result);
    });
  });

  app.post<{ Body: Record<string, unknown> }>("/deals", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "deals");
    if (!userId) return;
    return withUser(userId, async () => {
      const result = await createDealCommand(request.body ?? {});
      return sendResult(reply, result);
    });
  });

  app.get<{ Params: { id: string } }>("/deals/:id", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "deals");
    if (!userId) return;
    return withUser(userId, async () => {
      const result = await getDealCommand(request.params.id);
      if (!result.ok) {
        return sendError(reply, result.error, result.status);
      }
      return sendResult(reply, result);
    });
  });

  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    "/deals/:id",
    async (request, reply) => {
      const userId = await requireSessionOrApiKey(request, reply, "deals");
      if (!userId) return;
      return withUser(userId, async () => {
        const result = await updateDealCommand(
          request.params.id,
          request.body ?? {},
        );
        return sendResult(reply, result);
      });
    },
  );

  app.post<{
    Params: { id: string };
    Body: { stage?: string; lostReason?: string | null };
  }>("/deals/:id/stage", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "deals");
    if (!userId) return;
    return withUser(userId, async () => {
      const stage = request.body?.stage;
      if (!stage) {
        return sendError(reply, "stage is required.", 400);
      }
      const result = await updateDealStageCommand(request.params.id, stage, {
        lostReason: request.body?.lostReason,
      });
      return sendResult(reply, result);
    });
  });

  app.delete<{ Params: { id: string } }>("/deals/:id", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "deals");
    if (!userId) return;
    return withUser(userId, async () => {
      const result = await deleteDealCommand(request.params.id);
      return sendResult(reply, result);
    });
  });

  app.get<{ Params: { id: string } }>("/deals/:id/buying-group", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "deals");
    if (!userId) return;
    return withUser(userId, async () => {
      try {
        const group = await getDealBuyingGroup(request.params.id);
        if (!group) return sendError(reply, "Deal not found.", 404);
        return sendSuccess(reply, { buyingGroup: group });
      } catch (err) {
        if (err instanceof ForbiddenError) return sendError(reply, err.message, 403);
        throw err;
      }
    });
  });

  app.get<{ Params: { id: string } }>("/deals/:id/history", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "deals");
    if (!userId) return;
    return withUser(userId, async () => {
      const result = await listDealHistoryCommand(request.params.id);
      return sendResult(reply, result);
    });
  });

  app.post<{
    Params: { id: string };
    Body: {
      type?: string;
      subject?: string;
      body?: string | null;
      dueAt?: string | null;
    };
  }>("/deals/:id/activities", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "deals");
    if (!userId) return;
    return withUser(userId, async () => {
      const body = request.body ?? {};
      if (!body.type) {
        return sendError(reply, "type is required.", 400);
      }
      const result = await createDealActivityCommand(request.params.id, {
        type: body.type,
        subject: body.subject ?? "",
        body: body.body,
        dueAt: body.dueAt,
      });
      return sendResult(reply, result);
    });
  });

  app.delete<{ Params: { id: string; activityId: string } }>(
    "/deals/:id/activities/:activityId",
    async (request, reply) => {
      const userId = await requireSessionOrApiKey(request, reply, "deals");
      if (!userId) return;
      return withUser(userId, async () => {
        const result = await deleteDealActivityCommand(
          request.params.id,
          request.params.activityId,
        );
        return sendResult(reply, result);
      });
    },
  );

  app.get<{ Params: { id: string } }>("/deals/:id/proposals", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "deals");
    if (!userId) return;
    return withUser(userId, async () => {
      const result = await listProposalsForDealCommand(request.params.id);
      return sendResult(reply, result);
    });
  });

  app.get("/proposal-templates", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "deals");
    if (!userId) return;
    return withUser(userId, async () => {
      const result = await listProposalTemplatesCommand();
      return sendResult(reply, result);
    });
  });

  app.post<{
    Body: {
      name?: string;
      makeActive?: boolean;
      sections?: Array<{
        id: string;
        key: string;
        title: string;
        body: string;
        sortOrder: number;
      }>;
      blueprint?: unknown;
      assets?: unknown;
    };
  }>("/proposal-templates", { bodyLimit: 16 * 1024 * 1024 }, async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "deals");
    if (!userId) return;
    return withUser(userId, async () => {
      const body = request.body ?? {};
      if (!body.name?.trim()) {
        return sendError(reply, "Enter a template name.", 400);
      }
      const result = await createProposalTemplateCommand({
        name: body.name,
        makeActive: body.makeActive,
        sections: body.sections,
        blueprint: body.blueprint,
        assets: body.assets,
      });
      return sendResult(reply, result);
    });
  });

  app.post<{
    Body: {
      brief?: string;
      sampleText?: string;
      sampleFileBase64?: string;
      sampleFilename?: string;
      organizationName?: string;
      existingSections?: Array<{
        id?: string;
        key?: string;
        title?: string;
        body?: string;
        sortOrder?: number;
      }>;
    };
  }>(
    "/proposal-templates/generate",
    { bodyLimit: 16 * 1024 * 1024 },
    async (request, reply) => {
      const userId = await requireSessionOrApiKey(request, reply, "deals");
      if (!userId) return;
      return withUser(userId, async () => {
        const result = await generateProposalTemplateCommand(request.body ?? {});
        if (!result.ok && "status" in result && result.status) {
          return sendError(reply, result.error, result.status);
        }
        return sendResult(reply, result);
      });
    },
  );

  app.post<{
    Body: {
      message?: string;
      currentStep?: string;
      turnHint?: string;
      createName?: string;
      templateNames?: string[];
      hasSample?: boolean;
      skipEdit?: boolean;
      templateContext?: {
        templateId?: string;
        templateName?: string;
        blueprint?: unknown;
        assets?: unknown;
        sections?: Array<{
          id: string;
          key?: string;
          title: string;
          body: string;
          sortOrder?: number;
        }>;
      };
    };
  }>("/proposal-templates/chat", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "deals");
    if (!userId) return;
    return withUser(userId, async () => {
      const body = request.body ?? {};
      const step = body.currentStep;
      const currentStep =
        step === "awaiting_name" ||
        step === "awaiting_description" ||
        step === "done" ||
        step === "idle"
          ? step
          : "idle";
      const result = await chatProposalTemplateCommand({
        message: body.message ?? "",
        currentStep,
        turnHint: body.turnHint ?? "",
        createName: body.createName,
        templateNames: body.templateNames,
        hasSample: body.hasSample,
        skipEdit: body.skipEdit,
        templateContext: body.templateContext,
      });
      if (!result.ok && "status" in result && result.status) {
        return sendError(reply, result.error, result.status);
      }
      return sendResult(reply, result);
    });
  });

  app.get<{ Params: { id: string } }>(
    "/proposal-templates/:id",
    async (request, reply) => {
      const userId = await requireSessionOrApiKey(request, reply, "deals");
      if (!userId) return;
      return withUser(userId, async () => {
        const result = await getProposalTemplateCommand(request.params.id);
        return sendResult(reply, result);
      });
    },
  );

  app.patch<{
    Params: { id: string };
    Body: {
      name?: string;
      isDefault?: boolean;
      sections?: Array<{
        id: string;
        key: string;
        title: string;
        body: string;
        sortOrder: number;
      }>;
      blueprint?: unknown;
      assets?: unknown;
    };
  }>("/proposal-templates/:id", { bodyLimit: 16 * 1024 * 1024 }, async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "deals");
    if (!userId) return;
    return withUser(userId, async () => {
      const result = await updateProposalTemplateCommand(
        request.params.id,
        request.body ?? {},
      );
      return sendResult(reply, result);
    });
  });

  app.post<{
    Params: { id: string };
    Body: { dataBase64?: string; mime?: string };
  }>(
    "/proposal-templates/:id/logo",
    { bodyLimit: 4 * 1024 * 1024 },
    async (request, reply) => {
      const userId = await requireSessionOrApiKey(request, reply, "deals");
      if (!userId) return;
      return withUser(userId, async () => {
        const result = await updateDocumentTemplateLogoCommand(
          "proposal",
          request.params.id,
          request.body ?? {},
        );
        if (!result.ok && "status" in result && result.status) {
          return sendError(reply, result.error, result.status);
        }
        return sendResult(reply, result);
      });
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/proposal-templates/:id",
    async (request, reply) => {
      const userId = await requireSessionOrApiKey(request, reply, "deals");
      if (!userId) return;
      return withUser(userId, async () => {
        const result = await deleteProposalTemplateCommand(request.params.id);
        return sendResult(reply, result);
      });
    },
  );

  app.get("/quote-templates", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "quotes");
    if (!userId) return;
    return withUser(userId, async () => {
      const result = await listQuoteTemplatesCommand();
      return sendResult(reply, result);
    });
  });

  app.post<{
    Body: {
      name?: string;
      makeActive?: boolean;
      sections?: Array<{
        id: string;
        key: string;
        title: string;
        body: string;
        sortOrder: number;
      }>;
      blueprint?: unknown;
      assets?: unknown;
    };
  }>("/quote-templates", { bodyLimit: 16 * 1024 * 1024 }, async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "quotes");
    if (!userId) return;
    return withUser(userId, async () => {
      const body = request.body ?? {};
      if (!body.name?.trim()) {
        return sendError(reply, "Enter a template name.", 400);
      }
      const result = await createQuoteTemplateCommand({
        name: body.name,
        makeActive: body.makeActive,
        sections: body.sections,
        blueprint: body.blueprint,
        assets: body.assets,
      });
      return sendResult(reply, result);
    });
  });

  app.post<{
    Body: {
      brief?: string;
      sampleText?: string;
      sampleFileBase64?: string;
      sampleFilename?: string;
      organizationName?: string;
      existingSections?: Array<{
        id?: string;
        key?: string;
        title?: string;
        body?: string;
        sortOrder?: number;
      }>;
    };
  }>(
    "/quote-templates/generate",
    { bodyLimit: 16 * 1024 * 1024 },
    async (request, reply) => {
      const userId = await requireSessionOrApiKey(request, reply, "quotes");
      if (!userId) return;
      return withUser(userId, async () => {
        const result = await generateQuoteTemplateCommand(request.body ?? {});
        if (!result.ok && "status" in result && result.status) {
          return sendError(reply, result.error, result.status);
        }
        return sendResult(reply, result);
      });
    },
  );

  app.post<{
    Body: {
      message?: string;
      currentStep?: string;
      turnHint?: string;
      createName?: string;
      templateNames?: string[];
      hasSample?: boolean;
      skipEdit?: boolean;
      templateContext?: {
        templateId?: string;
        templateName?: string;
        blueprint?: unknown;
        assets?: unknown;
        sections?: Array<{
          id: string;
          key?: string;
          title: string;
          body: string;
          sortOrder?: number;
        }>;
      };
    };
  }>("/quote-templates/chat", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "quotes");
    if (!userId) return;
    return withUser(userId, async () => {
      const body = request.body ?? {};
      const step = body.currentStep;
      const currentStep =
        step === "awaiting_name" ||
        step === "awaiting_description" ||
        step === "done" ||
        step === "idle"
          ? step
          : "idle";
      const result = await chatQuoteTemplateCommand({
        message: body.message ?? "",
        currentStep,
        turnHint: body.turnHint ?? "",
        createName: body.createName,
        templateNames: body.templateNames,
        hasSample: body.hasSample,
        skipEdit: body.skipEdit,
        templateContext: body.templateContext,
      });
      if (!result.ok && "status" in result && result.status) {
        return sendError(reply, result.error, result.status);
      }
      return sendResult(reply, result);
    });
  });

  app.get<{ Params: { id: string } }>(
    "/quote-templates/:id",
    async (request, reply) => {
      const userId = await requireSessionOrApiKey(request, reply, "quotes");
      if (!userId) return;
      return withUser(userId, async () => {
        const result = await getQuoteTemplateCommand(request.params.id);
        return sendResult(reply, result);
      });
    },
  );

  app.patch<{
    Params: { id: string };
    Body: {
      name?: string;
      isDefault?: boolean;
      sections?: Array<{
        id: string;
        key: string;
        title: string;
        body: string;
        sortOrder: number;
      }>;
      blueprint?: unknown;
      assets?: unknown;
    };
  }>("/quote-templates/:id", { bodyLimit: 16 * 1024 * 1024 }, async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "quotes");
    if (!userId) return;
    return withUser(userId, async () => {
      const result = await updateQuoteTemplateCommand(
        request.params.id,
        request.body ?? {},
      );
      return sendResult(reply, result);
    });
  });

  app.post<{
    Params: { id: string };
    Body: { dataBase64?: string; mime?: string };
  }>(
    "/quote-templates/:id/logo",
    { bodyLimit: 4 * 1024 * 1024 },
    async (request, reply) => {
      const userId = await requireSessionOrApiKey(request, reply, "quotes");
      if (!userId) return;
      return withUser(userId, async () => {
        const result = await updateDocumentTemplateLogoCommand(
          "quote",
          request.params.id,
          request.body ?? {},
        );
        if (!result.ok && "status" in result && result.status) {
          return sendError(reply, result.error, result.status);
        }
        return sendResult(reply, result);
      });
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/quote-templates/:id",
    async (request, reply) => {
      const userId = await requireSessionOrApiKey(request, reply, "quotes");
      if (!userId) return;
      return withUser(userId, async () => {
        const result = await deleteQuoteTemplateCommand(request.params.id);
        return sendResult(reply, result);
      });
    },
  );

  app.post<{
    Body: {
      dealId?: string;
      title?: string;
      summary?: string | null;
      attachmentUrl?: string | null;
      fromTemplate?: boolean;
      templateId?: string | null;
      productHint?: string | null;
      productIds?: string[] | null;
      requirementPdfBase64?: string | null;
      requirementFilename?: string | null;
    };
  }>("/proposals", { bodyLimit: 16 * 1024 * 1024 }, async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "deals");
    if (!userId) return;
    return withUser(userId, async () => {
      const body = request.body ?? {};
      if (!body.dealId) {
        return sendError(reply, "dealId is required.", 400);
      }
      const fromTemplate = body.fromTemplate !== false;
      // Title optional — proposals are always generated from learned playbooks.
      const productIds = Array.isArray(body.productIds)
        ? body.productIds.filter((id): id is string => typeof id === "string")
        : null;
      const result = await createProposalCommand({
        dealId: body.dealId,
        title: body.title?.trim() || "",
        summary: body.summary,
        attachmentUrl: body.attachmentUrl,
        fromTemplate,
        templateId: body.templateId,
        productHint: body.productHint?.trim() || null,
        productIds,
        requirementPdfBase64: body.requirementPdfBase64,
        requirementFilename: body.requirementFilename,
      });
      return sendResult(reply, result);
    });
  });

  app.post<{
    Body: {
      dealId?: string;
      requirementText?: string;
      title?: string;
      templateId?: string | null;
      playbookId?: string | null;
      productHint?: string | null;
      productIds?: string[] | null;
      requirementPdfBase64?: string | null;
      requirementFilename?: string | null;
    };
  }>("/proposals/from-playbook", { bodyLimit: 16 * 1024 * 1024 }, async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "deals");
    if (!userId) return;
    return withUser(userId, async () => {
      const body = request.body ?? {};
      if (!body.dealId?.trim()) {
        return sendError(reply, "dealId is required.", 400);
      }
      const productIds = Array.isArray(body.productIds)
        ? body.productIds.filter((id): id is string => typeof id === "string")
        : null;
      const result = await createProposalFromPlaybookCommand({
        dealId: body.dealId.trim(),
        requirementText: body.requirementText || "",
        title: body.title,
        templateId: body.templateId,
        playbookId: body.playbookId,
        productHint: body.productHint?.trim() || null,
        productIds,
        requirementPdfBase64: body.requirementPdfBase64,
        requirementFilename: body.requirementFilename,
      });
      return sendResult(reply, result);
    });
  });

  app.get<{ Params: { id: string } }>(
    "/proposal-runs/:id",
    async (request, reply) => {
      const userId = await requireSessionOrApiKey(request, reply, "deals");
      if (!userId) return;
      return withUser(userId, async () => {
        const result = await getProposalGenerationRunCommand(request.params.id);
        return sendResult(reply, result);
      });
    },
  );

  app.post<{ Params: { id: string } }>(
    "/proposal-runs/:id/retry",
    async (request, reply) => {
      const userId = await requireSessionOrApiKey(request, reply, "deals");
      if (!userId) return;
      return withUser(userId, async () => {
        const result = await retryProposalGenerationRunCommand(request.params.id);
        return sendResult(reply, result);
      });
    },
  );

  app.get<{ Params: { id: string } }>("/proposals/:id", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "deals");
    if (!userId) return;
    return withUser(userId, async () => {
      const result = await getProposalCommand(request.params.id);
      return sendResult(reply, result);
    });
  });

  app.get<{ Params: { id: string } }>(
    "/proposals/:id/pdf",
    async (request, reply) => {
      const userId = await requireSessionOrApiKey(request, reply, "deals");
      if (!userId) return;
      return withUser(userId, async () => {
        const result = await getProposalPdfCommand(request.params.id);
        if (!result.ok) {
          return sendError(
            reply,
            result.error,
            "status" in result && result.status ? result.status : 500,
          );
        }
        reply
          .header("Content-Type", "application/pdf")
          .header(
            "Content-Disposition",
            `attachment; filename="${result.filename.replace(/"/g, "")}"`,
          );
        return reply.send(result.buffer);
      });
    },
  );

  app.get<{ Params: { id: string } }>(
    "/proposals/:id/docx",
    async (request, reply) => {
      const userId = await requireSessionOrApiKey(request, reply, "deals");
      if (!userId) return;
      return withUser(userId, async () => {
        const result = await getProposalDocxCommand(request.params.id);
        if (!result.ok) {
          return sendError(
            reply,
            result.error,
            "status" in result && result.status ? result.status : 500,
          );
        }
        reply
          .header(
            "Content-Type",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          )
          .header(
            "Content-Disposition",
            `attachment; filename="${result.filename.replace(/"/g, "")}"`,
          );
        return reply.send(result.buffer);
      });
    },
  );

  app.patch<{
    Params: { id: string };
    Body: {
      title?: string;
      summary?: string | null;
      attachmentUrl?: string | null;
      status?: "draft" | "shared" | "accepted" | "declined";
      customerName?: string | null;
      sections?: Array<{
        id: string;
        key: string;
        title: string;
        body: string;
        sortOrder: number;
      }>;
    };
  }>("/proposals/:id", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "deals");
    if (!userId) return;
    return withUser(userId, async () => {
      const result = await updateProposalCommand(
        request.params.id,
        request.body ?? {},
      );
      return sendResult(reply, result);
    });
  });

  app.post<{ Params: { id: string } }>("/proposals/:id/share", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "deals");
    if (!userId) return;
    return withUser(userId, async () => {
      const result = await shareProposalCommand(request.params.id);
      return sendResult(reply, result);
    });
  });

  app.post<{ Params: { id: string } }>("/proposals/:id/send", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "deals");
    if (!userId) return;
    return withUser(userId, async () => {
      const result = await sendProposalCommand(request.params.id);
      return sendResult(reply, result);
    });
  });

  app.post<{ Params: { id: string } }>("/proposals/:id/resend", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "deals");
    if (!userId) return;
    return withUser(userId, async () => {
      const result = await resendProposalCommand(request.params.id);
      return sendResult(reply, result);
    });
  });

  app.post<{ Params: { id: string } }>("/proposals/:id/approve", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "deals");
    if (!userId) return;
    return withUser(userId, async () => {
      const result = await approveProposalCommand(request.params.id);
      return sendResult(reply, result);
    });
  });

  app.post<{
    Params: { id: string };
    Body: {
      productIds?: string[];
      productHint?: string;
      playbookId?: string;
      requirementPdfBase64?: string;
      requirementFilename?: string;
    };
  }>("/proposals/:id/personalize", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "deals");
    if (!userId) return;
    return withUser(userId, async () => {
      const body = request.body ?? {};
      const productIds = Array.isArray(body.productIds)
        ? body.productIds.filter(
            (id): id is string => typeof id === "string" && Boolean(id.trim()),
          )
        : undefined;
      const result = await personalizeProposalCommand(request.params.id, {
        ...(productIds?.length ? { productIds } : {}),
        ...(typeof body.productHint === "string" && body.productHint.trim()
          ? { productHint: body.productHint.trim() }
          : {}),
        ...(typeof body.playbookId === "string" && body.playbookId.trim()
          ? { playbookId: body.playbookId.trim() }
          : {}),
        ...(typeof body.requirementPdfBase64 === "string" &&
        body.requirementPdfBase64.trim()
          ? { requirementPdfBase64: body.requirementPdfBase64.trim() }
          : {}),
        ...(typeof body.requirementFilename === "string" &&
        body.requirementFilename.trim()
          ? { requirementFilename: body.requirementFilename.trim() }
          : {}),
      });
      return sendResult(reply, result);
    });
  });

  app.post<{
    Params: { id: string };
    Body: { sectionKey?: string; instruction?: string };
  }>("/proposals/:id/rewrite-section", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "deals");
    if (!userId) return;
    return withUser(userId, async () => {
      const body = request.body ?? {};
      if (!body.sectionKey?.trim()) {
        return sendError(reply, "sectionKey is required.", 400);
      }
      const result = await rewriteProposalSectionCommand(request.params.id, {
        sectionKey: body.sectionKey,
        instruction: body.instruction,
      });
      return sendResult(reply, result);
    });
  });

  app.post<{
    Params: { id: string };
    Body: {
      sectionKey?: string;
      title?: string;
      body?: string;
    };
  }>("/proposals/:id/patch-section", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "deals");
    if (!userId) return;
    return withUser(userId, async () => {
      const body = request.body ?? {};
      if (!body.sectionKey?.trim()) {
        return sendError(reply, "sectionKey is required.", 400);
      }
      const result = await patchProposalSectionCommand(request.params.id, {
        sectionKey: body.sectionKey,
        title: body.title,
        body: body.body,
      });
      return sendResult(reply, result);
    });
  });

  app.post<{
    Params: { id: string };
    Body: { html?: string };
  }>("/proposals/:id/blueprint-html", { bodyLimit: 2 * 1024 * 1024 }, async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "deals");
    if (!userId) return;
    return withUser(userId, async () => {
      const html =
        typeof request.body?.html === "string" ? request.body.html : "";
      if (!html.trim()) {
        return sendError(reply, "html is required.", 400);
      }
      const result = await patchProposalBlueprintHtmlCommand(
        request.params.id,
        html,
      );
      return sendResult(reply, result);
    });
  });

  app.post<{
    Params: { id: string };
    Body: {
      textReplacements?: Array<{ find?: string; replace?: string }>;
      pageId?: string | null;
      removeImageAssetIds?: string[] | null;
      tableBorders?: boolean | null;
    };
  }>("/proposals/:id/patch-document-text", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "deals");
    if (!userId) return;
    return withUser(userId, async () => {
      const body = request.body ?? {};
      const result = await patchProposalDocumentTextCommand(request.params.id, {
        textReplacements: body.textReplacements ?? [],
        pageId: body.pageId ?? null,
        removeImageAssetIds: body.removeImageAssetIds ?? null,
        tableBorders: body.tableBorders ?? null,
      });
      return sendResult(reply, result);
    });
  });

  app.post<{
    Params: { id: string };
    Body: {
      assetId?: string;
      imageUrl?: string;
      dataBase64?: string;
      mime?: string;
      kind?: "logo" | "image";
    };
  }>("/proposals/:id/document-asset", { bodyLimit: 8 * 1024 * 1024 }, async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "deals");
    if (!userId) return;
    return withUser(userId, async () => {
      const result = await updateProposalDocumentAssetCommand(
        request.params.id,
        request.body ?? {},
      );
      return sendResult(reply, result);
    });
  });

  app.post<{ Params: { id: string } }>("/proposals/:id/version", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "deals");
    if (!userId) return;
    return withUser(userId, async () => {
      const result = await createProposalVersionCommand(request.params.id);
      return sendResult(reply, result);
    });
  });

  app.delete<{ Params: { id: string } }>("/proposals/:id", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "deals");
    if (!userId) return;
    return withUser(userId, async () => {
      const result = await deleteProposalCommand(request.params.id);
      return sendResult(reply, result);
    });
  });

  app.get<{ Params: { id: string } }>("/deals/:id/quotes", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "deals");
    if (!userId) return;
    return withUser(userId, async () => {
      try {
        const result = await listDealQuotesCommand(request.params.id);
        return sendSuccess(reply, result);
      } catch (err) {
        return sendError(reply, err instanceof Error ? err.message : "Failed to load quotes.", 400);
      }
    });
  });

  app.get<{
    Querystring: { page?: string; dealId?: string; status?: string };
  }>("/quotes", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "quotes");
    if (!userId) return;
    return withUser(userId, async () => {
      const page = Math.max(1, Number(request.query.page) || 1);
      const result = await listQuotesCommand({
        page,
        dealId: request.query.dealId,
        status: request.query.status,
      });
      return sendSuccess(reply, result);
    });
  });

  app.get("/quotes/pending-discount-approvals", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "quotes");
    if (!userId) return;
    return withUser(userId, async () => {
      const result = await listPendingDiscountApprovalsCommand();
      return sendResult(reply, result);
    });
  });

  app.get("/quotes/form-options", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "quotes");
    if (!userId) return;
    return withUser(userId, async () => {
      const options = await getQuoteFormOptionsCommand();
      return sendSuccess(reply, options);
    });
  });

  app.get<{ Params: { id: string } }>("/quotes/:id", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "quotes");
    if (!userId) return;
    return withUser(userId, async () => {
      const result = await getQuoteCommand(request.params.id);
      return sendResult(reply, result);
    });
  });

  app.get<{ Params: { id: string } }>(
    "/quotes/:id/pdf",
    async (request, reply) => {
      const userId = await requireSessionOrApiKey(request, reply, "quotes");
      if (!userId) return;
      return withUser(userId, async () => {
        const result = await getQuotePdfCommand(request.params.id);
        if (!result.ok) {
          return sendError(
            reply,
            result.error,
            "status" in result && result.status ? result.status : 500,
          );
        }
        reply
          .header("Content-Type", "application/pdf")
          .header(
            "Content-Disposition",
            `attachment; filename="${result.filename.replace(/"/g, "")}"`,
          );
        return reply.send(result.buffer);
      });
    },
  );

  app.get<{ Params: { id: string } }>(
    "/quotes/:id/csv",
    async (request, reply) => {
      const userId = await requireSessionOrApiKey(request, reply, "quotes");
      if (!userId) return;
      return withUser(userId, async () => {
        const result = await getQuoteCsvCommand(request.params.id);
        if (!result.ok) {
          return sendError(
            reply,
            result.error,
            "status" in result && result.status ? result.status : 500,
          );
        }
        reply
          .header("Content-Type", "text/csv; charset=utf-8")
          .header(
            "Content-Disposition",
            `attachment; filename="${result.filename.replace(/"/g, "")}"`,
          );
        return reply.send(result.csv);
      });
    },
  );

  app.get<{ Params: { id: string } }>(
    "/quotes/:id/docx",
    async (request, reply) => {
      const userId = await requireSessionOrApiKey(request, reply, "quotes");
      if (!userId) return;
      return withUser(userId, async () => {
        const result = await getQuoteDocxCommand(request.params.id);
        if (!result.ok) {
          return sendError(
            reply,
            result.error,
            "status" in result && result.status ? result.status : 500,
          );
        }
        reply
          .header(
            "Content-Type",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          )
          .header(
            "Content-Disposition",
            `attachment; filename="${result.filename.replace(/"/g, "")}"`,
          );
        return reply.send(result.buffer);
      });
    },
  );

  app.post<{
    Body: {
      dealId?: string;
      discountPct?: number;
      notes?: string | null;
      proposalId?: string | null;
      currency?: string | null;
      fromTemplate?: boolean;
      templateId?: string | null;
      lines?: Array<{
        productId?: string | null;
        name: string;
        quantity: number;
        unitPrice: number;
      }>;
    };
  }>("/quotes", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "quotes");
    if (!userId) return;
    return withUser(userId, async () => {
      const body = request.body ?? {};
      if (!body.dealId) {
        return sendError(reply, "dealId is required.", 400);
      }
      if (!body.lines?.length && !body.proposalId) {
        return sendError(reply, "Add at least one quote line.", 400);
      }
      const result = await createQuoteCommand({
        dealId: body.dealId,
        discountPct: body.discountPct,
        notes: body.notes,
        proposalId: body.proposalId,
        currency: body.currency,
        fromTemplate: body.fromTemplate,
        templateId: body.templateId,
        lines: body.lines ?? [],
      });
      return sendResult(reply, result);
    });
  });

  app.post<{
    Body: {
      dealId?: string;
      requirementPdfBase64?: string;
      requirementFilename?: string | null;
    };
  }>("/quotes/from-requirement", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "quotes");
    if (!userId) return;
    return withUser(userId, async () => {
      const body = request.body ?? {};
      if (!body.dealId) {
        return sendError(reply, "dealId is required.", 400);
      }
      if (!body.requirementPdfBase64?.trim()) {
        return sendError(reply, "Attach a BRD to generate this quote.", 400);
      }
      const { createQuoteFromRequirementCommand } = await import(
        "@/service/sales/quote-commands"
      );
      const result = await createQuoteFromRequirementCommand({
        dealId: body.dealId,
        requirementPdfBase64: body.requirementPdfBase64,
        requirementFilename: body.requirementFilename,
      });
      return sendResult(reply, result);
    });
  });

  app.patch<{
    Params: { id: string };
    Body: {
      notes?: string | null;
      customerName?: string | null;
      companyName?: string | null;
      vendorName?: string | null;
      discountPct?: number | string | null;
      lines?: Array<{
        productId?: string | null;
        name?: string;
        quantity?: number | string;
        unitPrice?: number | string;
      }>;
      documentSections?: Array<{
        id: string;
        key: string;
        title: string;
        body: string;
        sortOrder: number;
      }>;
    };
  }>("/quotes/:id", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "quotes");
    if (!userId) return;
    return withUser(userId, async () => {
      const result = await updateQuoteCommand(
        request.params.id,
        request.body ?? {},
      );
      return sendResult(reply, result);
    });
  });

  app.delete<{ Params: { id: string } }>(
    "/quotes/:id",
    async (request, reply) => {
      const userId = await requireSessionOrApiKey(request, reply, "quotes");
      if (!userId) return;
      return withUser(userId, async () => {
        const result = await deleteQuoteCommand(request.params.id);
        return sendResult(reply, result);
      });
    },
  );

  app.post<{
    Params: { id: string };
    Body: { sectionKey?: string; instruction?: string };
  }>("/quotes/:id/rewrite-section", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "quotes");
    if (!userId) return;
    return withUser(userId, async () => {
      const body = request.body ?? {};
      if (!body.sectionKey?.trim()) {
        return sendError(reply, "sectionKey is required.", 400);
      }
      const result = await rewriteQuoteSectionCommand(request.params.id, {
        sectionKey: body.sectionKey,
        instruction: body.instruction,
      });
      return sendResult(reply, result);
    });
  });

  app.post<{
    Params: { id: string };
    Body: {
      assetId?: string;
      imageUrl?: string;
      dataBase64?: string;
      mime?: string;
      kind?: "logo" | "image";
    };
  }>("/quotes/:id/document-asset", { bodyLimit: 8 * 1024 * 1024 }, async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "quotes");
    if (!userId) return;
    return withUser(userId, async () => {
      const result = await updateQuoteDocumentAssetCommand(
        request.params.id,
        request.body ?? {},
      );
      return sendResult(reply, result);
    });
  });

  app.post<{ Params: { id: string } }>("/quotes/:id/send", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "quotes");
    if (!userId) return;
    return withUser(userId, async () => {
      const result = await markQuoteSentCommand(request.params.id);
      return sendResult(reply, result);
    });
  });

  app.post<{ Params: { id: string } }>("/quotes/:id/resend", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "quotes");
    if (!userId) return;
    return withUser(userId, async () => {
      const result = await resendQuoteCommand(request.params.id);
      return sendResult(reply, result);
    });
  });

  app.post<{ Params: { id: string } }>("/quotes/:id/approve", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "quotes");
    if (!userId) return;
    return withUser(userId, async () => {
      const result = await approveQuoteCommand(request.params.id);
      return sendResult(reply, result);
    });
  });

  app.post<{
    Params: { id: string };
    Body: { reason?: string };
  }>("/quotes/:id/reject-discount", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "quotes");
    if (!userId) return;
    return withUser(userId, async () => {
      const reason =
        typeof request.body?.reason === "string" ? request.body.reason : "";
      const result = await rejectQuoteDiscountCommand(request.params.id, reason);
      return sendResult(reply, result);
    });
  });

  app.post<{ Params: { id: string } }>("/quotes/:id/accept", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "quotes");
    if (!userId) return;
    return withUser(userId, async () => {
      const result = await acceptQuoteCommand(request.params.id);
      return sendResult(reply, result);
    });
  });

  app.post<{ Params: { id: string } }>("/quotes/:id/reject", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "quotes");
    if (!userId) return;
    return withUser(userId, async () => {
      const result = await rejectQuoteCommand(request.params.id);
      return sendResult(reply, result);
    });
  });

  app.get<{
    Params: { companyId: string };
    Querystring: { page?: string; pageSize?: string; stage?: string };
  }>("/companies/:companyId/deals", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "deals");
    if (!userId) return;
    return withUser(userId, async () => {
      const page = Math.max(1, Number(request.query.page) || 1);
      const pageSize = Math.min(
        100,
        Math.max(1, Number(request.query.pageSize) || 20),
      );
      const result = await listDealsCommand({
        page,
        pageSize,
        stage: request.query.stage,
        companyId: request.params.companyId,
      });
      return sendSuccess(reply, result);
    });
  });

  app.get<{ Params: { companyId: string } }>(
    "/companies/:companyId/contracts",
    async (request, reply) => {
      const userId = await requireSessionOrApiKey(request, reply, "sales");
      if (!userId) return;
      return withUser(userId, async () => {
        const { listContractsByCompany } = await import(
          "@/service/sales/contract-commands"
        );
        const items = await listContractsByCompany(request.params.companyId);
        return sendSuccess(reply, { items });
      });
    },
  );

  app.get<{ Params: { id: string } }>(
    "/deals/:id/contracts",
    async (request, reply) => {
      const userId = await requireSessionOrApiKey(request, reply, "sales");
      if (!userId) return;
      return withUser(userId, async () => {
        const { listContractsForDeal } = await import(
          "@/dao/sales/deal-service"
        );
        const rows = await listContractsForDeal(request.params.id);
        return sendSuccess(reply, {
          items: rows.map((row) => ({
            id: row.id,
            title: row.title,
            startsAt: row.startsAt.toISOString(),
            endsAt: row.endsAt.toISOString(),
            arr: row.arr != null ? Number(row.arr) : null,
            autoRenew: row.autoRenew,
            status: row.status,
            renewDealId: row.renewDealId,
          })),
        });
      });
    },
  );

  app.get<{ Params: { id: string } }>(
    "/contracts/:id",
    async (request, reply) => {
      const userId = await requireSessionOrApiKey(request, reply, "sales");
      if (!userId) return;
      return withUser(userId, async () => {
        const { getContractById } = await import(
          "@/service/sales/contract-commands"
        );
        const contract = await getContractById(request.params.id);
        if (!contract) return sendError(reply, "Contract not found.", 404);
        return sendSuccess(reply, { contract });
      });
    },
  );

  app.patch<{
    Params: { id: string };
    Body: { autoRenew?: boolean; renewDealId?: string | null; status?: string };
  }>("/contracts/:id", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "sales");
    if (!userId) return;
    return withUser(userId, async () => {
      const { patchContract } = await import("@/service/sales/contract-commands");
      try {
        const contract = await patchContract(
          request.params.id,
          {
            autoRenew: request.body?.autoRenew,
            renewDealId: request.body?.renewDealId,
            status:
              request.body?.status === "active" ||
              request.body?.status === "expired" ||
              request.body?.status === "cancelled"
                ? request.body.status
                : undefined,
          },
          userId,
        );
        return sendSuccess(reply, { contract });
      } catch (err) {
        return sendError(
          reply,
          err instanceof Error ? err.message : "Failed to update contract.",
          400,
        );
      }
    });
  });

  app.post<{ Params: { id: string } }>(
    "/contracts/:id/renewal-quote",
    async (request, reply) => {
      const userId = await requireSessionOrApiKey(request, reply, "quotes");
      if (!userId) return;
      return withUser(userId, async () => {
        const { getContractById } = await import(
          "@/service/sales/contract-commands"
        );
        const { cloneRenewalQuoteFromContract } = await import(
          "@/service/sales/renewal-quote-service"
        );
        const contract = await getContractById(request.params.id);
        if (!contract?.renewDealId) {
          return sendError(reply, "Link a renewal deal before creating a quote.", 400);
        }
        try {
          const quote = await cloneRenewalQuoteFromContract({
            contractId: contract.id,
            dealId: contract.renewDealId,
            actorUserId: userId,
          });
          return sendSuccess(reply, { quote: { id: quote.id, number: quote.number } });
        } catch (err) {
          return sendError(
            reply,
            err instanceof Error ? err.message : "Failed to create renewal quote.",
            400,
          );
        }
      });
    },
  );

  app.post<{
    Params: { id: string };
    Body: { effectiveDate?: string; lines?: Array<{ name: string; monthlyAmount: number }> };
  }>("/contracts/:id/amendment-quote", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "quotes");
    if (!userId) return;
    return withUser(userId, async () => {
      const { getContractById } = await import(
        "@/service/sales/contract-commands"
      );
      const { previewProration } = await import("@/service/finance/proration");
      const { createQuote } = await import("@/dao/sales/quote-service");
      const contract = await getContractById(request.params.id);
      if (!contract?.renewDealId && !contract?.dealId) {
        return sendError(reply, "Contract has no deal for amendment quote.", 400);
      }
      const dealId = contract.renewDealId ?? contract.dealId;
      if (!dealId) return sendError(reply, "Contract has no deal.", 400);
      const effectiveDate = request.body?.effectiveDate
        ? new Date(request.body.effectiveDate)
        : new Date();
      const lines = request.body?.lines?.length
        ? request.body.lines
        : [{ name: "Amendment", monthlyAmount: 0 }];
      const preview = previewProration({
        termStart: new Date(contract.startsAt),
        termEnd: new Date(contract.endsAt),
        effectiveDate,
        lines,
      });
      try {
        const quote = await createQuote({
          dealId,
          notes: `Amendment (prorated ${preview.totalProrated})`,
          lines: preview.lines.map((line) => ({
            name: line.name,
            quantity: 1,
            unitPrice: line.proratedAmount,
          })),
        });
        return sendSuccess(reply, { quote: { id: quote.id, number: quote.number }, preview });
      } catch (err) {
        return sendError(
          reply,
          err instanceof Error ? err.message : "Failed to create amendment quote.",
          400,
        );
      }
    });
  });
};
