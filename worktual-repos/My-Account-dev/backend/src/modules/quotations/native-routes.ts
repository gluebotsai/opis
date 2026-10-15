import type {
  FastifyPluginAsync,
  FastifyReply,
  FastifyRequest,
} from "fastify";

import {
  authorizeLeadModify,
  authorizeLeadView,
  authorizeQuotationCreate,
} from "../auth/access-control.js";
import { getSession } from "../auth/session-auth.js";
import { approveBillingChangeQuotation } from "../billing/changes.js";
import {
  queueQuotationApprovedEmail,
  queueQuotationOfflinePaymentEmail,
  queueQuotationRejectedEmail,
} from "../../infra/notify.js";
import { logPayment, logPaymentError } from "../../infra/file-logger.js";
import { assertValidUtr } from "../../lib/utr-validation.js";
import { applyPaymentProviderPolicy } from "../payments/amount-policy.js";
import {
  PAYMENT_LINK_OVERALL_TIMEOUT_MS,
  withTimeout,
} from "../payments/fetchWithTimeout.js";
import {
  confirmFinancePayment,
  markQuotationPaymentPaid,
  recordProviderPaymentReported,
  resendCustomerWelcomeEmail,
  resendFinancePaymentAlert,
} from "../payments/fulfillment.js";
import { syncLeadCustomerFulfillment } from "../payments/leadFulfillment.js";
import {
  billingChangePhaseLabel,
  isBillingChangePhase,
} from "../payments/billingPhases.js";
import { syncRazorpayQuotationPayment } from "../payments/razorpay.js";
import { syncStripeQuotationPayment } from "../payments/stripe.js";
import {
  clearQuoteSession,
  getQuoteSession,
  saveQuoteSession,
} from "./quote-sessions.js";
import {
  approveQuotation,
  createQuotationsForFinance,
  ensureOfflineBankTransferPayment,
  fulfillZeroValueQuotation,
  getApprovedQuotationPayment,
  getQuotation,
  hasAllBranchPaymentLinks,
  isTemporaryQuotation,
  issueQuotationPaymentLink,
  listQuotationStatuses,
  listQuotations,
  publishQuotationApprovedEvent,
  QUOTATION_STATUSES,
  rejectQuotation,
  revertQuotationApproval,
  toFinanceQueueQuotation,
  withdrawApprovedQuotationBySales,
} from "./quotation-store.js";

type AuthUser = {
  email: string;
  role: string;
  userId?: string | null;
};

type AuthedRequest = FastifyRequest & {
  authUser?: AuthUser;
  financeUser?: AuthUser;
};

type IdParams = { id: string };
type LeadParams = { leadId: string };
type AnyBody = Record<string, any>;

function bearerToken(request: FastifyRequest): string {
  const header = request.headers.authorization || "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  try {
    const session = await getSession(bearerToken(request));
    if (!session) {
      return reply.code(401).send({ error: "Authentication required." });
    }
    (request as AuthedRequest).authUser = session;
  } catch (error) {
    return reply.code(500).send({
      error: error instanceof Error ? error.message : "Authentication failed.",
    });
  }
}

async function requireFinanceAuth(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  try {
    const session = await getSession(bearerToken(request));
    if (!session || session.role !== "finance") {
      return reply.code(401).send({ error: "Authentication required." });
    }
    const authedRequest = request as AuthedRequest;
    authedRequest.financeUser = session;
    authedRequest.authUser = session;
  } catch (error) {
    return reply.code(500).send({
      error: error instanceof Error ? error.message : "Authentication failed.",
    });
  }
}

/** Enqueue customer approve/offline mail by id only (PDFs hydrated in worker). */
async function queueApprovedEmail(
  quotationId: string,
  logKey = "quotation.approve.notification_failed",
): Promise<boolean> {
  try {
    await queueQuotationApprovedEmail(quotationId);
    return true;
  } catch (notificationError: unknown) {
    logPaymentError(logKey, notificationError, { quotationId });
    return false;
  }
}

async function queueOfflineEmail(
  quotationId: string,
  logKey = "quotation.approve.offline_notification_failed",
): Promise<boolean> {
  try {
    await queueQuotationOfflinePaymentEmail(quotationId);
    return true;
  } catch (notificationError: unknown) {
    logPaymentError(logKey, notificationError, { quotationId });
    return false;
  }
}

/** Enqueue sales reject mail by id only (PDFs hydrated in worker). */
async function queueRejectedEmail(
  quotationId: string,
  logKey = "quotation.reject.notification_failed",
): Promise<boolean> {
  try {
    await queueQuotationRejectedEmail(quotationId);
    return true;
  } catch (notificationError: unknown) {
    logPaymentError(logKey, notificationError, { quotationId });
    return false;
  }
}

function isPaymentLinkTimeoutError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || "");
  return /timed out/i.test(message);
}

async function issuePaymentLinkBounded(
  quotationId: string,
  provider: string | null,
) {
  return withTimeout(
    issueQuotationPaymentLink(quotationId, { provider }),
    PAYMENT_LINK_OVERALL_TIMEOUT_MS,
    "Payment link creation",
  );
}

async function requireSalesWorkspaceAuth(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  try {
    const session = await getSession(bearerToken(request));
    if (
      !session ||
      (session.role !== "sales" && session.role !== "sales_admin")
    ) {
      return reply.code(401).send({ error: "Authentication required." });
    }
    (request as AuthedRequest).authUser = session;
  } catch (error) {
    return reply.code(500).send({
      error: error instanceof Error ? error.message : "Authentication failed.",
    });
  }
}

function authUser(request: FastifyRequest): AuthUser {
  return (request as AuthedRequest).authUser as AuthUser;
}

function financeUser(request: FastifyRequest): AuthUser {
  return (request as AuthedRequest).financeUser as AuthUser;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

async function authorize(
  request: FastifyRequest,
  reply: FastifyReply,
  leadId: string,
  mode: "view" | "create",
): Promise<boolean> {
  const result =
    mode === "view"
      ? await authorizeLeadView(authUser(request), leadId)
      : await authorizeQuotationCreate(authUser(request), leadId);
  if (result.ok) return true;
  reply.code((result as any).status).send({ error: (result as any).error });
  return false;
}

export const nativeQuotationRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("x-route-host", "fastify");
    return payload;
  });

  app.get<{ Params: LeadParams }>(
    "/quote-sessions/:leadId",
    { preHandler: requireAuth },
    async (request, reply) => {
      try {
        if (
          !(await authorize(
            request,
            reply,
            request.params.leadId,
            "view",
          ))
        ) {
          return;
        }
        const session = await getQuoteSession(request.params.leadId);
        return reply.send({ session });
      } catch (error) {
        return reply.code(500).send({
          error: errorMessage(error, "Could not load quote session."),
        });
      }
    },
  );

  app.put<{ Params: LeadParams; Body: AnyBody }>(
    "/quote-sessions/:leadId",
    { preHandler: requireAuth },
    async (request, reply) => {
      try {
        if (
          !(await authorize(
            request,
            reply,
            request.params.leadId,
            "create",
          ))
        ) {
          return;
        }
        const session = await saveQuoteSession(
          request.params.leadId,
          request.body || {},
        );
        return reply.send({ session });
      } catch (error) {
        return reply.code(400).send({
          error: errorMessage(error, "Could not save quote session."),
        });
      }
    },
  );

  app.delete<{ Params: LeadParams }>(
    "/quote-sessions/:leadId",
    { preHandler: requireAuth },
    async (request, reply) => {
      try {
        if (
          !(await authorize(
            request,
            reply,
            request.params.leadId,
            "create",
          ))
        ) {
          return;
        }
        await clearQuoteSession(request.params.leadId);
        return reply.send({ ok: true });
      } catch (error) {
        return reply.code(500).send({
          error: errorMessage(error, "Could not clear quote session."),
        });
      }
    },
  );

  app.post<{ Params: IdParams; Body: AnyBody }>(
    "/quotations/:id/report-payment",
    { preHandler: requireFinanceAuth },
    async (request, reply) => {
      try {
        const body = request.body || {};
        const user = financeUser(request);
        const paymentMethod =
          String(body.paymentMethod || "bank_transfer").trim() ||
          "bank_transfer";
        const userReference = body.providerPaymentId || body.reference;
        const reference =
          userReference != null && String(userReference).trim()
            ? assertValidUtr(String(userReference).trim(), "Payment reference")
            : `${paymentMethod}_${user.email}_${Date.now()}`;
        const billingBranchId =
          typeof body.billingBranchId === "string" &&
          body.billingBranchId.trim()
            ? body.billingBranchId.trim()
            : null;

        let quotation = await getQuotation(request.params.id);
        if (!quotation) {
          return reply.code(404).send({ error: "Quotation not found." });
        }

        logPayment("payment.finance.report_payment", {
          quotationId: request.params.id,
          companyName:
            (quotation.lead as any)?.companyName ||
            (quotation.lead as any)?.company_name ||
            null,
          billingBranchId,
          source: paymentMethod,
          provider: paymentMethod,
          actor: user.email,
          providerPaymentId: reference as any,
        });

        if (!quotation.payment) {
          quotation = await ensureOfflineBankTransferPayment(quotation);
        }

        const result = (await recordProviderPaymentReported({
          quotationId: request.params.id,
          billingBranchId: billingBranchId as any,
          source: paymentMethod,
          providerPaymentId: reference as any,
          paidAt: body.paidAt || new Date(),
          reportedBy: user.email as any,
          sendNotifications: body.notify !== false,
        }) as any);
        quotation = await getQuotation(request.params.id);
        return reply.send({
          ...result,
          quotation: toFinanceQueueQuotation(quotation),
        });
      } catch (error) {
        logPaymentError("payment.finance.report_payment.failed", error, {
          quotationId: request.params.id,
          actor:
            (request as AuthedRequest).financeUser?.email || null,
        });
        return reply.code(400).send({
          error: errorMessage(error, "Could not report payment."),
        });
      }
    },
  );

  app.post<{ Params: IdParams; Body: AnyBody }>(
    "/quotations/:id/confirm-payment",
    { preHandler: requireFinanceAuth },
    async (request, reply) => {
      try {
        const body = request.body || {};
        const user = financeUser(request);
        const billingBranchId =
          typeof body.billingBranchId === "string" &&
          body.billingBranchId.trim()
            ? body.billingBranchId.trim()
            : null;

        const confirmQuotation = await getQuotation(request.params.id);
        logPayment("payment.finance.confirm_payment", {
          quotationId: request.params.id,
          companyName:
            (confirmQuotation?.lead as any)?.companyName ||
            (confirmQuotation?.lead as any)?.company_name ||
            null,
          billingBranchId,
          actor: user.email,
          source: "manual",
          provider: "manual",
        });

        const result = (await confirmFinancePayment({
          quotationId: request.params.id,
          billingBranchId: billingBranchId as any,
          financeConfirmedBy: user.email as any,
          paidAt: body.paidAt || new Date(),
          sendNotifications: body.notify !== false,
          deferNotifications: true,
          awaitFulfillment: false,
        }) as any);
        const quotation = await getQuotation(request.params.id, {
          includePdfs: false,
        });
        return reply.send({
          ...result,
          quotation: toFinanceQueueQuotation(quotation),
          notificationQueued: Boolean(result.notificationQueued),
        });
      } catch (error) {
        logPaymentError("payment.finance.confirm_payment.failed", error, {
          quotationId: request.params.id,
          actor:
            (request as AuthedRequest).financeUser?.email || null,
        });
        return reply.code(400).send({
          error: errorMessage(error, "Could not confirm payment."),
        });
      }
    },
  );

  app.post<{ Params: IdParams }>(
    "/quotations/:id/resend-welcome-email",
    { preHandler: requireFinanceAuth },
    async (request, reply) => {
      try {
        const result = await resendCustomerWelcomeEmail(request.params.id, {
          source: "finance_resend",
        });
        const quotation = await getQuotation(request.params.id);
        return reply.send({
          ...result,
          quotation,
          notificationQueued: Boolean(result.notificationQueued),
          passwordRotated: true,
        });
      } catch (error) {
        return reply.code(400).send({
          error: errorMessage(error, "Could not resend welcome email."),
        });
      }
    },
  );

  app.post<{ Params: IdParams }>(
    "/quotations/:id/resend-finance-alert",
    { preHandler: requireFinanceAuth },
    async (request, reply) => {
      try {
        const result = await resendFinancePaymentAlert(request.params.id, {
          source: "finance_resend",
        });
        const quotation = await getQuotation(request.params.id);
        return reply.send({
          ...result,
          quotation,
          notificationQueued: Boolean(result.notificationQueued),
        });
      } catch (error) {
        return reply.code(400).send({
          error: errorMessage(error, "Could not resend finance alert."),
        });
      }
    },
  );

  app.post<{ Params: IdParams; Body: AnyBody }>(
    "/quotations/:id/mark-paid",
    { preHandler: requireFinanceAuth },
    async (request, reply) => {
      try {
        const body = request.body || {};
        const user = financeUser(request);
        const billingBranchId =
          typeof body.billingBranchId === "string" &&
          body.billingBranchId.trim()
            ? body.billingBranchId.trim()
            : null;
        const paymentMethod =
          String(body.paymentMethod || body.source || "bank_transfer").trim() ||
          "bank_transfer";
        const userReference = body.providerPaymentId || body.reference;
        const providerPaymentId =
          userReference != null && String(userReference).trim()
            ? assertValidUtr(String(userReference).trim(), "Payment reference")
            : `${paymentMethod}_${user.email}_${Date.now()}`;

        let quotation = await getQuotation(request.params.id, {
          includePdfs: false,
        });
        if (!quotation) {
          return reply.code(404).send({ error: "Quotation not found." });
        }
        if (!quotation.payment) {
          quotation = await ensureOfflineBankTransferPayment(quotation);
        }

        const result = (await markQuotationPaymentPaid({
          quotationId: request.params.id,
          billingBranchId: billingBranchId as any,
          providerPaymentId: providerPaymentId as any,
          source: paymentMethod,
          paidAt: body.paidAt || new Date(),
          financeConfirmedBy: user.email as any,
          sendNotifications: body.notify !== false,
          deferNotifications: true,
          awaitFulfillment: false,
        }) as any);
        quotation = await getQuotation(request.params.id, {
          includePdfs: false,
        });
        return reply.send({
          ...result,
          quotation: toFinanceQueueQuotation(quotation),
          notificationQueued: Boolean(result.notificationQueued),
        });
      } catch (error) {
        return reply.code(400).send({
          error: errorMessage(error, "Could not mark quotation as paid."),
        });
      }
    },
  );

  app.post<{ Params: IdParams }>(
    "/quotations/:id/sync-payment",
    { preHandler: requireFinanceAuth },
    async (request, reply) => {
      try {
        const quotation = await getQuotation(request.params.id);
        if (!quotation) {
          return reply.code(404).send({ error: "Quotation not found." });
        }

        const user = financeUser(request);
        const syncCompany =
          (quotation.lead as any)?.companyName ||
          (quotation.lead as any)?.company_name ||
          null;
        logPayment("payment.sync.start", {
          quotationId: request.params.id,
          companyName: syncCompany,
          provider: quotation.payment?.provider || null,
          paymentStatus: quotation.payment?.status || null,
          actor: user.email,
          source: "sync",
        });

        if (quotation.payment?.provider === "razorpay") {
          const result = await syncRazorpayQuotationPayment(quotation);
          logPayment("payment.sync.complete", {
            quotationId: request.params.id,
            companyName: syncCompany,
            provider: "razorpay",
            actor: user.email,
            source: "sync",
            synced: result.synced,
            alreadyPaid: (result as any).alreadyPaid,
            reason: (result as any).reason || null,
          });
          const refreshed = await getQuotation(request.params.id);
          return reply.send({ ...result, quotation: refreshed });
        }

        if (quotation.payment?.provider === "stripe") {
          const result = await syncStripeQuotationPayment(quotation);
          logPayment("payment.sync.complete", {
            quotationId: request.params.id,
            companyName: syncCompany,
            provider: "stripe",
            actor: user.email,
            source: "sync",
            synced: result.synced,
            alreadyPaid: (result as any).alreadyPaid,
            reason: (result as any).reason || null,
          });
          const refreshed = await getQuotation(request.params.id);
          return reply.send({ ...result, quotation: refreshed });
        }

        return reply.code(400).send({
          error:
            "Payment sync is only available for Stripe or Razorpay payment links.",
        });
      } catch (error) {
        logPaymentError("quotation.sync_payment.failed", error, {
          quotationId: request.params.id,
        });
        return reply.code(400).send({
          error: errorMessage(error, "Could not sync payment status."),
        });
      }
    },
  );

  app.get<{ Params: LeadParams }>(
    "/quotations/payment/:leadId",
    async (request, reply) => {
      try {
        await syncLeadCustomerFulfillment(request.params.leadId);
        const quotation = await getApprovedQuotationPayment(
          request.params.leadId,
        );

        if (!quotation?.payment || !hasAllBranchPaymentLinks(quotation.payment)) {
          return reply
            .code(404)
            .send({ error: "No payment link found for this customer." });
        }

        return reply.send({
          leadId: quotation.leadId,
          quotationId: quotation.id,
          quotation,
          companyName: (quotation.lead as any)?.companyName || "",
          payment: quotation.payment,
          fileName: quotation.fileName,
          hasInvoice: Boolean(quotation.pdfBase64),
        });
      } catch (error) {
        return reply.code(500).send({
          error: errorMessage(error, "Could not load payment."),
        });
      }
    },
  );

  app.post<{ Body: AnyBody }>(
    "/quotations",
    { preHandler: requireSalesWorkspaceAuth },
    async (request, reply) => {
      try {
        const body = request.body || {};
        const leadId = body.leadId;
        if (!leadId) {
          return reply.code(400).send({ error: "leadId is required." });
        }
        if (!(await authorize(request, reply, leadId, "create"))) return;

        const { quotations } = await createQuotationsForFinance(body);
        return reply.code(201).send({
          quotations,
          quotation: quotations[0] || null,
          count: quotations.length,
        });
      } catch (error) {
        return reply.code(400).send({
          error: errorMessage(error, "Could not create quotation."),
        });
      }
    },
  );

  app.get(
    "/quotations/statuses",
    { preHandler: requireAuth },
    async (_request, reply) => {
      try {
        const statuses = await listQuotationStatuses();
        return reply.send({ statuses });
      } catch (error) {
        return reply.code(500).send({
          error: errorMessage(error, "Could not load quotation statuses."),
        });
      }
    },
  );

  app.get(
    "/quotations",
    { preHandler: requireFinanceAuth },
    async (_request, reply) => {
      try {
        const quotations = await listQuotations();
        return reply.send({ quotations });
      } catch (error) {
        return reply.code(500).send({
          error: errorMessage(error, "Could not load quotations."),
        });
      }
    },
  );

  app.get<{ Params: IdParams }>(
    "/quotations/:id",
    { preHandler: requireFinanceAuth },
    async (request, reply) => {
      try {
        const quotation = await getQuotation(request.params.id);
        if (!quotation) {
          return reply.code(404).send({ error: "Quotation not found." });
        }
        return reply.send(quotation);
      } catch (error) {
        return reply.code(500).send({
          error: errorMessage(error, "Could not load quotation."),
        });
      }
    },
  );

  app.post<{ Params: IdParams; Body: AnyBody }>(
    "/quotations/:id/approve",
    { preHandler: requireFinanceAuth },
    async (request, reply) => {
      const quotationId = request.params.id;
      const note = request.body?.note || "";
      const paymentProvider =
        String(request.body?.paymentProvider || "")
          .trim()
          .toLowerCase() || null;

      if (
        paymentProvider &&
        paymentProvider !== "stripe" &&
        paymentProvider !== "razorpay"
      ) {
        return reply
          .code(400)
          .send({ error: "Payment provider must be stripe or razorpay." });
      }

      try {
        const user = financeUser(request);
        let quotation = await getQuotation(quotationId, { includePdfs: false });
        if (!quotation) {
          return reply.code(404).send({ error: "Quotation not found." });
        }

        logPayment("quotation.approve.start", {
          quotationId,
          companyName:
            (quotation.lead as any)?.companyName ||
            (quotation.lead as any)?.company_name ||
            null,
          reviewer: user.email,
          actor: user.email,
          paymentProvider,
          provider: paymentProvider,
        });

        if (isBillingChangePhase(quotation.billingPhase)) {
          if (quotation.status === QUOTATION_STATUSES.PAID) {
            return reply.send({
              quotation: toFinanceQueueQuotation(quotation),
              payment: null,
              notificationQueued: false,
              paymentLinkSent: false,
              offlinePayment: false,
              alreadyApproved: true,
              billingChangeApplied: true,
            });
          }

          quotation = await approveBillingChangeQuotation(
            quotationId,
            user.email,
            note,
          );
          if (!quotation) {
            return reply.code(404).send({ error: "Quotation not found." });
          }

          logPayment("quotation.approve.billing_change_success", {
            quotationId,
            billingPhase: quotation.billingPhase,
            status: quotation.status,
          });

          return reply.send({
            quotation: toFinanceQueueQuotation(quotation),
            payment: null,
            notificationQueued: false,
            paymentLinkSent: false,
            offlinePayment: false,
            billingChangeApplied: true,
            billingChangeLabel: billingChangePhaseLabel(
              quotation.billingPhase,
            ),
          });
        }

        const { provider: resolvedProvider, policy } =
          applyPaymentProviderPolicy(quotation, (paymentProvider as any));
        const temporaryLead = isTemporaryQuotation(quotation);
        const offlinePayment = policy.mode === "offline";
        const zeroValueInvoice = policy.mode === "zero";
        const hasPaymentLink = hasAllBranchPaymentLinks(quotation.payment);
        const alreadyPaid =
          quotation.status === QUOTATION_STATUSES.PAID ||
          String((quotation as any).payment?.status || "").toLowerCase() === "paid";

        if (
          quotation.status === QUOTATION_STATUSES.APPROVED &&
          (hasPaymentLink || offlinePayment || temporaryLead || alreadyPaid)
        ) {
          if (offlinePayment && !temporaryLead && !quotation.payment) {
            quotation = await ensureOfflineBankTransferPayment(quotation);
          }
          return reply.send({
            quotation: toFinanceQueueQuotation(quotation),
            payment: (quotation as any).payment,
            notificationQueued: false,
            paymentLinkSent: temporaryLead || zeroValueInvoice ? false : hasPaymentLink,
            offlinePayment: temporaryLead || zeroValueInvoice ? false : offlinePayment,
            temporaryLead,
            zeroValueInvoice,
            alreadyApproved: true,
          });
        }

        if (
          quotation.status === QUOTATION_STATUSES.APPROVED &&
          !hasPaymentLink
        ) {
          if (temporaryLead) {
            return reply.send({
              quotation: toFinanceQueueQuotation(quotation),
              payment: (quotation as any).payment || null,
              notificationQueued: false,
              paymentLinkSent: false,
              temporaryLead: true,
              alreadyApproved: true,
            });
          }

          if (zeroValueInvoice) {
            const fulfilled = await fulfillZeroValueQuotation(quotationId, {
              financeConfirmedBy: user.email,
              awaitFulfillment: true,
            });
            publishQuotationApprovedEvent(fulfilled.quotation);
            logPayment("quotation.approve.zero_value_retry_success", {
              quotationId,
              status: fulfilled.quotation?.status || null,
            });
            return reply.send({
              quotation: toFinanceQueueQuotation(fulfilled.quotation),
              payment: fulfilled.payment,
              notificationQueued: fulfilled.notificationQueued !== false,
              paymentLinkSent: false,
              offlinePayment: false,
              zeroValueInvoice: true,
              retriedPaymentLink: false,
            });
          }

          if (offlinePayment) {
            quotation = await ensureOfflineBankTransferPayment(quotation);
            publishQuotationApprovedEvent(quotation);
            const notificationQueued = await queueOfflineEmail(quotationId);
            return reply.send({
              quotation: toFinanceQueueQuotation(quotation),
              payment: (quotation as any).payment || null,
              notificationQueued,
              paymentLinkSent: false,
              offlinePayment: true,
              retriedPaymentLink: false,
            });
          }

          try {
            const issued = await issuePaymentLinkBounded(
              quotationId,
              resolvedProvider,
            );
            if (!issued) {
              return reply.code(404).send({ error: "Quotation not found." });
            }

            logPayment("quotation.approve.payment_link_retry.success", {
              quotationId,
              paymentLinkId: issued.payment?.paymentLinkId || null,
              provider: resolvedProvider,
            });
            publishQuotationApprovedEvent(issued.quotation);
            const notificationQueued = await queueApprovedEmail(quotationId);
            return reply.send({
              quotation: toFinanceQueueQuotation(issued.quotation),
              payment: issued.payment,
              notificationQueued,
              paymentLinkSent: hasAllBranchPaymentLinks(issued.payment),
              offlinePayment: false,
              retriedPaymentLink: true,
            });
          } catch (paymentError) {
            logPaymentError(
              "quotation.approve.payment_link_retry_failed",
              paymentError,
              { quotationId, status: quotation.status },
            );
            const status = isPaymentLinkTimeoutError(paymentError) ? 504 : 400;
            reply.code(status).send({
              error: errorMessage(
                paymentError,
                "Could not create payment link.",
              ),
            });
          }
          return;
        }

        if (quotation.status === QUOTATION_STATUSES.PAID && zeroValueInvoice) {
          return reply.send({
            quotation: toFinanceQueueQuotation(quotation),
            payment: (quotation as any).payment || null,
            notificationQueued: false,
            paymentLinkSent: false,
            zeroValueInvoice: true,
            alreadyApproved: true,
          });
        }

        if (quotation.status !== QUOTATION_STATUSES.PENDING) {
          return reply.code(400).send({
            error: `Cannot approve quotation in status "${quotation.status}". Refresh the queue and try again.`,
          });
        }

        quotation = await approveQuotation(quotationId, user.email, note, {
          deferEvent: true,
        });
        logPayment("quotation.approve.db_committed", {
          quotationId,
          status: quotation?.status || null,
          offlinePayment,
          temporaryLead,
          zeroValueInvoice,
          paymentProvider: resolvedProvider,
        });

        if (temporaryLead) {
          publishQuotationApprovedEvent(quotation);
          logPayment("quotation.approve.temporary_success", {
            quotationId,
            companyName:
              ((quotation as any).lead as any)?.companyName ||
              ((quotation as any).lead as any)?.company_name ||
              null,
            amount: policy.grandTotal,
            grandTotal: policy.grandTotal,
            currency: policy.currency,
          });
          return reply.send({
            quotation: toFinanceQueueQuotation(quotation),
            payment: (quotation as any).payment || null,
            notificationQueued: false,
            paymentLinkSent: false,
            temporaryLead: true,
          });
        }

        if (zeroValueInvoice) {
          try {
            const fulfilled = await fulfillZeroValueQuotation(quotationId, {
              financeConfirmedBy: user.email,
              awaitFulfillment: true,
            });
            publishQuotationApprovedEvent(fulfilled.quotation);
            logPayment("quotation.approve.zero_value_success", {
              quotationId,
              companyName:
                ((fulfilled.quotation as any)?.lead as any)?.companyName ||
                ((fulfilled.quotation as any)?.lead as any)?.company_name ||
                null,
              amount: 0,
              grandTotal: 0,
              currency: policy.currency,
              status: fulfilled.quotation?.status || null,
            });
            return reply.send({
              quotation: toFinanceQueueQuotation(fulfilled.quotation),
              payment: fulfilled.payment,
              notificationQueued: fulfilled.notificationQueued !== false,
              paymentLinkSent: false,
              offlinePayment: false,
              zeroValueInvoice: true,
            });
          } catch (zeroError) {
            await revertQuotationApproval(quotationId);
            logPaymentError("quotation.approve.zero_value_failed", zeroError, {
              quotationId,
              revertedToPending: true,
            });
            return reply.code(400).send({
              error: errorMessage(
                zeroError,
                "Could not fulfill zero-value invoice. Quotation was reverted to pending — refresh the queue and retry.",
              ),
            });
          }
        }

        if (offlinePayment) {
          quotation = await ensureOfflineBankTransferPayment(quotation);
          publishQuotationApprovedEvent(quotation);
          logPayment("quotation.approve.offline_success", {
            quotationId,
            companyName:
              ((quotation as any).lead as any)?.companyName ||
              ((quotation as any).lead as any)?.company_name ||
              null,
            amount: policy.grandTotal,
            grandTotal: policy.grandTotal,
            currency: policy.currency,
          });
          const notificationQueued = await queueOfflineEmail(quotationId);
          return reply.send({
            quotation: toFinanceQueueQuotation(quotation),
            payment: (quotation as any).payment || null,
            notificationQueued,
            paymentLinkSent: false,
            offlinePayment: true,
          });
        }

        try {
          logPayment("quotation.approve.payment_link.start", {
            quotationId,
            companyName:
              ((quotation as any).lead as any)?.companyName ||
              ((quotation as any).lead as any)?.company_name ||
              null,
            provider: resolvedProvider,
            amount:
              (quotation as any).grandTotal ??
              (quotation as any).payment?.grandTotal ??
              null,
            currency:
              (quotation as any).currency || (quotation as any).payment?.currency || null,
          });
          const issued = await issuePaymentLinkBounded(
            quotationId,
            resolvedProvider,
          );
          quotation = (issued as any).quotation;
          const payment = (issued as any).payment;
          publishQuotationApprovedEvent(quotation);

          logPayment("quotation.approve.success", {
            quotationId,
            companyName:
              ((quotation as any).lead as any)?.companyName ||
              ((quotation as any).lead as any)?.company_name ||
              null,
            paymentLinkId: payment?.paymentLinkId || null,
            paymentLinkUrl: payment?.paymentLinkUrl || null,
            amount: payment?.grandTotal || null,
            grandTotal: payment?.grandTotal || null,
            currency: payment?.currency || null,
            provider: resolvedProvider,
          });
          const notificationQueued = await queueApprovedEmail(quotationId);
          return reply.send({
            quotation: toFinanceQueueQuotation(quotation),
            payment,
            notificationQueued,
            paymentLinkSent: hasAllBranchPaymentLinks(payment),
            offlinePayment: false,
          });
        } catch (paymentError) {
          await revertQuotationApproval(quotationId);
          logPaymentError(
            "quotation.approve.payment_link_failed",
            paymentError,
            { quotationId, revertedToPending: true },
          );
          const status = isPaymentLinkTimeoutError(paymentError) ? 504 : 400;
          reply.code(status).send({
            error: errorMessage(
              paymentError,
              "Could not create payment link. Quotation was reverted to pending — refresh the queue and retry.",
            ),
          });
        }
      } catch (error) {
        logPaymentError("quotation.approve.failed", error, { quotationId });
        const message = errorMessage(error, "Could not approve quotation.");
        const isClientError =
          /cannot approve|required|not found|invalid|must be|refresh the queue/i.test(
            message,
          );
        return reply.code(isClientError ? 400 : 500).send({
          error: message,
        });
      }
    },
  );

  app.post<{ Params: IdParams; Body: AnyBody }>(
    "/quotations/:id/reject",
    { preHandler: requireFinanceAuth },
    async (request, reply) => {
      const quotationId = request.params.id;
      try {
        const quotation = await rejectQuotation(
          quotationId,
          financeUser(request).email,
          request.body?.note || "",
        );
        if (!quotation) {
          return reply.code(404).send({ error: "Quotation not found." });
        }

        const notificationQueued = await queueRejectedEmail(quotationId);
        return reply.send({
          quotation: toFinanceQueueQuotation(quotation),
          notificationQueued,
        });
      } catch (error) {
        logPaymentError("quotation.reject.failed", error, { quotationId });
        const message = errorMessage(error, "Could not reject quotation.");
        const isClientError =
          /only pending|required|not found|invalid|must be|refresh the queue/i.test(
            message,
          );
        return reply.code(isClientError ? 400 : 500).send({
          error: message,
        });
      }
    },
  );

  /**
   * Sales withdraw of finance approval: cancel Stripe/Razorpay payment links and
   * move the quotation to Rejected so sales must re-submit a new invoice.
   */
  app.post<{ Params: IdParams; Body: AnyBody }>(
    "/quotations/:id/revert-approval",
    { preHandler: requireSalesWorkspaceAuth },
    async (request, reply) => {
      const quotationId = request.params.id;
      try {
        const existing = await getQuotation(quotationId, { includePdfs: false });
        if (!existing) {
          return reply.code(404).send({ error: "Quotation not found." });
        }

        const leadId = existing.leadId || (existing as any).lead?.id;
        if (!leadId) {
          return reply.code(400).send({ error: "Quotation has no lead." });
        }

        const access = await authorizeLeadModify(authUser(request), leadId);
        if (!access.ok) {
          return reply.code((access as any).status).send({ error: (access as any).error });
        }

        const quotation = await withdrawApprovedQuotationBySales(quotationId, {
          actorEmail: authUser(request).email,
          note: request.body?.note || "",
        });
        if (!quotation) {
          return reply.code(404).send({ error: "Quotation not found." });
        }

        logPayment("quotation.revert_approval.success", {
          quotationId,
          leadId: quotation.leadId,
          actor: authUser(request).email,
          status: quotation.status,
        });

        return reply.send({
          quotation: toFinanceQueueQuotation(quotation),
          payment: (quotation as any).payment || null,
        });
      } catch (error) {
        logPaymentError("quotation.revert_approval.failed", error, { quotationId });
        const message = errorMessage(error, "Could not revert invoice approval.");
        const isClientError =
          /only approved|cannot be reverted|no online|no payment|temporary|required|not found|invalid|permission/i.test(
            message,
          );
        return reply.code(isClientError ? 400 : 500).send({
          error: message,
        });
      }
    },
  );
};
