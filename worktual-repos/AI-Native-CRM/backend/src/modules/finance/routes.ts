import type { FastifyPluginAsync } from "fastify";
import {
  createInvoiceFromDealCommand,
  createInvoiceTemplateCommand,
  deleteInvoiceCommand,
  deleteInvoiceTemplateCommand,
  getDealInvoiceAutofillCommand,
  getInvoiceCommand,
  getInvoiceCreateOptionsCommand,
  getInvoicePdfCommand,
  getInvoiceCsvCommand,
  getInvoiceDocxCommand,
  getInvoiceTemplateCommand,
  listInvoiceBarCommand,
  listInvoiceTemplatesCommand,
  listInvoicesPageCommand,
  markInvoicePaidCommand,
  resendInvoiceEmailCommand,
  sendInvoiceEmailCommand,
  updateInvoiceCommand,
  updateInvoiceTemplateCommand,
  voidInvoiceCommand,
} from "@/service/finance/invoice-commands";
import {
  approveInvoiceCommand,
  rejectInvoiceCommand,
  resubmitInvoiceForApprovalCommand,
  withdrawInvoiceApprovalCommand,
} from "@/service/sales/document-approval";
import {
  chatInvoiceTemplateCommand,
  generateInvoiceTemplateCommand,
  updateDocumentTemplateLogoCommand,
} from "@/service/sales/template-generate-commands";
import { requireSessionOrApiKey, withUser } from "../../middlewares/auth.js";
import { sendSuccess, sendError, sendResult } from "../../helpers/response.js";

export const financeRoutes: FastifyPluginAsync = async (app) => {
  app.get<{
    Querystring: { page?: string; search?: string; q?: string; status?: string };
  }>("/invoices", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "invoices");
    if (!userId) return;
    return withUser(userId, async () => {
      const page = Math.max(1, Number(request.query.page) || 1);
      const result = await listInvoicesPageCommand({
        page,
        search: request.query.search ?? request.query.q,
        status: request.query.status,
      });
      return sendSuccess(reply, result);
    });
  });

  app.get("/invoices/bar", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "invoices");
    if (!userId) return;
    return withUser(userId, async () => {
      const items = await listInvoiceBarCommand();
      return sendSuccess(reply, { items });
    });
  });

  app.get("/invoices/create-options", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "invoices");
    if (!userId) return;
    return withUser(userId, async () => {
      try {
        const options = await getInvoiceCreateOptionsCommand();
        return sendSuccess(reply, options);
      } catch (err) {
        return sendError(
          reply,
          err instanceof Error ? err.message : "Cannot create invoices.",
          403,
        );
      }
    });
  });

  app.get<{ Params: { dealId: string } }>(
    "/invoices/autofill/:dealId",
    async (request, reply) => {
      const userId = await requireSessionOrApiKey(request, reply, "invoices");
      if (!userId) return;
      return withUser(userId, async () => {
        const result = await getDealInvoiceAutofillCommand(
          request.params.dealId,
        );
        return sendResult(reply, result);
      });
    },
  );

  app.get("/invoice-templates", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "invoices");
    if (!userId) return;
    return withUser(userId, async () => {
      const result = await listInvoiceTemplatesCommand();
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
  }>("/invoice-templates", { bodyLimit: 16 * 1024 * 1024 }, async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "invoices");
    if (!userId) return;
    return withUser(userId, async () => {
      const body = request.body ?? {};
      if (!body.name?.trim()) {
        return sendError(reply, "Enter a template name.", 400);
      }
      const result = await createInvoiceTemplateCommand({
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
    "/invoice-templates/generate",
    { bodyLimit: 16 * 1024 * 1024 },
    async (request, reply) => {
      const userId = await requireSessionOrApiKey(request, reply, "invoices");
      if (!userId) return;
      return withUser(userId, async () => {
        const result = await generateInvoiceTemplateCommand(request.body ?? {});
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
  }>("/invoice-templates/chat", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "invoices");
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
      const result = await chatInvoiceTemplateCommand({
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
    "/invoice-templates/:id",
    async (request, reply) => {
      const userId = await requireSessionOrApiKey(request, reply, "invoices");
      if (!userId) return;
      return withUser(userId, async () => {
        const result = await getInvoiceTemplateCommand(request.params.id);
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
  }>("/invoice-templates/:id", { bodyLimit: 16 * 1024 * 1024 }, async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "invoices");
    if (!userId) return;
    return withUser(userId, async () => {
      const result = await updateInvoiceTemplateCommand(
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
    "/invoice-templates/:id/logo",
    { bodyLimit: 4 * 1024 * 1024 },
    async (request, reply) => {
      const userId = await requireSessionOrApiKey(request, reply, "invoices");
      if (!userId) return;
      return withUser(userId, async () => {
        const result = await updateDocumentTemplateLogoCommand(
          "invoice",
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
    "/invoice-templates/:id",
    async (request, reply) => {
      const userId = await requireSessionOrApiKey(request, reply, "invoices");
      if (!userId) return;
      return withUser(userId, async () => {
        const result = await deleteInvoiceTemplateCommand(request.params.id);
        return sendResult(reply, result);
      });
    },
  );

  app.get<{ Params: { id: string } }>("/invoices/:id", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "invoices");
    if (!userId) return;
    return withUser(userId, async () => {
      const result = await getInvoiceCommand(request.params.id);
      return sendResult(reply, result);
    });
  });

  app.get<{ Params: { id: string } }>(
    "/invoices/:id/csv",
    async (request, reply) => {
      const userId = await requireSessionOrApiKey(request, reply, "invoices");
      if (!userId) return;
      return withUser(userId, async () => {
        const result = await getInvoiceCsvCommand(request.params.id);
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
    "/invoices/:id/pdf",
    async (request, reply) => {
      const userId = await requireSessionOrApiKey(request, reply, "invoices");
      if (!userId) return;
      return withUser(userId, async () => {
        const result = await getInvoicePdfCommand(request.params.id);
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
    "/invoices/:id/docx",
    async (request, reply) => {
      const userId = await requireSessionOrApiKey(request, reply, "invoices");
      if (!userId) return;
      return withUser(userId, async () => {
        const result = await getInvoiceDocxCommand(request.params.id);
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
      currency?: string;
      status?: "draft" | "sent";
      billingKind?: string;
      paymentTerms?: string | null;
      notes?: string | null;
      billingAddress?: string | null;
      leadEmail?: string | null;
      leadPhone?: string | null;
      taxId?: string | null;
      discountAmount?: number;
      issueDate?: string | null;
      dueAt?: string | null;
      taxConfig?: unknown;
      templateId?: string | null;
      lines?: Array<{
        kind: "product" | "addon";
        productId?: string | null;
        addonId?: string | null;
        name: string;
        description?: string | null;
        quantity: number;
        unitPrice: number;
        taxPercent?: number;
        amount: number;
      }>;
    };
  }>("/invoices", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "invoices");
    if (!userId) return;
    return withUser(userId, async () => {
      const body = request.body ?? {};
      if (!body.dealId) {
        return sendError(reply, "dealId is required.", 400);
      }
      if (!body.lines?.length) {
        return sendError(reply, "Add at least one line item.", 400);
      }
      const result = await createInvoiceFromDealCommand({
        dealId: body.dealId,
        currency: body.currency,
        status: body.status,
        billingKind: body.billingKind as never,
        paymentTerms: body.paymentTerms,
        notes: body.notes,
        billingAddress: body.billingAddress,
        leadEmail: body.leadEmail,
        leadPhone: body.leadPhone,
        taxId: body.taxId,
        discountAmount: body.discountAmount,
        issueDate: body.issueDate,
        dueAt: body.dueAt,
        taxConfig: body.taxConfig as never,
        templateId: body.templateId,
        lines: body.lines,
      });
      return sendResult(reply, result);
    });
  });

  app.post<{
    Params: { id: string };
    Body: { paymentReference?: string; paymentMethod?: "offline" | "manual" };
  }>(
    "/invoices/:id/mark-paid",
    async (request, reply) => {
      const userId = await requireSessionOrApiKey(request, reply, "invoices");
      if (!userId) return;
      return withUser(userId, async () => {
        const result = await markInvoicePaidCommand(
          request.params.id,
          request.body ?? {},
        );
        return sendResult(reply, result);
      });
    },
  );

  app.patch<{
    Params: { id: string };
    Body: {
      notes?: string | null;
      paymentTerms?: string | null;
      lines?: Array<{
        productId?: string | null;
        name?: string;
        quantity?: number;
        unitPrice?: number;
        description?: string | null;
      }>;
      discountAmount?: number | null;
      discountPct?: number | null;
    };
  }>("/invoices/:id", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "invoices");
    if (!userId) return;
    return withUser(userId, async () => {
      const result = await updateInvoiceCommand(
        request.params.id,
        request.body ?? {},
      );
      return sendResult(reply, result);
    });
  });

  app.delete<{ Params: { id: string } }>(
    "/invoices/:id",
    async (request, reply) => {
      const userId = await requireSessionOrApiKey(request, reply, "invoices");
      if (!userId) return;
      return withUser(userId, async () => {
        const result = await deleteInvoiceCommand(request.params.id);
        return sendResult(reply, result);
      });
    },
  );

  app.post<{ Params: { id: string }; Body: { paymentProvider?: string } }>(
    "/invoices/:id/send",
    async (request, reply) => {
      const userId = await requireSessionOrApiKey(request, reply, "invoices");
      if (!userId) return;
      return withUser(userId, async () => {
        const provider = request.body?.paymentProvider;
        const result = await sendInvoiceEmailCommand(request.params.id, {
          paymentProvider:
            provider === "stripe" || provider === "razorpay"
              ? provider
              : undefined,
        });
        return sendResult(reply, result);
      });
    },
  );

  app.post<{ Params: { id: string } }>(
    "/invoices/:id/approve",
    async (request, reply) => {
      const userId = await requireSessionOrApiKey(request, reply, "invoices");
      if (!userId) return;
      return withUser(userId, async () => {
        const result = await approveInvoiceCommand(request.params.id);
        return sendResult(reply, result);
      });
    },
  );

  app.post<{ Params: { id: string }; Body: { reason?: string } }>(
    "/invoices/:id/reject",
    async (request, reply) => {
      const userId = await requireSessionOrApiKey(request, reply, "invoices");
      if (!userId) return;
      return withUser(userId, async () => {
        const reason =
          typeof request.body?.reason === "string" ? request.body.reason : "";
        const result = await rejectInvoiceCommand(request.params.id, reason);
        return sendResult(reply, result);
      });
    },
  );

  app.post<{ Params: { id: string }; Body: { paymentProvider?: string } }>(
    "/invoices/:id/resend",
    async (request, reply) => {
      const userId = await requireSessionOrApiKey(request, reply, "invoices");
      if (!userId) return;
      return withUser(userId, async () => {
        const provider = request.body?.paymentProvider;
        const result = await resendInvoiceEmailCommand(request.params.id, {
          paymentProvider:
            provider === "stripe" || provider === "razorpay"
              ? provider
              : undefined,
        });
        return sendResult(reply, result);
      });
    },
  );

  app.post<{ Params: { id: string }; Body: { reason?: string } }>(
    "/invoices/:id/void",
    async (request, reply) => {
      const userId = await requireSessionOrApiKey(request, reply, "invoices");
      if (!userId) return;
      return withUser(userId, async () => {
        const reason =
          typeof request.body?.reason === "string" ? request.body.reason : "";
        const result = await voidInvoiceCommand(request.params.id, reason);
        return sendResult(reply, result);
      });
    },
  );

  app.post<{ Params: { id: string } }>(
    "/invoices/:id/withdraw-approval",
    async (request, reply) => {
      const userId = await requireSessionOrApiKey(request, reply, "invoices");
      if (!userId) return;
      return withUser(userId, async () => {
        const result = await withdrawInvoiceApprovalCommand(request.params.id);
        return sendResult(reply, result);
      });
    },
  );

  app.post<{ Params: { id: string } }>(
    "/invoices/:id/resubmit",
    async (request, reply) => {
      const userId = await requireSessionOrApiKey(request, reply, "invoices");
      if (!userId) return;
      return withUser(userId, async () => {
        const result = await resubmitInvoiceForApprovalCommand(
          request.params.id,
        );
        return sendResult(reply, result);
      });
    },
  );

  app.get("/contracts/at-risk", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "invoices");
    if (!userId) return;
    return withUser(userId, async () => {
      const { listAtRiskContracts } = await import(
        "@/service/sales/contract-commands"
      );
      const result = await listAtRiskContracts();
      return sendSuccess(reply, result);
    });
  });

  app.get<{
    Params: { id: string };
    Querystring: { effectiveDate?: string };
  }>(
    "/contracts/:id/proration-preview",
    async (request, reply) => {
      const userId = await requireSessionOrApiKey(request, reply, "invoices");
      if (!userId) return;
      return withUser(userId, async () => {
        const { getContractById } = await import(
          "@/service/sales/contract-commands"
        );
        const { previewProration } = await import("@/service/finance/proration");
        const contract = await getContractById(request.params.id);
        if (!contract) return sendError(reply, "Contract not found.", 404);
        const effectiveDate = request.query.effectiveDate
          ? new Date(request.query.effectiveDate)
          : new Date();
        const monthly =
          contract.arr != null && contract.arr > 0 ? contract.arr / 12 : 0;
        const preview = previewProration({
          termStart: new Date(contract.startsAt),
          termEnd: new Date(contract.endsAt),
          effectiveDate,
          lines: [{ name: contract.title, monthlyAmount: monthly }],
        });
        return sendSuccess(reply, { contract, preview });
      });
    },
  );
};
