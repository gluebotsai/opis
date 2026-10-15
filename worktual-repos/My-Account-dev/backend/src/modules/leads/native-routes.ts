import type {
  FastifyPluginAsync,
  FastifyReply,
  FastifyRequest,
} from "fastify";

import {
  authorizeLeadView,
  authorizeQuotationCreate,
} from "../auth/access-control.js";
import { getSession } from "../auth/session-auth.js";
import {
  createSubscriptionBillingChange,
  listOpenQuotationsForLead,
} from "../billing/changes.js";
import { listBranchAddRequestsForLead } from "../branch-requests/add-requests.js";
import {
  CUSTOMER_ROLES,
  listOrganizationCustomerUsers,
  regenerateBranchPortalPassword,
  regenerateCustomerPortalPassword,
} from "../customer-portal/customer-auth.js";
import { resolvePortalLoginEmail } from "../../lib/customer-contact.js";
import {
  getCustomerProductRequestById,
  listCustomerProductRequestsForLead,
  materializeProductRequestNewBranches,
} from "../customer-product-requests/request-store.js";
import {
  assertSalesCanDeleteLead,
  hardDeleteCustomerByLeadId,
} from "../customer-portal/deletion.js";
import { pool } from "../../db/pool.js";
import {
  canUserModifyLead,
  canUserViewLead,
  createLead,
  getLeadById,
  getLeadOwnership,
  listLeads,
  updateLead,
} from "./lead-store.js";
import {
  ensureOrganizationForPaidLead,
  refreshOrganizationLocationsFromLead,
} from "../organizations/organization-store.js";
import { getPartnerSession } from "../partners/partner-auth.js";
import { getResellerSession } from "../resellers/reseller-auth.js";
import { resendCustomerWelcomeEmail } from "../payments/fulfillment.js";
import {
  extendUatAccess,
  listGoLiveForLead,
  sendUatAccess,
} from "../product-go-live/go-live-store.js";
import {
  getApprovedQuotationPayment,
  getLeadPaidPayments,
  getQuotation,
  getQuotationInvoiceForLead,
  toFinanceQueueQuotation,
} from "../quotations/quotation-store.js";
import { queueUatCredentialsEmail } from "../../infra/notify.js";
import { logPaymentError } from "../../infra/file-logger.js";
import {
  assertLeadPhoneAvailable,
  validateLeadPayload,
} from "./contact-validation.js";

type AuthUser = {
  email?: string;
  role?: string;
  userId?: string | null;
  displayName?: string;
  partnerId?: string;
  resellerId?: string;
};

type AuthedRequest = FastifyRequest & {
  authUser?: AuthUser;
  partnerUser?: unknown;
  resellerUser?: unknown;
};

type IdParams = { id: string };
type ProductRequestParams = IdParams & { requestId: string };
type SubscriptionParams = IdParams & { subscriptionId: string };
type GoLiveParams = IdParams & { goLiveId: string };
type QuotationParams = IdParams & { quotationId: string };
type BranchParams = IdParams & { branchId: string };
type AnyBody = Record<string, any>;
type AnyQuery = Record<string, any>;
type StatusError = Error & { status?: number; contactConflict?: unknown };

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

async function requireLeadContactValidationAuth(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  try {
    const token = bearerToken(request);
    const session = await getSession(token);
    if (
      session &&
      (session.role === "sales" ||
        session.role === "sales_admin" ||
        session.role === "admin")
    ) {
      (request as AuthedRequest).authUser = session;
      return;
    }

    if (token) {
      const partnerSession = await getPartnerSession(token);
      if (partnerSession) {
        const authedRequest = request as AuthedRequest;
        authedRequest.partnerUser = partnerSession;
        authedRequest.authUser = {
          email: (partnerSession.email as any),
          role: "partner",
          userId: (partnerSession.partnerUserId as any),
          partnerId: (partnerSession.partnerId as any),
          displayName: (partnerSession.displayName || "" as any),
        };
        return;
      }

      const resellerSession = await getResellerSession(token);
      if (resellerSession) {
        const authedRequest = request as AuthedRequest;
        authedRequest.resellerUser = resellerSession;
        authedRequest.authUser = {
          email: (resellerSession.email as any),
          role: "reseller",
          userId: (resellerSession.resellerUserId as any),
          resellerId: (resellerSession.resellerId as any),
          displayName: (resellerSession.displayName || "" as any),
        };
        return;
      }
    }

    return reply.code(401).send({ error: "Authentication required." });
  } catch (error) {
    return reply.code(500).send({
      error: error instanceof Error ? error.message : "Authentication failed.",
    });
  }
}

function authUser(request: FastifyRequest): AuthUser {
  return (request as AuthedRequest).authUser as AuthUser;
}

function statusOf(error: unknown, fallback = 400): number {
  return (error as StatusError | null)?.status || fallback;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function leadContactErrorBody(error: unknown, fallback: string) {
  const body: { error: string; contactConflict?: unknown } = {
    error: errorMessage(error, fallback),
  };
  const conflict = (error as StatusError | null)?.contactConflict;
  if (conflict) {
    body.contactConflict = conflict;
  }
  return body;
}

async function authorizeView(
  request: FastifyRequest,
  reply: FastifyReply,
  leadId: string,
): Promise<boolean> {
  const access = await authorizeLeadView(authUser(request), leadId);
  if (access.ok) {
    return true;
  }
  reply.code((access as any).status).send({ error: (access as any).error });
  return false;
}

export const nativeLeadsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("x-route-host", "fastify");
    return payload;
  });

  app.get<{ Querystring: AnyQuery }>(
    "/",
    { preHandler: requireAuth },
    async (request, reply) => {
      try {
        const user = authUser(request);
        const scope = String(request.query.scope || "").toLowerCase();
        let createdByUserId = null;

        if (user.role === "sales") {
          createdByUserId = user.userId || null;
          if (!createdByUserId) {
            return reply.send({ leads: [] });
          }
        } else if (user.role === "sales_admin" && scope === "mine") {
          createdByUserId = user.userId || null;
          if (!createdByUserId) {
            return reply.send({ leads: [] });
          }
        }

        const pipelineOnly =
          String(request.query.pipelineOnly || "").toLowerCase() === "true";
        const leadKindRaw = String(request.query.leadKind || "").toLowerCase();
        const leadKind = leadKindRaw === "temporary" ? "temporary" : null;
        const leads = (await listLeads({ createdByUserId, pipelineOnly, leadKind }) as any);
        return reply.send({ leads });
      } catch (error) {
        return reply.code(500).send({
          error: errorMessage(error, "Could not load leads."),
        });
      }
    },
  );

  app.get<{ Params: IdParams }>(
    "/:id/product-requests",
    { preHandler: requireAuth },
    async (request, reply) => {
      try {
        if (!(await authorizeView(request, reply, request.params.id))) return;
        const requests = await listCustomerProductRequestsForLead(
          request.params.id,
        );
        return reply.send({ requests });
      } catch (error) {
        return reply.code(500).send({
          error: errorMessage(error, "Could not load product requests."),
        });
      }
    },
  );

  app.get<{ Params: IdParams }>(
    "/:id/branch-add-requests",
    { preHandler: requireAuth },
    async (request, reply) => {
      try {
        if (!(await authorizeView(request, reply, request.params.id))) return;
        const requests = await listBranchAddRequestsForLead(request.params.id);
        return reply.send({ requests });
      } catch (error) {
        return reply.code(500).send({
          error: errorMessage(error, "Could not load branch add requests."),
        });
      }
    },
  );

  app.post<{ Params: ProductRequestParams }>(
    "/:id/product-requests/:requestId/materialize-branches",
    { preHandler: requireAuth },
    async (request, reply) => {
      try {
        if (!(await authorizeView(request, reply, request.params.id))) return;
        const productRequest = await getCustomerProductRequestById(
          request.params.requestId,
        );
        if (!productRequest) {
          return reply.code(404).send({ error: "Product request not found." });
        }
        if (
          String(productRequest.sourceLeadId) !== String(request.params.id)
        ) {
          return reply
            .code(400)
            .send({ error: "Product request does not belong to this lead." });
        }

        const result = await materializeProductRequestNewBranches(
          request.params.requestId,
        );
        const lead = await getLeadById(request.params.id);
        return reply.send({ result, lead });
      } catch (error) {
        return reply.code(400).send({
          error: errorMessage(error, "Could not materialize new branches."),
        });
      }
    },
  );

  app.get<{ Params: IdParams }>(
    "/:id/paid-payments",
    { preHandler: requireAuth },
    async (request, reply) => {
      try {
        const ownership = await getLeadOwnership(request.params.id);
        if (!ownership) {
          return reply.code(404).send({ error: "Lead not found." });
        }
        if (!canUserViewLead(authUser(request), ownership)) {
          return reply
            .code(403)
            .send({ error: "You do not have permission to view this lead." });
        }

        void import("../payments/leadFulfillment.js")
          .then(({ syncLeadCustomerFulfillment }) =>
            syncLeadCustomerFulfillment(request.params.id),
          )
          .catch((error: unknown) => {
            request.log.warn(
              { err: error, leadId: request.params.id },
              "Background fulfillment sync deferred for paid-payments",
            );
          });

        const payments = await getLeadPaidPayments(request.params.id);
        return reply.send({ leadId: request.params.id, payments });
      } catch (error) {
        return reply.code(500).send({
          error: errorMessage(error, "Could not load paid payments."),
        });
      }
    },
  );

  app.get<{ Params: IdParams }>(
    "/:id/open-quotations",
    { preHandler: requireAuth },
    async (request, reply) => {
      try {
        const ownership = await getLeadOwnership(request.params.id);
        if (!ownership) {
          return reply.code(404).send({ error: "Lead not found." });
        }
        if (!canUserViewLead(authUser(request), ownership)) {
          return reply
            .code(403)
            .send({ error: "You do not have permission to view this lead." });
        }
        const quotations = await listOpenQuotationsForLead(request.params.id);
        return reply.send({ leadId: request.params.id, quotations });
      } catch (error) {
        return reply.code(500).send({
          error: errorMessage(error, "Could not load open quotations."),
        });
      }
    },
  );

  app.post<{ Params: SubscriptionParams; Body: AnyBody }>(
    "/:id/subscriptions/:subscriptionId/billing-changes",
    { preHandler: requireSalesWorkspaceAuth },
    async (request, reply) => {
      try {
        const access = await authorizeQuotationCreate(
          authUser(request),
          request.params.id,
        );
        if (!access.ok) {
          return reply.code((access as any).status).send({ error: (access as any).error });
        }

        const quotation = await createSubscriptionBillingChange({
          leadId: request.params.id,
          subscriptionId: request.params.subscriptionId,
          type: request.body?.type,
          proposedMonthlyPrice: request.body?.proposedMonthlyPrice,
          note: request.body?.note || "",
          submittedBy: authUser(request).email || "",
        });
        return reply
          .code(201)
          .send({ quotation: toFinanceQueueQuotation(quotation) });
      } catch (error) {
        return reply.code(statusOf(error)).send({
          error: errorMessage(error, "Could not create billing change."),
        });
      }
    },
  );

  app.get<{ Params: IdParams }>(
    "/:id/go-live",
    { preHandler: requireAuth },
    async (request, reply) => {
      try {
        const ownership = await getLeadOwnership(request.params.id);
        if (!ownership) {
          return reply.code(404).send({ error: "Lead not found." });
        }
        if (!canUserViewLead(authUser(request), ownership)) {
          return reply
            .code(403)
            .send({ error: "You do not have permission to view this lead." });
        }
        const products = await listGoLiveForLead(request.params.id);
        return reply.send({ leadId: request.params.id, products });
      } catch (error) {
        return reply.code(500).send({
          error: errorMessage(error, "Could not load go-live products."),
        });
      }
    },
  );

  app.post<{ Params: GoLiveParams; Body: AnyBody }>(
    "/:id/go-live/:goLiveId/send-uat",
    { preHandler: requireSalesWorkspaceAuth },
    async (request, reply) => {
      try {
        const ownership = await getLeadOwnership(request.params.id);
        if (!ownership) {
          return reply.code(404).send({ error: "Lead not found." });
        }
        if (!canUserViewLead(authUser(request), ownership)) {
          return reply
            .code(403)
            .send({ error: "You do not have permission to update this lead." });
        }
        const product = await sendUatAccess({
          goLiveId: request.params.goLiveId,
          leadId: request.params.id,
          credentials: request.body?.credentials || {},
          note: request.body?.note || "",
          durationDays: request.body?.durationDays,
        });
        if (!product?.id) {
          return reply.code(400).send({ error: "Could not send UAT access." });
        }
        let notificationQueued = false;
        try {
          await queueUatCredentialsEmail(product.id);
          notificationQueued = true;
        } catch (notificationError) {
          logPaymentError("product.uat.notification_failed", notificationError, {
            goLiveId: product.id,
            leadId: request.params.id,
          });
        }
        return reply.send({ product, notificationQueued });
      } catch (error) {
        return reply.code(400).send({
          error: errorMessage(error, "Could not send UAT access."),
        });
      }
    },
  );

  app.post<{ Params: GoLiveParams; Body: AnyBody }>(
    "/:id/go-live/:goLiveId/extend-uat",
    { preHandler: requireSalesWorkspaceAuth },
    async (request, reply) => {
      try {
        const ownership = await getLeadOwnership(request.params.id);
        if (!ownership) {
          return reply.code(404).send({ error: "Lead not found." });
        }
        if (!canUserViewLead(authUser(request), ownership)) {
          return reply
            .code(403)
            .send({ error: "You do not have permission to update this lead." });
        }
        const product = await extendUatAccess({
          goLiveId: request.params.goLiveId,
          leadId: request.params.id,
          credentials: request.body?.credentials || null,
          note: request.body?.note || "",
          durationDays: request.body?.durationDays,
        });
        if (!product?.id) {
          return reply.code(400).send({ error: "Could not extend UAT." });
        }
        let notificationQueued = false;
        try {
          await queueUatCredentialsEmail(product.id);
          notificationQueued = true;
        } catch (notificationError) {
          logPaymentError("product.uat.extend_notification_failed", notificationError, {
            goLiveId: product.id,
            leadId: request.params.id,
          });
        }
        return reply.send({ product, notificationQueued });
      } catch (error) {
        return reply.code(400).send({
          error: errorMessage(error, "Could not extend UAT."),
        });
      }
    },
  );

  app.get<{ Params: QuotationParams; Querystring: AnyQuery }>(
    "/:id/quotations/:quotationId/invoice",
    { preHandler: requireAuth },
    async (request, reply) => {
      try {
        const ownership = await getLeadOwnership(request.params.id);
        if (!ownership) {
          return reply.code(404).send({ error: "Lead not found." });
        }
        if (!canUserViewLead(authUser(request), ownership)) {
          return reply
            .code(403)
            .send({ error: "You do not have permission to view this lead." });
        }

        const view = String(request.query.view || "").trim().toLowerCase();
        const invoice = await getQuotationInvoiceForLead(
          request.params.id,
          request.params.quotationId,
          { includeProductSplit: view === "by_product" || view === "product" },
        );
        if (!invoice) {
          return reply
            .code(404)
            .send({ error: "Invoice not found for this customer." });
        }
        return reply.send({ invoice });
      } catch (error) {
        return reply.code(500).send({
          error: errorMessage(error, "Could not load invoice."),
        });
      }
    },
  );

  app.get<{ Params: IdParams }>(
    "/:id",
    { preHandler: requireAuth },
    async (request, reply) => {
      try {
        const ownership = await getLeadOwnership(request.params.id);
        if (!ownership) {
          return reply.code(404).send({ error: "Lead not found." });
        }
        if (!canUserViewLead(authUser(request), ownership)) {
          return reply
            .code(403)
            .send({ error: "You do not have permission to view this lead." });
        }

        void import("../payments/leadFulfillment.js")
          .then(({ syncLeadCustomerFulfillment }) =>
            syncLeadCustomerFulfillment(request.params.id),
          )
          .catch((error: unknown) => {
            request.log.warn(
              { err: error, leadId: request.params.id },
              "Background fulfillment sync deferred for lead",
            );
          });

        const lead = await getLeadById(request.params.id);
        if (!lead) {
          return reply.code(404).send({ error: "Lead not found." });
        }
        return reply.send({ lead });
      } catch (error) {
        return reply.code(500).send({
          error: errorMessage(error, "Could not load lead."),
        });
      }
    },
  );

  app.post<{ Params: IdParams }>(
    "/:id/customer-portal-access",
    { preHandler: requireAuth },
    async (request, reply) => {
      try {
        if (!(await authorizeView(request, reply, request.params.id))) return;
        const lead = await getLeadById(request.params.id);
        if (!lead) {
          return reply.code(404).send({ error: "Lead not found." });
        }
        if (lead.status !== "Paid") {
          return reply.code(400).send({
            error:
              "Customer portal access is available after payment is recorded.",
          });
        }

        const client = await pool.connect();
        try {
          const { organization } = await ensureOrganizationForPaidLead(
            request.params.id,
            client,
          );
          if (!organization) {
            return reply
              .code(404)
              .send({ error: "Organization not found for this lead." });
          }
          const portalAccess = await regenerateCustomerPortalPassword(
            client,
            organization.id,
            {
              workEmail: lead.workEmail,
              adminEmail: lead.adminEmail,
              contactName: lead.contactName,
            },
          );
          if (!portalAccess) {
            return reply.code(400).send({
              error:
                "Lead must have a work email or admin email for customer portal access.",
            });
          }
          const loginUrl = `${String(
            process.env.APP_URL || "http://localhost:5173",
          ).replace(/\/$/, "")}/`;
          return reply.send({
            loginUrl,
            loginEmail: resolvePortalLoginEmail(lead),
            email: portalAccess.email,
            role: portalAccess.role || "branch_user",
            temporaryPassword: portalAccess.temporaryPassword,
            organizationId: organization.id,
            userCreated: portalAccess.created,
          });
        } finally {
          client.release();
        }
      } catch (error) {
        return reply.code(500).send({
          error: errorMessage(
            error,
            "Could not provision customer portal access.",
          ),
        });
      }
    },
  );

  app.get<{ Params: IdParams }>(
    "/:id/customer-portal-users",
    { preHandler: requireAuth },
    async (request, reply) => {
      try {
        if (!(await authorizeView(request, reply, request.params.id))) return;
        const lead = await getLeadById(request.params.id);
        if (!lead) {
          return reply.code(404).send({ error: "Lead not found." });
        }
        if (lead.status !== "Paid") {
          return reply.code(400).send({
            error:
              "Customer portal access is available after payment is recorded.",
          });
        }

        const client = await pool.connect();
        try {
          const { organization } = await ensureOrganizationForPaidLead(
            request.params.id,
            client,
          );
          if (!organization) {
            return reply
              .code(404)
              .send({ error: "Organization not found for this lead." });
          }
          const locations = await refreshOrganizationLocationsFromLead(
            client,
            request.params.id,
            organization.id,
          );
          const users = await listOrganizationCustomerUsers(
            organization.id,
            (client as any),
          );
          return reply.send({
            organizationId: organization.id,
            locations: (locations || []).filter(
              (location: AnyBody) =>
                (location.status || "active") !== "inactive",
            ),
            users,
          });
        } finally {
          client.release();
        }
      } catch (error) {
        return reply.code(500).send({
          error: errorMessage(error, "Could not load customer portal users."),
        });
      }
    },
  );

  app.post<{ Params: BranchParams }>(
    "/:id/customer-portal-access/branches/:branchId",
    { preHandler: requireAuth },
    async (request, reply) => {
      try {
        if (!(await authorizeView(request, reply, request.params.id))) return;
        const lead = await getLeadById(request.params.id);
        if (!lead) {
          return reply.code(404).send({ error: "Lead not found." });
        }
        if (lead.status !== "Paid") {
          return reply.code(400).send({
            error:
              "Customer portal access is available after payment is recorded.",
          });
        }

        const client = await pool.connect();
        try {
          const { organization } = await ensureOrganizationForPaidLead(
            request.params.id,
            client,
          );
          if (!organization) {
            return reply
              .code(404)
              .send({ error: "Organization not found for this lead." });
          }
          const locations = await refreshOrganizationLocationsFromLead(
            client,
            request.params.id,
            organization.id,
          );
          const location = locations.find(
            (entry: AnyBody) => entry.id === request.params.branchId,
          );
          if (!location) {
            return reply
              .code(404)
              .send({ error: "Branch location not found for this customer." });
          }
          if (!String(location.workEmail || "").trim()) {
            return reply.code(400).send({
              error:
                "This branch has no work email. Add it in onboarding before enabling portal access.",
            });
          }
          const portalAccess = await regenerateBranchPortalPassword(
            client,
            organization.id,
            {
              branchId: location.id,
              email: location.workEmail,
              displayName: location.contactName || location.label || "",
            },
          );
          const loginUrl = `${String(
            process.env.APP_URL || "http://localhost:5173",
          ).replace(/\/$/, "")}/`;
          return reply.send({
            loginUrl,
            email: (portalAccess as any).email,
            role: CUSTOMER_ROLES.BRANCH_USER,
            branchId: location.id,
            branchLabel: location.label || "Branch",
            temporaryPassword: (portalAccess as any).temporaryPassword,
            organizationId: organization.id,
            userCreated: (portalAccess as any).created,
          });
        } finally {
          client.release();
        }
      } catch (error) {
        return reply.code(500).send({
          error: errorMessage(
            error,
            "Could not provision branch portal access.",
          ),
        });
      }
    },
  );

  app.post<{ Body: AnyBody }>(
    "/validate-contacts",
    { preHandler: requireLeadContactValidationAuth },
    async (request, reply) => {
      try {
        const body = request.body || {};
        const ignoreLeadId = body.leadId || body.id || null;
        if (body.phoneOnly) {
          await assertLeadPhoneAvailable(
            {
              mobileCountryCode: body.mobileCountryCode,
              mobileNumber: body.mobileNumber,
              phoneKind: body.phoneKind === "secondary" ? "secondary" : "mobile",
            },
            { ignoreLeadId },
          );
          return reply.send({ valid: true });
        }
        await validateLeadPayload(body, {
          ignoreLeadId,
          skipTaxValidation: Boolean(body.skipTaxValidation),
        });
        return reply.send({ valid: true });
      } catch (error) {
        return reply
          .code(400)
          .send(leadContactErrorBody(error, "Contact validation failed."));
      }
    },
  );

  app.post<{ Body: AnyBody }>(
    "/",
    { preHandler: requireAuth },
    async (request, reply) => {
      try {
        const user = authUser(request);
        if (user.role !== "sales" && user.role !== "sales_admin") {
          return reply.code(403).send({
            error: "Only sales and sales admin users can create leads.",
          });
        }
        const lead = await createLead(request.body || {}, {
          createdByUserId: user.userId || null,
        });
        return reply.code(201).send({ lead });
      } catch (error) {
        return reply
          .code(400)
          .send(leadContactErrorBody(error, "Could not create lead."));
      }
    },
  );

  app.put<{ Params: IdParams; Body: AnyBody }>(
    "/:id",
    { preHandler: requireAuth },
    async (request, reply) => {
      try {
        const ownership = await getLeadOwnership(request.params.id);
        if (!ownership) {
          return reply.code(404).send({ error: "Lead not found." });
        }
        if (!canUserModifyLead(authUser(request), ownership)) {
          return reply
            .code(403)
            .send({ error: "You do not have permission to update this lead." });
        }
        const lead = await updateLead(
          request.params.id,
          request.body || {},
        );
        if (!lead) {
          return reply.code(404).send({ error: "Lead not found." });
        }
        return reply.send({ lead });
      } catch (error) {
        return reply
          .code(400)
          .send(leadContactErrorBody(error, "Could not update lead."));
      }
    },
  );

  app.delete<{ Params: IdParams }>(
    "/:id",
    { preHandler: requireAuth },
    async (request, reply) => {
      try {
        const user = authUser(request);
        await assertSalesCanDeleteLead(user, request.params.id);
        const result = await hardDeleteCustomerByLeadId(request.params.id, {
          actor: ({
            type: "sales",
            userId: user.userId || null,
            email: user.email || null,
            role: user.role || null,
          } as any),
        });
        return reply.send({ ok: true, ...result });
      } catch (error) {
        return reply.code(statusOf(error)).send({
          error: errorMessage(error, "Could not delete customer."),
        });
      }
    },
  );

  app.post<{ Params: IdParams }>(
    "/:id/resend-welcome-email",
    { preHandler: requireAuth },
    async (request, reply) => {
      try {
        if (!(await authorizeView(request, reply, request.params.id))) return;
        const quotation = await getApprovedQuotationPayment(request.params.id);
        if (!quotation) {
          return reply
            .code(404)
            .send({ error: "No paid quotation found for this lead." });
        }
        if (
          quotation.status !== "Paid" ||
          quotation.payment?.status !== "paid"
        ) {
          return reply.code(400).send({
            error:
              "Welcome email can only be resent after payment is confirmed.",
          });
        }
        const result = await resendCustomerWelcomeEmail(quotation.id, {
          source: "sales_resend",
          actorUserId: (authUser(request).userId || null as any),
        });
        const refreshed = await getQuotation(quotation.id);
        return reply.send({
          ...result,
          quotation: refreshed,
          notificationQueued: Boolean(result.notificationQueued),
        });
      } catch (error) {
        return reply.code(400).send({
          error: errorMessage(error, "Could not resend welcome email."),
        });
      }
    },
  );
};
