import type {
  FastifyPluginAsync,
  FastifyReply,
  FastifyRequest,
  RouteHandlerMethod,
} from "fastify";

import {
  authorizeOrganizationView,
  authorizeSubscriptionModify,
  authorizeSubscriptionView,
} from "../auth/access-control.js";
import { getSession } from "../auth/session-auth.js";
import {
  createBranchAddRequest,
  listBranchAddRequestsForOrganization,
  withdrawBranchAddRequest,
} from "../branch-requests/add-requests.js";
import {
  createCustomerCancellationRequest,
  listCustomerCancellationRequests,
  REQUEST_KINDS,
  withdrawCancellationRequest,
} from "../branch-requests/cancellation-requests.js";
import { isBranchInactive } from "../branch-requests/lifecycle.js";
import { listSubscriptionInvoices } from "../billing/subscriptionInvoices.js";
import {
  assertCustomerSubscriptionAccess,
  changeCustomerPassword,
  getCustomerEntitlements,
  getCustomerSession,
  getCustomerSubscriptionScope,
  loginCustomerUser,
  logoutCustomerUser,
} from "./customer-auth.js";
import {
  getCustomerInvoice,
  listCustomerInvoices,
} from "../billing/customer-invoices.js";
import {
  cancelCustomerProductRequest,
  createCustomerProductRequest,
  listCustomerProductRequests,
  listOpenCustomerProductRequestsForSales,
  renotifyCustomerProductRequest,
  updateCustomerProductRequest,
} from "../customer-product-requests/request-store.js";
import { runWithOrganizationContext } from "../../db/tenantContext.js";
import {
  isDatabaseConnectivityError,
  isMissingDatabaseObjectError,
} from "../../db/pool.js";
import {
  queueBranchAddRequestedEmail,
  queueBranchCancellationRequestedEmail,
  queueSupportTicketCreatedEmails,
} from "../../infra/notify.js";
import {
  acceptGoLiveProducts,
} from "../product-go-live/acceptance.js";
import { publishTicketEvent } from "../../infra/events.js";
import {
  notifyCustomerProductRequest,
  notifyCustomerProductRequestCancelled,
} from "../notifications/service.js";
import {
  getOrganizationById,
} from "../organizations/organization-store.js";
import {
  listGoLiveForOrganization,
  requestGoLiveChanges,
} from "../product-go-live/go-live-store.js";
import { isSessionAlreadyActiveError } from "../auth/session-concurrency.js";
import {
  getSubscriptionById,
  getSubscriptionEntitlements,
  listSubscriptionsByOrganization,
} from "../subscriptions/subscription-store.js";
import {
  addCustomerTicketReply,
  addSalesTicketReply,
  createSupportTicket,
  getSupportTicketForOrganization,
  getSupportTicketForSalesUser,
  listSupportTicketsForOrganization,
  listSupportTicketsForSalesUser,
  updateSalesTicketStatus,
} from "../support-tickets/ticket-store.js";
import {
  getUsageMetricsForSubscription,
  reportUsageConsumption,
} from "../usage/usage-store.js";
import {
  buildCustomerPortfolio,
  listCustomersWithSubscriptions,
} from "./portfolio.js";

type AnyBody = Record<string, any>;
type AnyQuery = Record<string, any>;
type AnyPortalRequest = FastifyRequest<{
  Params: AnyBody;
  Querystring: AnyQuery;
  Body: AnyBody;
}>;
type IdParams = { id: string };
type GoLiveParams = { goLiveId: string };
type InvoiceParams = { quotationId: string };

type AuthUser = {
  email?: string;
  displayName?: string;
  role?: string;
  userId?: string | null;
};

type CustomerUser = {
  customerUserId: string;
  organizationId: string;
  email: string;
  displayName?: string;
  branchId?: string | null;
  mustChangePassword?: boolean;
};

type PortalRequest = FastifyRequest & {
  authUser?: AuthUser;
  customerUser?: CustomerUser;
};

type StatusError = Error & {
  status?: number;
  statusCode?: number;
  code?: string;
  existingRequest?: unknown;
  productId?: string | null;
  branchId?: string | null;
};

function bearerToken(request: FastifyRequest): string {
  const header = request.headers.authorization || "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function errorStatus(error: unknown, fallback = 500): number {
  const typed = error as StatusError | null;
  return Number(typed?.status || typed?.statusCode) || fallback;
}

async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  try {
    const session = await getSession(bearerToken(request));
    if (!session) {
      return reply.code(401).send({ error: "Authentication required." });
    }
    (request as PortalRequest).authUser = session;
  } catch (error) {
    return reply.code(500).send({
      error: errorMessage(error, "Authentication failed."),
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
    (request as PortalRequest).authUser = session;
  } catch (error) {
    return reply.code(500).send({
      error: errorMessage(error, "Authentication failed."),
    });
  }
}

function authUser(request: FastifyRequest): AuthUser {
  return (request as PortalRequest).authUser as AuthUser;
}

function customerUser(request: FastifyRequest): CustomerUser {
  return (request as PortalRequest).customerUser as CustomerUser;
}

const MUST_CHANGE_PASSWORD_ALLOWED_PATHS = new Set(["/api/v1/me/password"]);

function withCustomerAuth(
  handler: (request: AnyPortalRequest, reply: FastifyReply) => Promise<unknown>,
): RouteHandlerMethod {
  return async (request, reply) => {
    try {
      const session = await getCustomerSession(bearerToken(request));
      if (!session) {
        return reply
          .code(401)
          .send({ error: "Customer authentication required." });
      }
      const requestPath =
        String(
          (request as { routeOptions?: { url?: string } }).routeOptions?.url ||
            request.url ||
            "",
        ).split("?")[0] || "";
      if (
        session.mustChangePassword &&
        !MUST_CHANGE_PASSWORD_ALLOWED_PATHS.has(requestPath)
      ) {
        return reply.code(403).send({
          error: "Password change required before continuing.",
          code: "MUST_CHANGE_PASSWORD",
        });
      }
      (request as PortalRequest).customerUser = session as any;
      return await runWithOrganizationContext((session.organizationId as any), () =>
        handler(request as AnyPortalRequest, reply),
      );
    } catch (error) {
      request.log.error({ err: error }, "Customer portal request failed");
      return reply.code(errorStatus(error)).send({
        error: errorMessage(error, String(error)),
      });
    }
  };
}

async function authorizeStaff(
  request: FastifyRequest,
  reply: FastifyReply,
  authorize: (user: AuthUser, id: string) => Promise<AnyBody>,
  id: string,
): Promise<boolean> {
  const access = await authorize(authUser(request), id);
  if (access.ok) return true;
  reply.code(access.status).send({ error: access.error });
  return false;
}

function customerScopeUserId(user: AuthUser, scope: unknown): string | null {
  if (user.role === "sales") return user.userId || null;
  if (
    user.role === "sales_admin" &&
    String(scope || "").toLowerCase() === "mine"
  ) {
    return user.userId || null;
  }
  return null;
}

/** Head office sees all go-live rows; non-head only their branch. */
function scopeGoLiveProductsForCustomer(
  products: AnyBody[],
  entitlements: AnyBody | null | undefined,
) {
  if (entitlements?.user?.isHeadOffice) {
    return products;
  }
  const branchId = String(entitlements?.user?.branchId || "").trim();
  if (!branchId) {
    return [];
  }
  return products.filter(
    (entry) => String(entry?.branchId || "").trim() === branchId,
  );
}

export const nativeCustomerPortalRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("x-route-host", "fastify");
    return payload;
  });
  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error }, "Unhandled customer portal route error");
    return reply
      .code(errorStatus(error))
      .send({ error: errorMessage(error, String(error)) });
  });

  app.get(
    "/api/customer/go-live",
    withCustomerAuth(async (request, reply) => {
      try {
        const user = customerUser(request);
        const entitlements = await getCustomerEntitlements(user.customerUserId);
        const products = scopeGoLiveProductsForCustomer(
          await listGoLiveForOrganization(user.organizationId),
          entitlements,
        );
        return reply.send({ organizationId: user.organizationId, products });
      } catch (error) {
        return reply.code(500).send({
          error: errorMessage(error, "Could not load go-live products."),
        });
      }
    }),
  );

  app.post<{ Body: AnyBody }>(
    "/api/customer/go-live/accept",
    withCustomerAuth(async (request, reply) => {
      try {
        const user = customerUser(request);
        const entitlements = await getCustomerEntitlements(user.customerUserId);
        const products = scopeGoLiveProductsForCustomer(
          await listGoLiveForOrganization(user.organizationId),
          entitlements,
        );
        const selected = products.filter((entry: AnyBody) =>
          (request.body?.goLiveIds || []).includes(entry.id),
        );
        if (!selected.length) {
          return reply
            .code(400)
            .send({ error: "Select at least one product to accept." });
        }
        const primary = selected[0]!;
        const result = await acceptGoLiveProducts({
          leadId: primary.leadId,
          goLiveIds: selected.map((entry: AnyBody) => entry.id),
          acceptedBy: user.email || "customer",
        });
        let salesNotificationQueued = false;
        try {
          const { queueGoLiveAcceptedSalesEmail } = await import("../../infra/notify.js");
          await queueGoLiveAcceptedSalesEmail(result?.quotation?.id, result?.goLiveIds || []);
          salesNotificationQueued = true;
        } catch (notificationError) {
          console.warn(
            "[mail] go_live_accepted queue failed:",
            notificationError instanceof Error ? notificationError.message : notificationError,
          );
        }
        return reply.code(201).send({ ...result, salesNotificationQueued });
      } catch (error) {
        return reply.code(400).send({
          error: errorMessage(error, "Could not accept products for go-live."),
        });
      }
    }),
  );

  app.post<{ Params: GoLiveParams; Body: AnyBody }>(
    "/api/customer/go-live/:goLiveId/request-changes",
    withCustomerAuth(async (request, reply) => {
      try {
        const user = customerUser(request);
        const entitlements = await getCustomerEntitlements(user.customerUserId);
        const products = scopeGoLiveProductsForCustomer(
          await listGoLiveForOrganization(user.organizationId),
          entitlements,
        );
        if (
          !products.some(
            (entry: AnyBody) => entry.id === request.params.goLiveId,
          )
        ) {
          return reply
            .code(403)
            .send({ error: "Product is not in your organization." });
        }
        const product = await requestGoLiveChanges(
          request.params.goLiveId,
          request.body?.note || "",
        );
        return reply.send({ product });
      } catch (error) {
        return reply.code(400).send({
          error: errorMessage(error, "Could not submit change request."),
        });
      }
    }),
  );

  app.delete(
    "/api/customer/account",
    withCustomerAuth(async (_request, reply) =>
      reply.code(403).send({
        error:
          "Customer account deletion is staff-only. Contact Worktual support.",
      }),
    ),
  );

  app.get<{ Querystring: AnyQuery }>(
    "/api/customers",
    { preHandler: requireAuth },
    async (request, reply) => {
      try {
        const createdByUserId = customerScopeUserId(
          authUser(request),
          request.query.scope,
        );
        const customers = await listCustomersWithSubscriptions({
          createdByUserId,
        });
        return reply.send({ customers });
      } catch (error) {
        return reply.code(500).send({
          error: errorMessage(error, "Could not load customers."),
        });
      }
    },
  );

  app.get<{ Querystring: AnyQuery }>(
    "/api/customers/portfolio",
    { preHandler: requireAuth },
    async (request, reply) => {
      try {
        const createdByUserId = customerScopeUserId(
          authUser(request),
          request.query.scope,
        );
        const portfolio = await buildCustomerPortfolio({ createdByUserId });
        return reply.send({ portfolio });
      } catch (error) {
        return reply.code(500).send({
          error: errorMessage(error, "Could not load customer portfolio."),
        });
      }
    },
  );

  app.get<{ Querystring: AnyQuery }>(
    "/api/customers/product-requests",
    { preHandler: requireAuth },
    async (request, reply) => {
      try {
        const createdByUserId = customerScopeUserId(
          authUser(request),
          request.query.scope,
        );
        const requests = await listOpenCustomerProductRequestsForSales({
          createdByUserId,
        });
        return reply.send({ requests });
      } catch (error) {
        return reply.code(500).send({
          error: errorMessage(error, "Could not load product requests."),
        });
      }
    },
  );

  app.get<{ Params: IdParams }>(
    "/api/v1/organizations/:id",
    { preHandler: requireAuth },
    async (request, reply) => {
      try {
        if (
          !(await authorizeStaff(
            request,
            reply,
            authorizeOrganizationView,
            request.params.id,
          ))
        ) return;
        const organization = await getOrganizationById(request.params.id);
        if (!organization) {
          return reply
            .code(404)
            .send({ error: "Organization not found." });
        }
        return reply.send({ organization });
      } catch (error) {
        return reply.code(500).send({
          error: errorMessage(error, "Could not load organization."),
        });
      }
    },
  );

  app.get<{ Params: IdParams }>(
    "/api/v1/organizations/:id/subscriptions",
    { preHandler: requireAuth },
    async (request, reply) => {
      try {
        if (
          !(await authorizeStaff(
            request,
            reply,
            authorizeOrganizationView,
            request.params.id,
          ))
        ) return;
        const subscriptions = await listSubscriptionsByOrganization(
          request.params.id,
        );
        return reply.send({ subscriptions });
      } catch (error) {
        return reply.code(500).send({
          error: errorMessage(error, "Could not load subscriptions."),
        });
      }
    },
  );

  app.get<{ Params: IdParams }>(
    "/api/v1/subscriptions/:id/invoices",
    { preHandler: requireAuth },
    async (request, reply) => {
      try {
        if (
          !(await authorizeStaff(
            request,
            reply,
            authorizeSubscriptionView,
            request.params.id,
          ))
        ) return;
        const subscription = await getSubscriptionById(request.params.id);
        if (!subscription) {
          return reply
            .code(404)
            .send({ error: "Subscription not found." });
        }
        const invoices = await listSubscriptionInvoices(request.params.id);
        return reply.send({ invoices });
      } catch (error) {
        return reply.code(500).send({
          error: errorMessage(error, "Could not load subscription invoices."),
        });
      }
    },
  );

  app.get<{ Params: IdParams }>(
    "/api/v1/subscriptions/:id/entitlements",
    { preHandler: requireAuth },
    async (request, reply) => {
      try {
        if (
          !(await authorizeStaff(
            request,
            reply,
            authorizeSubscriptionView,
            request.params.id,
          ))
        ) return;
        const entitlements = await getSubscriptionEntitlements(
          request.params.id,
        );
        if (!entitlements) {
          return reply
            .code(404)
            .send({ error: "Subscription not found." });
        }
        return reply.send({ entitlements });
      } catch (error) {
        return reply.code(500).send({
          error: errorMessage(error, "Could not load entitlements."),
        });
      }
    },
  );

  app.get<{ Params: IdParams }>(
    "/api/v1/subscriptions/:id/usage",
    { preHandler: requireAuth },
    async (request, reply) => {
      try {
        if (
          !(await authorizeStaff(
            request,
            reply,
            authorizeSubscriptionView,
            request.params.id,
          ))
        ) return;
        const usage = await getUsageMetricsForSubscription(request.params.id);
        return reply.send({ usage });
      } catch (error) {
        return reply.code(500).send({
          error: errorMessage(error, "Could not load usage metrics."),
        });
      }
    },
  );

  app.post<{ Params: IdParams; Body: AnyBody }>(
    "/api/v1/subscriptions/:id/usage",
    { preHandler: requireAuth },
    async (request, reply) => {
      try {
        if (
          !(await authorizeStaff(
            request,
            reply,
            authorizeSubscriptionModify,
            request.params.id,
          ))
        ) return;
        const { metricKey, consumed } = request.body || {};
        if (!metricKey) {
          return reply.code(400).send({ error: "metricKey is required." });
        }
        const metric = await reportUsageConsumption(
          request.params.id,
          metricKey,
          Number(consumed) || 0,
        );
        return reply.send({ metric });
      } catch (error) {
        return reply.code(500).send({
          error: errorMessage(error, "Could not report usage."),
        });
      }
    },
  );

  app.post<{ Body: AnyBody }>(
    "/api/v1/customer/login",
    async (request, reply) => {
      try {
        const { email, password } = request.body || {};
        return reply.send(await loginCustomerUser(email, password));
      } catch (error) {
        if (isSessionAlreadyActiveError(error)) {
          const typed = error as StatusError;
          return reply
            .code(409)
            .send({ error: typed.message, code: typed.code });
        }
        if (isDatabaseConnectivityError(error)) {
          request.log.error({ err: error }, "Database unavailable during customer login");
          return reply.code(503).send({
            error: "Database unavailable. Try again in a moment.",
            code: "DATABASE_UNAVAILABLE",
          });
        }
        return reply.code(401).send({
          error: errorMessage(error, "Login failed."),
        });
      }
    },
  );

  app.post("/api/v1/customer/logout", async (request, reply) => {
    try {
      await logoutCustomerUser(bearerToken(request));
      return reply.send({ ok: true });
    } catch (error) {
      return reply.code(500).send({
        error: errorMessage(error, "Logout failed."),
      });
    }
  });

  app.get(
    "/api/v1/me/entitlements",
    withCustomerAuth(async (request, reply) => {
      const entitlements = await getCustomerEntitlements(
        customerUser(request).customerUserId,
      );
      return reply.send({ entitlements });
    }),
  );

  app.put<{ Body: AnyBody }>(
    "/api/v1/me/password",
    withCustomerAuth(async (request, reply) => {
      try {
        const { currentPassword, password } = request.body || {};
        await changeCustomerPassword(
          customerUser(request).customerUserId,
          String(currentPassword || ""),
          String(password || ""),
        );
        return reply.send({ ok: true });
      } catch (error) {
        return reply.code(400).send({
          error: errorMessage(error, "Could not update password."),
        });
      }
    }),
  );

  app.get<{ Params: IdParams }>(
    "/api/v1/me/subscriptions/:id/usage",
    withCustomerAuth(async (request, reply) => {
      const allowed = await assertCustomerSubscriptionAccess(
        customerUser(request).customerUserId,
        request.params.id,
      );
      if (!allowed) {
        return reply
          .code(403)
          .send({ error: "You do not have access to this subscription." });
      }
      const usage = await getUsageMetricsForSubscription(request.params.id);
      return reply.send({ usage });
    }),
  );

  app.get(
    "/api/v1/me/invoices",
    withCustomerAuth(async (request, reply) => {
      const invoices = await listCustomerInvoices(
        customerUser(request).customerUserId,
      );
      return reply.send({ invoices });
    }),
  );

  app.get<{ Params: InvoiceParams }>(
    "/api/v1/me/invoices/:quotationId",
    withCustomerAuth(async (request, reply) => {
      const invoice = await getCustomerInvoice(
        customerUser(request).customerUserId,
        request.params.quotationId,
      );
      if (!invoice) {
        return reply.code(404).send({ error: "Invoice not found." });
      }
      return reply.send({ invoice });
    }),
  );

  app.get<{ Querystring: AnyQuery }>(
    "/api/v1/me/support/tickets",
    withCustomerAuth(async (request, reply) => {
      const user = customerUser(request);
      const subscriptionIds = await getCustomerSubscriptionScope(user);
      const tickets = await listSupportTicketsForOrganization(
        user.organizationId,
        {
          status: request.query.status,
          productId: request.query.productId,
          days: request.query.days === "all" ? 0 : request.query.days,
          subscriptionIds,
          customerUserId: user.customerUserId,
        },
      );
      return reply.send({ tickets });
    }),
  );

  app.get<{ Params: IdParams }>(
    "/api/v1/me/support/tickets/:id",
    withCustomerAuth(async (request, reply) => {
      const user = customerUser(request);
      const detail = await getSupportTicketForOrganization(
        request.params.id,
        user.organizationId,
      );
      if (!detail) {
        return reply.code(404).send({ error: "Ticket not found." });
      }
      const subscriptionIds = await getCustomerSubscriptionScope(user);
      const ticketSubscriptionId = detail.ticket?.subscriptionId;
      const ownsTicket = detail.ticket?.customerUserId === user.customerUserId;
      const inScope =
        !ticketSubscriptionId ||
        subscriptionIds.includes(ticketSubscriptionId);
      if (!ownsTicket && !inScope) {
        return reply.code(403).send({
          error: "You do not have access to that support ticket.",
        });
      }
      if (
        ticketSubscriptionId &&
        !subscriptionIds.includes(ticketSubscriptionId)
      ) {
        return reply.code(403).send({
          error: "You do not have access to that support ticket.",
        });
      }
      return reply.send(detail);
    }),
  );

  app.post<{ Body: AnyBody }>(
    "/api/v1/me/support/tickets",
    withCustomerAuth(async (request, reply) => {
      const user = customerUser(request);
      const body = request.body || {};
      if (!body.subject?.trim() || !body.description?.trim() || !body.category) {
        return reply.code(400).send({
          error: "Subject, description, and category are required.",
        });
      }
      if (
        body.subscriptionId &&
        !(await assertCustomerSubscriptionAccess(
          user.customerUserId,
          body.subscriptionId,
        ))
      ) {
        return reply.code(403).send({
          error: "You do not have access to that product subscription.",
        });
      }
      const detail = await createSupportTicket({
        organizationId: user.organizationId,
        customerUserId: user.customerUserId,
        subscriptionId: body.subscriptionId || null,
        productId: body.productId || null,
        subscriptionKey: body.subscriptionKey || null,
        productLabel: body.productLabel || "",
        category: body.category,
        priority: body.priority || "medium",
        subject: body.subject.trim(),
        description: body.description.trim(),
        unableToUse: body.unableToUse === true,
        startedAfterChange: body.startedAfterChange === true,
        tenantId: body.tenantId || "",
        companyName: body.companyName || "",
        contactEmail: body.contactEmail || user.email,
        authorLabel: user.displayName || user.email,
      });
      try {
        await publishTicketEvent("ticket.created", {
          ticketId: detail!.ticket.id,
          organizationId: detail!.ticket.organizationId,
        });
      } catch (error) {
        request.log.error({ err: error }, "Support ticket event publish failed");
      }
      try {
        await queueSupportTicketCreatedEmails(
          detail!.ticket,
          detail!.messages?.[0],
        );
      } catch (error) {
        request.log.error(
          { err: error },
          "Support ticket notification enqueue failed",
        );
      }
      return reply.code(201).send(detail);
    }),
  );

  app.post<{ Params: IdParams; Body: AnyBody }>(
    "/api/v1/me/support/tickets/:id/replies",
    withCustomerAuth(async (request, reply) => {
      const user = customerUser(request);
      const body = request.body?.body?.trim();
      if (!body) {
        return reply.code(400).send({ error: "Reply body is required." });
      }
      const existing = await getSupportTicketForOrganization(
        request.params.id,
        user.organizationId,
      );
      if (!existing) {
        return reply.code(404).send({ error: "Ticket not found." });
      }
      const subscriptionIds = await getCustomerSubscriptionScope(user);
      const ticketSubscriptionId = existing.ticket?.subscriptionId;
      if (
        ticketSubscriptionId &&
        !subscriptionIds.includes(ticketSubscriptionId)
      ) {
        return reply.code(403).send({
          error: "You do not have access to that support ticket.",
        });
      }
      if (
        !ticketSubscriptionId &&
        existing.ticket?.customerUserId !== user.customerUserId
      ) {
        return reply.code(403).send({
          error: "You do not have access to that support ticket.",
        });
      }
      const detail = await addCustomerTicketReply({
        ticketId: request.params.id,
        organizationId: user.organizationId,
        body,
        authorLabel: user.displayName || user.email,
      });
      if (!detail) {
        return reply.code(404).send({ error: "Ticket not found." });
      }
      try {
        await publishTicketEvent("ticket.message.created", {
          ticketId: detail.ticket.id,
          organizationId: detail.ticket.organizationId,
          authorType: "customer",
        });
        if (detail.ticket.status) {
          await publishTicketEvent("ticket.status.changed", {
            ticketId: detail.ticket.id,
            organizationId: detail.ticket.organizationId,
            status: detail.ticket.status,
          });
        }
      } catch (error) {
        request.log.error({ err: error }, "Support ticket reply publish failed");
      }
      return reply.send(detail);
    }),
  );

  app.get<{ Querystring: AnyQuery }>(
    "/api/support/tickets",
    { preHandler: requireSalesWorkspaceAuth },
    async (request, reply) => {
      try {
        const tickets = await listSupportTicketsForSalesUser(
          authUser(request),
          {
            status: request.query.status,
            productId: request.query.productId,
            days: request.query.days === "all" ? 0 : request.query.days,
            search: request.query.search,
          },
        );
        return reply.send({ tickets });
      } catch (error) {
        throw error;
      }
    },
  );

  app.get<{ Params: IdParams }>(
    "/api/support/tickets/:id",
    { preHandler: requireSalesWorkspaceAuth },
    async (request, reply) => {
      const detail = await getSupportTicketForSalesUser(
        request.params.id,
        authUser(request),
      );
      if (!detail) {
        return reply.code(404).send({ error: "Ticket not found." });
      }
      return reply.send(detail);
    },
  );

  app.post<{ Params: IdParams; Body: AnyBody }>(
    "/api/support/tickets/:id/replies",
    { preHandler: requireSalesWorkspaceAuth },
    async (request, reply) => {
      try {
        const body = request.body?.body?.trim();
        if (!body) {
          return reply.code(400).send({ error: "Reply body is required." });
        }
        const user = authUser(request);
        const detail = await addSalesTicketReply({
          ticketId: request.params.id,
          authUser: user,
          body,
          authorLabel: user.displayName || user.email,
          status: request.body?.status || null,
        });
        if (!detail) {
          return reply.code(404).send({ error: "Ticket not found." });
        }
        try {
          await publishTicketEvent("ticket.message.created", {
            ticketId: detail.ticket.id,
            organizationId: detail.ticket.organizationId,
            authorType: "sales",
          });
          await publishTicketEvent("ticket.status.changed", {
            ticketId: detail.ticket.id,
            organizationId: detail.ticket.organizationId,
            status: detail.ticket.status,
          });
        } catch (error) {
          request.log.error(
            { err: error },
            "Sales support reply publish failed",
          );
        }
        return reply.send(detail);
      } catch (error) {
        const message = errorMessage(error, "Could not send reply.");
        if (
          message.includes("closed") ||
          message.includes("Reply body") ||
          message.includes("Invalid ticket status")
        ) {
          return reply.code(400).send({ error: message });
        }
        return reply.code(500).send({ error: message });
      }
    },
  );

  app.patch<{ Params: IdParams; Body: AnyBody }>(
    "/api/support/tickets/:id/status",
    { preHandler: requireSalesWorkspaceAuth },
    async (request, reply) => {
      try {
        const status = request.body?.status;
        if (!status) {
          return reply.code(400).send({ error: "Status is required." });
        }
        const detail = await updateSalesTicketStatus({
          ticketId: request.params.id,
          authUser: authUser(request),
          status,
        });
        if (!detail) {
          return reply.code(404).send({ error: "Ticket not found." });
        }
        try {
          await publishTicketEvent("ticket.status.changed", {
            ticketId: detail.ticket.id,
            organizationId: detail.ticket.organizationId,
            status: detail.ticket.status,
          });
        } catch (error) {
          request.log.error(
            { err: error },
            "Sales support status publish failed",
          );
        }
        return reply.send(detail);
      } catch (error) {
        const message = errorMessage(error, String(error));
        if (message.includes("Invalid")) {
          return reply.code(400).send({ error: message });
        }
        throw error;
      }
    },
  );

  app.get(
    "/api/v1/me/product-requests",
    withCustomerAuth(async (request, reply) => {
      const user = customerUser(request);
      const entitlements = await getCustomerEntitlements(user.customerUserId);
      const branchId = entitlements?.user?.branchId || user.branchId || null;
      const requests = await listCustomerProductRequests(user.organizationId, {
        branchId,
      });
      return reply.send({ requests });
    }),
  );

  app.post<{ Body: AnyBody }>(
    "/api/v1/me/product-requests",
    withCustomerAuth(async (request, reply) => {
      const user = customerUser(request);
      const body = request.body || {};
      const requestType = String(body.requestType || "new").trim() || "new";
      const isInquiry = requestType.toLowerCase() === "inquiry";
      const assignments = Array.isArray(body.assignments)
        ? body.assignments
        : [];
      const newBranches = Array.isArray(body.newBranches)
        ? body.newBranches
        : [];
      if (!isInquiry && !assignments.length) {
        return reply.code(400).send({
          error: "At least one product configuration is required.",
        });
      }
      if (isInquiry && assignments.length) {
        return reply.code(400).send({
          error: "Product inquiry requests cannot include product configurations.",
        });
      }
      if (isInquiry && !String(body.customerNote || "").trim()) {
        return reply.code(400).send({
          error: "A note for sales is required for product inquiries.",
        });
      }
      const entitlements = await getCustomerEntitlements(user.customerUserId);
      const organization = entitlements?.organization;
      const sourceLeadId = organization?.sourceLeadId;
      if (!sourceLeadId) {
        return reply.code(400).send({
          error: "No linked sales account found for this customer.",
        });
      }
      if (!isInquiry) {
        const branchId = entitlements!.user.branchId;
        const draftBranchIds = new Set(
          newBranches
            .map((entry: AnyBody) => String(entry?.id || "").trim())
            .filter(Boolean),
        );
        if (
          assignments.some((entry: AnyBody) => {
            const target = String(entry.branchId || "hq");
            return target !== String(branchId) && !draftBranchIds.has(target);
          })
        ) {
          return reply.code(403).send({
            error:
              "Branch portal users can only request products for their assigned branch or a new branch they are adding in this request.",
          });
        }
      }
      try {
        const requestRecord = await createCustomerProductRequest({
          organizationId: user.organizationId,
          customerUserId: user.customerUserId,
          sourceLeadId,
          requestType: isInquiry ? "inquiry" : requestType,
          assignments: isInquiry ? [] : assignments,
          productSummary: body.productSummary || [],
          branchSummary: isInquiry ? null : body.branchSummary || null,
          newBranches: isInquiry ? [] : newBranches,
          customerNote: body.customerNote || "",
          tenantId: body.tenantId || organization?.tenantId || "",
          companyName: body.companyName || organization?.companyName || "",
          contactEmail: body.contactEmail || user.email,
        });
        try {
          await notifyCustomerProductRequest(requestRecord);
        } catch (error) {
          request.log.error(
            { err: error },
            "Customer product request notification failed",
          );
        }
        return reply.code(201).send({ request: requestRecord });
      } catch (error) {
        const typed = error as StatusError;
        if (typed?.code === "OPEN_PRODUCT_REQUEST") {
          return reply.code(409).send({
            error: errorMessage(
              error,
              "An open product request already exists.",
            ),
            code: "OPEN_PRODUCT_REQUEST",
            existingRequest: typed.existingRequest || null,
            productId: typed.productId || null,
            branchId: typed.branchId || null,
          });
        }
        if (typed?.code === "ALREADY_OWNED_PRODUCT") {
          return reply.code(409).send({
            error: errorMessage(
              error,
              "This product is already on your account.",
            ),
            code: "ALREADY_OWNED_PRODUCT",
            productId: typed.productId || null,
          });
        }
        return reply.code(400).send({
          error: errorMessage(error, "Could not submit product request."),
        });
      }
    }),
  );

  app.put<{ Params: IdParams; Body: AnyBody }>(
    "/api/v1/me/product-requests/:id",
    withCustomerAuth(async (request, reply) => {
      const user = customerUser(request);
      const body = request.body || {};
      const assignments = Array.isArray(body.assignments)
        ? body.assignments
        : [];
      const newBranches = Array.isArray(body.newBranches)
        ? body.newBranches
        : [];
      if (!assignments.length) {
        return reply.code(400).send({
          error: "At least one product configuration is required.",
        });
      }
      const entitlements = await getCustomerEntitlements(user.customerUserId);
      const organization = entitlements?.organization;
      const sourceLeadId = organization?.sourceLeadId;
      if (!sourceLeadId) {
        return reply.code(400).send({
          error: "No linked sales account found for this customer.",
        });
      }
      const branchId = entitlements!.user.branchId;
      const draftBranchIds = new Set(
        newBranches
          .map((entry: AnyBody) => String(entry?.id || "").trim())
          .filter(Boolean),
      );
      if (
        assignments.some((entry: AnyBody) => {
          const target = String(entry.branchId || "hq");
          return target !== String(branchId) && !draftBranchIds.has(target);
        })
      ) {
        return reply.code(403).send({
          error:
            "Branch portal users can only request products for their assigned branch or a new branch they are adding in this request.",
        });
      }
      try {
        const requestRecord = await updateCustomerProductRequest({
          requestId: request.params.id,
          organizationId: user.organizationId,
          requestType: body.requestType || "new",
          assignments,
          productSummary: body.productSummary || [],
          branchSummary: body.branchSummary || null,
          newBranches,
          customerNote: body.customerNote || "",
          sourceLeadId,
          contactEmail: body.contactEmail || user.email,
        });
        try {
          await notifyCustomerProductRequest(requestRecord, {
            reason: "updated",
          });
        } catch (error) {
          request.log.error(
            { err: error },
            "Customer product request update notification failed",
          );
        }
        return reply.send({ request: requestRecord });
      } catch (error) {
        const typed = error as StatusError;
        if (typed?.code === "OPEN_PRODUCT_REQUEST") {
          return reply.code(409).send({
            error: errorMessage(
              error,
              "An open product request already exists.",
            ),
            code: "OPEN_PRODUCT_REQUEST",
            existingRequest: typed.existingRequest || null,
            productId: typed.productId || null,
            branchId: typed.branchId || null,
          });
        }
        if (typed?.code === "ALREADY_OWNED_PRODUCT") {
          return reply.code(409).send({
            error: errorMessage(
              error,
              "This product is already on your account.",
            ),
            code: "ALREADY_OWNED_PRODUCT",
            productId: typed.productId || null,
          });
        }
        const message = errorMessage(error, "Could not update product request.");
        const status = /not found/i.test(message)
          ? 404
          : /no longer be edited|quotation in progress/i.test(message)
            ? 409
            : 400;
        return reply.code(status).send({ error: message });
      }
    }),
  );

  app.post<{ Params: IdParams }>(
    "/api/v1/me/product-requests/:id/notify",
    withCustomerAuth(async (request, reply) => {
      try {
        const requestRecord = await renotifyCustomerProductRequest({
          requestId: request.params.id,
          organizationId: customerUser(request).organizationId,
        });
        if (!requestRecord) {
          return reply.code(404).send({
            error: "Request not found or it can no longer be sent to sales.",
          });
        }
        try {
          await notifyCustomerProductRequest(requestRecord, {
            reason: "reminder",
          });
        } catch (error) {
          request.log.error(
            { err: error },
            "Customer product request reminder failed",
          );
        }
        return reply.send({ request: requestRecord });
      } catch (error) {
        return reply.code(400).send({
          error: errorMessage(error, "Could not notify sales again."),
        });
      }
    }),
  );

  app.post<{ Params: IdParams }>(
    "/api/v1/me/product-requests/:id/cancel",
    withCustomerAuth(async (request, reply) => {
      const user = customerUser(request);
      const cancelled = await cancelCustomerProductRequest({
        requestId: request.params.id,
        organizationId: user.organizationId,
        customerUserId: user.customerUserId,
      });
      if (!cancelled) {
        return reply.code(404).send({
          error: "Request not found or it can no longer be withdrawn.",
        });
      }
      try {
        await notifyCustomerProductRequestCancelled(cancelled);
      } catch (error) {
        request.log.error(
          { err: error },
          "Customer product request cancellation notification failed",
        );
      }
      return reply.send({ request: cancelled });
    }),
  );

  app.get(
    "/api/v1/me/cancellation-requests",
    withCustomerAuth(async (request, reply) => {
      const user = customerUser(request);
      const entitlements = await getCustomerEntitlements(user.customerUserId);
      const requests = await listCustomerCancellationRequests(
        user.organizationId,
        { branchId: entitlements?.user?.branchId || null },
      );
      return reply.send({ requests });
    }),
  );

  app.post<{ Body: AnyBody }>(
    "/api/v1/me/cancellation-requests",
    withCustomerAuth(async (request, reply) => {
      const user = customerUser(request);
      const body = request.body || {};
      const requestKind = String(body.requestKind || "").trim();
      const branchId = String(body.branchId || "").trim();
      if (!Object.values(REQUEST_KINDS).includes(requestKind)) {
        return reply
          .code(400)
          .send({ error: "Invalid cancellation request kind." });
      }
      if (!branchId) {
        return reply
          .code(400)
          .send({ error: "Branch location is required." });
      }
      if (await isBranchInactive(null, user.organizationId, branchId)) {
        return reply.code(400).send({ error: "This branch is inactive." });
      }
      const entitlements = await getCustomerEntitlements(user.customerUserId);
      const organization = entitlements?.organization;
      const sourceLeadId = organization?.sourceLeadId;
      if (!sourceLeadId) {
        return reply.code(400).send({
          error: "No linked sales account found for this customer.",
        });
      }
      try {
        const requestRecord = await createCustomerCancellationRequest({
          organizationId: user.organizationId,
          customerUserId: user.customerUserId,
          customerUser: entitlements!.user,
          sourceLeadId,
          requestKind,
          branchId,
          productId: body.productId || null,
          subscriptionId: body.subscriptionId || null,
          customerNote: body.customerNote || "",
          effectiveTiming: body.effectiveTiming || null,
          tenantId: body.tenantId || organization?.tenantId || "",
          companyName: body.companyName || organization?.companyName || "",
          contactEmail: body.contactEmail || user.email,
        });
        try {
          await queueBranchCancellationRequestedEmail(requestRecord);
        } catch (error) {
          request.log.error(
            { err: error },
            "Cancellation request notification failed",
          );
        }
        return reply.code(201).send({ request: requestRecord });
      } catch (error) {
        const message = errorMessage(
          error,
          "Could not submit cancellation request.",
        );
        return reply
          .code(/assigned branch/i.test(message) ? 403 : 400)
          .send({ error: message });
      }
    }),
  );

  app.post<{ Params: IdParams }>(
    "/api/v1/me/cancellation-requests/:id/withdraw",
    withCustomerAuth(async (request, reply) => {
      const user = customerUser(request);
      const withdrawn = await withdrawCancellationRequest(
        request.params.id,
        user.organizationId,
        user.customerUserId,
      );
      if (!withdrawn) {
        return reply.code(404).send({
          error: "Request not found or it can no longer be withdrawn.",
        });
      }
      return reply.send({ request: withdrawn });
    }),
  );

  app.get(
    "/api/v1/me/branch-add-requests",
    withCustomerAuth(async (request, reply) => {
      const user = customerUser(request);
      const entitlements = await getCustomerEntitlements(user.customerUserId);
      // Branch-add is head-office only; non-head must not see HQ request history.
      if (!entitlements?.user?.isHeadOffice) {
        return reply.send({ requests: [] });
      }
      const requests = await listBranchAddRequestsForOrganization(
        user.organizationId,
      );
      return reply.send({ requests });
    }),
  );

  app.post<{ Body: AnyBody }>(
    "/api/v1/me/branch-add-requests",
    withCustomerAuth(async (request, reply) => {
      const user = customerUser(request);
      const entitlements = await getCustomerEntitlements(user.customerUserId);
      const organization = entitlements?.organization;
      const sourceLeadId = organization?.sourceLeadId;
      if (!sourceLeadId) {
        return reply.code(400).send({
          error: "No linked sales account found for this customer.",
        });
      }
      if (!entitlements?.user?.isHeadOffice) {
        return reply.code(403).send({
          error: "Only the head office portal can request a new branch.",
        });
      }
      try {
        const requestRecord = await createBranchAddRequest({
          organizationId: user.organizationId,
          customerUserId: user.customerUserId,
          customerUser: entitlements.user,
          sourceLeadId,
          companyName: organization?.companyName || "",
          contactEmail: user.email || "",
          body: request.body || {},
          headOfficeVerified: true,
        });
        try {
          await queueBranchAddRequestedEmail(requestRecord);
        } catch (error) {
          request.log.error(
            { err: error },
            "Branch add request notification failed",
          );
        }
        return reply.code(201).send({ request: requestRecord });
      } catch (error) {
        if (isMissingDatabaseObjectError(error)) {
          request.log.error(
            { err: error },
            "branch_add_requests schema missing during branch add request",
          );
          return reply.code(503).send({
            error:
              "This feature is temporarily unavailable. Please try again shortly or contact support.",
            code: "FEATURE_UNAVAILABLE",
          });
        }
        const message = errorMessage(
          error,
          "Could not submit branch add request.",
        );
        const status =
          (error as StatusError | null)?.status ||
          (/head office/i.test(message) ? 403 : 400);
        return reply.code(status).send({ error: message });
      }
    }),
  );

  app.post<{ Params: IdParams }>(
    "/api/v1/me/branch-add-requests/:id/withdraw",
    withCustomerAuth(async (request, reply) => {
      const user = customerUser(request);
      const withdrawn = await withdrawBranchAddRequest(
        request.params.id,
        user.organizationId,
        user.customerUserId,
      );
      if (!withdrawn) {
        return reply.code(404).send({
          error: "Request not found or it can no longer be withdrawn.",
        });
      }
      return reply.send({ request: withdrawn });
    }),
  );
};
