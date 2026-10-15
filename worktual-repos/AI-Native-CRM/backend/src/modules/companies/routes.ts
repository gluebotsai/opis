import type { FastifyPluginAsync } from "fastify";
import type { CompanyInput, LocationInput } from "@/dao/companies/company-service";
import {
  createCompanyCommand,
  createLocationCommand,
  deleteCompanyCommand,
  deleteLocationCommand,
  getCompanyCommand,
  getCompanyFormOptionsCommand,
  getCompanyLocationsCommand,
  getLocationCommand,
  getLocationFormOptionsCommand,
  listCompaniesCommand,
  updateCompanyCommand,
  updateLocationCommand,
} from "@/service/companies/company-commands";
import { ForbiddenError } from "@/service/auth/require-role";
import { listCompaniesForSelect } from "@/dao/companies/company-service";
import {
  getCompanyBuyingGroup,
  reviewBuyingRole,
  reviewRelationship,
  setBuyingRole,
  suggestBuyingGroup,
} from "@/service/companies/buying-group";
import { requireSessionOrApiKey, withUser } from "../../middlewares/auth.js";
import { sendSuccess, sendError, sendResult } from "../../helpers/response.js";


export const companiesRoutes: FastifyPluginAsync = async (app) => {
  app.get<{
    Querystring: { page?: string; pageSize?: string; search?: string };
  }>("/", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "companies");
    if (!userId) return;
    return withUser(userId, async () => {
      try {
        const page = Math.max(1, Number(request.query.page) || 1);
        const parsedSize = Number(request.query.pageSize);
        const result = await listCompaniesCommand({
          page,
          pageSize: Number.isFinite(parsedSize) ? parsedSize : undefined,
          search: request.query.search,
        });
        return sendSuccess(reply, result);
      } catch (err) {
        if (err instanceof ForbiddenError) {
          return sendError(reply, err.message, 403);
        }
        throw err;
      }
    });
  });

  app.get<{ Querystring: { limit?: string } }>("/select", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "companies");
    if (!userId) return;
    return withUser(userId, async () => {
      try {
        const { requireModuleEnabled } = await import(
          "@/service/auth/require-role"
        );
        await requireModuleEnabled(
          "company",
          "Companies are not available for your business type.",
        );
        const items = await listCompaniesForSelect({
          limit: request.query.limit ? Number(request.query.limit) : undefined,
        });
        return sendSuccess(reply, { items });
      } catch (err) {
        if (err instanceof ForbiddenError) {
          return sendError(reply, err.message, 403);
        }
        throw err;
      }
    });
  });

  app.get("/form-options", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "companies");
    if (!userId) return;
    return withUser(userId, async () => {
      try {
        return await getCompanyFormOptionsCommand();
      } catch (err) {
        if (err instanceof ForbiddenError) {
          return sendError(reply, err.message, 403);
        }
        throw err;
      }
    });
  });

  app.post<{
    Body: {
      name?: string;
      domain?: string | null;
      industry?: string | null;
      employeeCount?: number | null;
      linkedinUrl?: string | null;
      ownerUserId?: string | null;
      channelRole?: string | null;
      parentCompanyId?: string | null;
      locationName?: string;
      locationAddress?: string | null;
      locationType?: "hq" | "branch";
    };
  }>("/", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "companies");
    if (!userId) return;
    return withUser(userId, async () => {
      const body = request.body ?? {};
      const result = await createCompanyCommand({
        name: body.name ?? "",
        domain: body.domain,
        industry: body.industry,
        employeeCount: body.employeeCount,
        linkedinUrl: body.linkedinUrl,
        ownerUserId: body.ownerUserId,
        channelRole: body.channelRole,
        parentCompanyId: body.parentCompanyId,
        locationName: body.locationName ?? "",
        locationAddress: body.locationAddress,
        locationType: body.locationType,
      });
      return sendResult(reply, result);
    });
  });

  app.get<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "companies");
    if (!userId) return;
    return withUser(userId, async () => {
      const result = await getCompanyCommand(request.params.id);
      if (!result.ok) {
        return sendError(reply, result.error, result.status);
      }
      return sendResult(reply, result);
    });
  });

  app.patch<{ Params: { id: string }; Body: CompanyInput }>(
    "/:id",
    async (request, reply) => {
      const userId = await requireSessionOrApiKey(request, reply, "companies");
      if (!userId) return;
      return withUser(userId, async () => {
        const result = await updateCompanyCommand(
          request.params.id,
          request.body ?? ({} as CompanyInput),
        );
        return sendResult(reply, result);
      });
    },
  );

  app.delete<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "companies");
    if (!userId) return;
    return withUser(userId, async () => {
      const result = await deleteCompanyCommand(request.params.id);
      return sendResult(reply, result);
    });
  });

  app.get<{ Params: { id: string } }>("/:id/buying-group", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "companies");
    if (!userId) return;
    return withUser(userId, async () => {
      try {
        const group = await getCompanyBuyingGroup(request.params.id);
        if (!group) return sendError(reply, "Company not found.", 404);
        return sendSuccess(reply, { buyingGroup: group });
      } catch (err) {
        if (err instanceof ForbiddenError) return sendError(reply, err.message, 403);
        throw err;
      }
    });
  });

  app.post<{ Params: { id: string } }>("/:id/buying-group/suggest", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "companies");
    if (!userId) return;
    return withUser(userId, async () => {
      try {
        const group = await suggestBuyingGroup(request.params.id);
        if (!group) return sendError(reply, "Company not found.", 404);
        return sendSuccess(reply, { buyingGroup: group });
      } catch (err) {
        if (err instanceof ForbiddenError) return sendError(reply, err.message, 403);
        throw err;
      }
    });
  });

  app.post<{
    Params: { id: string };
    Body: {
      contactId?: string;
      dealId?: string | null;
      role?: string;
      influence?: string | null;
      attitude?: string | null;
    };
  }>("/:id/buying-roles", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "companies");
    if (!userId) return;
    const contactId = request.body?.contactId?.trim();
    const role = request.body?.role?.trim();
    if (!contactId || !role) return sendError(reply, "Contact and role are required.", 400);
    return withUser(userId, async () => {
      try {
        const group = await setBuyingRole({
          companyId: request.params.id,
          contactId,
          dealId: request.body?.dealId,
          role,
          influence: request.body?.influence,
          attitude: request.body?.attitude,
        });
        if (!group) return sendError(reply, "Company not found.", 404);
        return sendSuccess(reply, { buyingGroup: group });
      } catch (err) {
        if (err instanceof ForbiddenError) return sendError(reply, err.message, 403);
        throw err;
      }
    });
  });

  app.post<{ Params: { id: string; roleId: string }; Body: { status?: string } }>(
    "/:id/buying-roles/:roleId",
    async (request, reply) => {
      const userId = await requireSessionOrApiKey(request, reply, "companies");
      if (!userId) return;
      const status = request.body?.status === "rejected" ? "rejected" : "confirmed";
      return withUser(userId, async () => {
        try {
          const group = await reviewBuyingRole(request.params.roleId, status);
          if (!group) return sendError(reply, "Role not found.", 404);
          return sendSuccess(reply, { buyingGroup: group });
        } catch (err) {
          if (err instanceof ForbiddenError) return sendError(reply, err.message, 403);
          throw err;
        }
      });
    },
  );

  app.post<{ Params: { id: string; linkId: string }; Body: { status?: string } }>(
    "/:id/relationships/:linkId",
    async (request, reply) => {
      const userId = await requireSessionOrApiKey(request, reply, "companies");
      if (!userId) return;
      const status = request.body?.status === "rejected" ? "rejected" : "confirmed";
      return withUser(userId, async () => {
        try {
          const group = await reviewRelationship(request.params.linkId, status);
          if (!group) return sendError(reply, "Relationship not found.", 404);
          return sendSuccess(reply, { buyingGroup: group });
        } catch (err) {
          if (err instanceof ForbiddenError) return sendError(reply, err.message, 403);
          throw err;
        }
      });
    },
  );

  app.get<{ Params: { id: string } }>("/:id/locations", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "companies");
    if (!userId) return;
    return withUser(userId, async () => {
      const result = await getCompanyLocationsCommand(request.params.id);
      if (!result.ok) {
        return sendError(reply, result.error, result.status);
      }
      return sendResult(reply, result);
    });
  });

  app.get<{
    Params: { id: string };
    Querystring: { locationId?: string };
  }>("/:id/locations/form-options", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "companies");
    if (!userId) return;
    return withUser(userId, async () => {
      const result = await getLocationFormOptionsCommand(
        request.params.id,
        request.query.locationId,
      );
      if (!result.ok) {
        return sendError(reply, result.error, result.status);
      }
      return sendResult(reply, result);
    });
  });

  app.get<{ Params: { id: string; locationId: string } }>(
    "/:id/locations/:locationId",
    async (request, reply) => {
      const userId = await requireSessionOrApiKey(request, reply, "companies");
      if (!userId) return;
      return withUser(userId, async () => {
        const result = await getLocationCommand(
          request.params.id,
          request.params.locationId,
        );
        if (!result.ok) {
          return sendError(reply, result.error, result.status);
        }
        return sendResult(reply, result);
      });
    },
  );

  app.post<{ Params: { id: string }; Body: LocationInput }>(
    "/:id/locations",
    async (request, reply) => {
      const userId = await requireSessionOrApiKey(request, reply, "companies");
      if (!userId) return;
      return withUser(userId, async () => {
        const result = await createLocationCommand(
          request.params.id,
          request.body ?? ({} as LocationInput),
        );
        return sendResult(reply, result);
      });
    },
  );

  app.patch<{
    Params: { id: string; locationId: string };
    Body: LocationInput;
  }>("/:id/locations/:locationId", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "companies");
    if (!userId) return;
    return withUser(userId, async () => {
      const result = await updateLocationCommand(
        request.params.id,
        request.params.locationId,
        request.body ?? ({} as LocationInput),
      );
      return sendResult(reply, result);
    });
  });

  app.delete<{ Params: { id: string; locationId: string } }>(
    "/:id/locations/:locationId",
    async (request, reply) => {
      const userId = await requireSessionOrApiKey(request, reply, "companies");
      if (!userId) return;
      return withUser(userId, async () => {
        const result = await deleteLocationCommand(
          request.params.id,
          request.params.locationId,
        );
        return sendResult(reply, result);
      });
    },
  );
};
