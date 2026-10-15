import type {
  FastifyPluginAsync,
  FastifyReply,
  FastifyRequest,
} from "fastify";

import { getSession } from "../auth/session-auth.js";
import {
  adminDropBranchDirect,
  approveCancellationRequest,
  getCancellationRequest,
  listAdminCancellationRequests,
  rejectCancellationRequest,
} from "./cancellation-requests.js";
import {
  deleteCustomerUserByAdmin,
  forceLogoutCustomerUserByAdmin,
  listAdminCustomerUsers,
  setCustomerUserActiveByAdmin,
} from "../customer-portal/customer-auth.js";
import { queueBranchCancellationResolvedEmail } from "../../infra/notify.js";

type AdminPrincipal = {
  email: string;
  role: string;
  userId?: string | null;
};

type AdminRequest = FastifyRequest & {
  adminUser?: AdminPrincipal;
  authUser?: AdminPrincipal;
};

type IdParams = { id: string };
type BranchParams = { orgId: string; branchId: string };
type AnyBody = Record<string, any>;
type AnyQuery = Record<string, any>;
type StatusError = { status?: unknown };

function bearerToken(request: FastifyRequest): string {
  const authorization = request.headers.authorization || "";
  return authorization.startsWith("Bearer ")
    ? authorization.slice(7).trim()
    : "";
}

async function requireAdminAuth(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  try {
    const session = await getSession(bearerToken(request));
    if (!session || session.role !== "admin") {
      await reply.code(401).send({ error: "Authentication required." });
      return;
    }

    const adminRequest = request as AdminRequest;
    adminRequest.adminUser = session;
    adminRequest.authUser = session;
  } catch (error) {
    await reply.code(500).send({
      error: error instanceof Error ? error.message : "Authentication failed.",
    });
  }
}

function adminUser(request: FastifyRequest): AdminPrincipal {
  return (request as AdminRequest).adminUser as AdminPrincipal;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export const adminNativeBranchRequestRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", requireAdminAuth);
  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("x-route-host", "fastify");
    return payload;
  });

  app.post<{ Params: IdParams }>(
    "/api/admin/customer-users/:id/force-logout",
    async (request, reply) => {
      try {
        const result = await forceLogoutCustomerUserByAdmin(request.params.id);
        return reply.send(result);
      } catch (error) {
        const status = (error as StatusError | null)?.status === 404 ? 404 : 400;
        return reply.code(status).send({
          error: errorMessage(
            error,
            "Could not force logout customer portal user.",
          ),
        });
      }
    },
  );

  app.patch<{ Params: IdParams; Body: AnyBody }>(
    "/api/admin/customer-users/:id",
    async (request, reply) => {
      try {
        if (typeof request.body?.isActive !== "boolean") {
          return reply.code(400).send({ error: "isActive (boolean) is required." });
        }
        const result = await setCustomerUserActiveByAdmin(
          request.params.id,
          request.body.isActive,
        );
        return reply.send(result);
      } catch (error) {
        const status = (error as StatusError | null)?.status === 404 ? 404 : 400;
        return reply.code(status).send({
          error: errorMessage(error, "Could not update customer portal user."),
        });
      }
    },
  );

  app.delete<{ Params: IdParams }>(
    "/api/admin/customer-users/:id",
    async (request, reply) => {
      try {
        const result = await deleteCustomerUserByAdmin(request.params.id);
        return reply.send(result);
      } catch (error) {
        const status = (error as StatusError | null)?.status === 404 ? 404 : 400;
        return reply.code(status).send({
          error: errorMessage(error, "Could not delete customer portal user."),
        });
      }
    },
  );

  app.get<{ Querystring: AnyQuery }>(
    "/api/admin/customer-users",
    async (request, reply) => {
      try {
        const users = await listAdminCustomerUsers({
          q: String(request.query.q || ""),
        });
        return reply.send({ users });
      } catch (error) {
        return reply.code(500).send({
          error: errorMessage(error, "Could not load customer portal users."),
        });
      }
    },
  );

  app.get<{ Querystring: AnyQuery }>(
    "/api/admin/cancellation-requests",
    async (request, reply) => {
      try {
        const status = request.query.status
          ? String(request.query.status)
          : null;
        const requests = await listAdminCancellationRequests({ status });
        return reply.send({ requests });
      } catch (error) {
        return reply.code(500).send({
          error: errorMessage(error, "Could not load cancellation requests."),
        });
      }
    },
  );

  app.get<{ Params: IdParams }>(
    "/api/admin/cancellation-requests/:id",
    async (request, reply) => {
      try {
        const requestRecord = await getCancellationRequest(request.params.id);
        if (!requestRecord) {
          return reply
            .code(404)
            .send({ error: "Cancellation request not found." });
        }
        return reply.send({ request: requestRecord });
      } catch (error) {
        return reply.code(500).send({
          error: errorMessage(error, "Could not load cancellation request."),
        });
      }
    },
  );

  app.post<{ Params: IdParams; Body: AnyBody }>(
    "/api/admin/cancellation-requests/:id/approve",
    async (request, reply) => {
      try {
        const result = await approveCancellationRequest(request.params.id, {
          adminUser: adminUser(request).email,
          adminNote: request.body?.adminNote || "",
          effectiveTiming: request.body?.effectiveTiming || null,
        });

        void queueBranchCancellationResolvedEmail(
          result.request,
          "approved",
        ).catch((error: unknown) => {
          console.error(
            "[mail] Cancellation resolved notification failed:",
            error instanceof Error ? error.message : error,
          );
        });

        return reply.send(result);
      } catch (error) {
        return reply.code(400).send({
          error: errorMessage(
            error,
            "Could not approve cancellation request.",
          ),
        });
      }
    },
  );

  app.post<{ Params: IdParams; Body: AnyBody }>(
    "/api/admin/cancellation-requests/:id/reject",
    async (request, reply) => {
      try {
        const requestRecord = await rejectCancellationRequest(
          request.params.id,
          {
            adminUser: adminUser(request).email,
            adminNote: request.body?.adminNote || "",
          },
        );

        void queueBranchCancellationResolvedEmail(
          requestRecord,
          "rejected",
        ).catch((error: unknown) => {
          console.error(
            "[mail] Cancellation resolved notification failed:",
            error instanceof Error ? error.message : error,
          );
        });

        return reply.send({ request: requestRecord });
      } catch (error) {
        return reply.code(400).send({
          error: errorMessage(
            error,
            "Could not reject cancellation request.",
          ),
        });
      }
    },
  );

  app.post<{ Params: BranchParams; Body: AnyBody }>(
    "/api/admin/organizations/:orgId/locations/:branchId/drop",
    async (request, reply) => {
      try {
        const result = await adminDropBranchDirect({
          organizationId: request.params.orgId,
          branchId: request.params.branchId,
          adminUser: adminUser(request).email,
          reason: request.body?.reason || "Branch dropped by Worktual admin",
          effectiveTiming: request.body?.effectiveTiming || null,
        });
        return reply.send(result);
      } catch (error) {
        return reply.code(400).send({
          error: errorMessage(error, "Could not drop branch."),
        });
      }
    },
  );
};
