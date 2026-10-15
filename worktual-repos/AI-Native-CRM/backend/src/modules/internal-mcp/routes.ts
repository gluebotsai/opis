import type { FastifyPluginAsync } from "fastify";
import {
  isModuleEnabledForAccess,
  type BusinessType,
  type ModuleId,
} from "@/config/modules";
import { getPrismaClient } from "@/dao/db/prisma";
import { accountQuery } from "@/dao/db/account-pool";
import { createContactActivity } from "@/dao/contacts/contact-activity-service";
import { getContact, listContacts } from "@/dao/contacts/contact-service";
import { notifyAdminsOfLeadEventAsync } from "@/dao/notifications/notify-admins";
import { updateDealStage } from "@/dao/sales/deal-service";
import { canEditDeals, canViewAllRecords, normalizeRole } from "@/service/auth/rbac";
import {
  resolveChannelCompanyIdsForUser,
  UNOWNED_SCOPE_SENTINEL,
} from "@/service/auth/ownership-scope";
import { verifyMcpExecutionJwt } from "@/service/ai/mcp-execution-jwt";
import {
  clearAgentMemory,
  isAllowedMemoryScopeType,
  isAllowedMemorySlotKey,
  listAgentMemories,
  memoriesToPromptMap,
  upsertAgentMemory,
  type AgentMemoryScopeType,
} from "@/dao/ai/agent-memory";

const BUSINESS_TYPES = new Set<BusinessType>(["b2b", "b2c", "b2b2c"]);
const DEAL_STAGES = new Set([
  "qualification",
  "discover",
  "propose",
  "negotiate",
  "closed_won",
  "closed_lost",
]);
const ACTIVITY_TYPES = new Set([
  "note",
  "call",
  "email",
  "meeting",
  "task",
  "sms",
]);

function numericUserId(raw: unknown): string | null {
  const id = String(raw || "").trim();
  return /^\d+$/.test(id) ? id : null;
}

async function resolveOrgStaffUserId(
  organizationId: string,
  preferred?: string | null,
): Promise<string | null> {
  const preferredId = numericUserId(preferred);
  if (preferredId) return preferredId;
  const { rows } = await accountQuery<{ id: string }>(
    `SELECT u.id::text AS id
     FROM accounts.setup_users u
     LEFT JOIN accounts.setup_user_product_access a
       ON a.user_id = u.id AND a.product_id = 'crm'
     LEFT JOIN accounts.setup_roles r ON r.id = a.role_id
     WHERE u.organization_id = $1::bigint
       AND lower(coalesce(u.status, 'active')) = 'active'
       AND lower(coalesce(r.name, '')) IN ('admin', 'sales_manager', 'sales_rep')
     ORDER BY
       CASE lower(coalesce(r.name, ''))
         WHEN 'admin' THEN 0
         WHEN 'sales_manager' THEN 1
         ELSE 2
       END,
       u.id
     LIMIT 1`,
    [organizationId],
  );
  return rows[0]?.id ?? null;
}

/** Curated business commands used by MCP; arbitrary SQL is intentionally absent. */
export const internalMcpRoutes: FastifyPluginAsync = async (app) => {
  app.post<{
    Body: {
      command?: string;
      arguments?: Record<string, unknown>;
    };
  }>("/commands", async (request, reply) => {
    const auth = request.headers.authorization || "";
    const token = auth.toLowerCase().startsWith("bearer ")
      ? auth.slice(7).trim()
      : "";
    const claims = verifyMcpExecutionJwt(token);
    if (!claims) return reply.code(401).send({ ok: false, error: "Unauthorized" });

    const businessType = claims.businessType as BusinessType;
    const moduleId = (claims.module === "quotes" ? "sales" : claims.module) as ModuleId;
    if (
      !BUSINESS_TYPES.has(businessType) ||
      !isModuleEnabledForAccess(moduleId, businessType, claims.role)
    ) {
      return reply.code(403).send({ ok: false, error: "MCP scope denied" });
    }

    if (!/^\d+$/.test(claims.organizationId)) {
      return reply.code(403).send({ ok: false, error: "Invalid tenant scope" });
    }

    const command = String(request.body?.command || "").trim();
    const args = request.body?.arguments || {};

    if (command === "lookup_contacts") {
      const query = String(args.query || "").trim().slice(0, 80);
      if (query.length < 2) {
        return reply
          .code(400)
          .send({ ok: false, error: "Say the name or email to look up." });
      }
      const role = normalizeRole(claims.role);
      const actorId = numericUserId(claims.actorId);
      const viewAll = canViewAllRecords(role);
      const ownerUserId = viewAll ? null : actorId ?? UNOWNED_SCOPE_SENTINEL;
      const channelCompanyIds =
        !viewAll && actorId
          ? await resolveChannelCompanyIdsForUser(actorId, claims.organizationId)
          : null;
      const result = await listContacts({
        search: query,
        organizationId: claims.organizationId,
        page: 1,
        pageSize: 8,
        status: "active",
        ownerUserId,
        channelCompanyIds,
      });
      return reply.send({
        ok: true,
        data: {
          query,
          total: result.total,
          items: result.items.slice(0, 8).map((contact) => ({
            id: contact.id,
            name: contact.displayName,
            email: contact.person.email,
            phone: contact.person.phone,
          })),
        },
      });
    }

    if (command === "create_activity" && moduleId === "activities") {
      const role = normalizeRole(claims.role);
      if (role === "viewer") {
        return reply.code(403).send({ ok: false, error: "Role cannot create activities" });
      }
      const contactId = String(args.contactId || "").trim();
      const type = String(args.type || "note").trim().toLowerCase();
      const subject = String(args.subject || "").trim();
      const body = String(args.body || subject).trim();
      if (!contactId || !subject) {
        return reply
          .code(400)
          .send({ ok: false, error: "contactId and subject are required" });
      }
      if (!ACTIVITY_TYPES.has(type)) {
        return reply.code(400).send({ ok: false, error: "Invalid activity type" });
      }

      const contact = await getContact(contactId);
      if (!contact) {
        return reply.code(404).send({ ok: false, error: "Contact not found" });
      }
      const contactOrg = contact.person.organizationId?.trim();
      if (contactOrg && contactOrg !== claims.organizationId) {
        return reply.code(404).send({ ok: false, error: "Contact not found" });
      }

      const actorUserId = await resolveOrgStaffUserId(
        claims.organizationId,
        claims.actorId,
      );
      let assigneeUserId: string | null = null;
      let dueAt: Date | null = null;
      if (type === "task") {
        assigneeUserId = await resolveOrgStaffUserId(
          claims.organizationId,
          String(args.assigneeUserId || "") ||
            contact.crm.ownerUserId ||
            contact.person.ownerUserId ||
            actorUserId,
        );
        if (!assigneeUserId) {
          return reply
            .code(400)
            .send({ ok: false, error: "No CRM user available to assign the task" });
        }
        const dueRaw = String(args.dueAt || "").trim();
        dueAt = dueRaw ? new Date(dueRaw) : new Date(Date.now() + 2 * 86400000);
        if (Number.isNaN(dueAt.getTime())) {
          return reply.code(400).send({ ok: false, error: "Invalid dueAt" });
        }
      }

      try {
        const activity = await createContactActivity(contactId, {
          type: type as "note" | "call" | "email" | "meeting" | "task" | "sms",
          subject,
          body: body || subject,
          dueAt,
          assigneeUserId,
          taskStatus: type === "task" ? "open" : null,
          organizationId: claims.organizationId,
          createdByUserId: actorUserId,
        });
        notifyAdminsOfLeadEventAsync({
          kind: "lead_activity",
          contactId,
          contactName: contact.displayName,
          companyName: contact.person.company?.name ?? null,
          ownerUserId: contact.crm.ownerUserId ?? contact.person.ownerUserId,
          actorUserId,
          activityType: activity.type,
          activitySubject: activity.subject,
          href: `/contact/${contactId}`,
        });
        return reply.send({
          ok: true,
          data: {
            activityId: activity.id,
            contactId,
            type: activity.type,
            subject: activity.subject,
            assigneeUserId,
          },
        });
      } catch (err) {
        return reply.code(400).send({
          ok: false,
          error: err instanceof Error ? err.message : "Failed to create activity",
        });
      }
    }

    if (command !== "update_deal_stage" || moduleId !== "sales") {
      return reply.code(400).send({ ok: false, error: "Unsupported MCP command" });
    }
    const role = normalizeRole(claims.role);
    if (!canEditDeals(role)) {
      return reply.code(403).send({ ok: false, error: "Role cannot edit deals" });
    }
    const dealId = String(args.dealId || "").trim();
    const stage = String(args.stage || "").trim();
    const lostReason = String(args.lostReason || "").trim() || null;
    if (!dealId || !DEAL_STAGES.has(stage)) {
      return reply.code(400).send({ ok: false, error: "Invalid deal stage command" });
    }
    const prisma = getPrismaClient();
    const deal = await prisma.deal.findFirst({
      where: { id: dealId, organizationId: BigInt(claims.organizationId) },
      select: { id: true, contactId: true },
    });
    if (!deal) return reply.code(404).send({ ok: false, error: "Deal not found" });
    await updateDealStage(dealId, stage as Parameters<typeof updateDealStage>[1], {
      lostReason,
      actorUserId: claims.actorId,
    });
    return reply.send({
      ok: true,
      data: { dealId, stage, contactId: deal.contactId },
    });
  });

  const memoryClaims = (request: { headers: { authorization?: string } }) => {
    const auth = request.headers.authorization || "";
    const token = auth.toLowerCase().startsWith("bearer ")
      ? auth.slice(7).trim()
      : "";
    return verifyMcpExecutionJwt(token);
  };

  app.get<{
    Querystring: { contactId?: string; dealId?: string };
  }>("/agent-memory", async (request, reply) => {
    const claims = memoryClaims(request);
    if (!claims || !/^\d+$/.test(claims.organizationId)) {
      return reply.code(401).send({ ok: false, error: "Unauthorized" });
    }
    const slots = await listAgentMemories({
      organizationId: claims.organizationId,
      userId: claims.actorId,
      contactId: request.query?.contactId,
      dealId: request.query?.dealId,
    });
    return reply.send({ ok: true, slots, map: memoriesToPromptMap(slots) });
  });

  app.post<{
    Body: {
      scopeType?: string;
      scopeId?: string;
      slotKey?: string;
      slotValue?: unknown;
      expiresInSeconds?: number;
    };
  }>("/agent-memory", async (request, reply) => {
    const claims = memoryClaims(request);
    if (!claims || !/^\d+$/.test(claims.organizationId)) {
      return reply.code(401).send({ ok: false, error: "Unauthorized" });
    }
    const body = request.body || {};
    const rawScope = String(body.scopeType || "user");
    const slotKey = String(body.slotKey || "").trim();
    if (!isAllowedMemoryScopeType(rawScope) || !isAllowedMemorySlotKey(slotKey)) {
      return reply.code(400).send({ ok: false, error: "Invalid memory slot" });
    }
    const expires = body.expiresInSeconds;
    if (
      expires !== undefined &&
      (!Number.isInteger(expires) || expires < 60 || expires > 31_536_000)
    ) {
      return reply.code(400).send({ ok: false, error: "Invalid memory expiry" });
    }
    const scopeType: AgentMemoryScopeType = rawScope;
    let scopeId = scopeType === "user" ? claims.actorId : String(body.scopeId || "").trim();
    if (scopeType === "org") {
      if (!["admin", "sales_manager"].includes(normalizeRole(claims.role))) {
        return reply.code(403).send({ ok: false, error: "Org memory requires manager access" });
      }
      scopeId = "";
    }
    if (scopeType !== "org" && !scopeId) {
      return reply.code(400).send({ ok: false, error: "Memory scope id required" });
    }
    const prisma = getPrismaClient();
    const organizationId = BigInt(claims.organizationId);
    if (scopeType === "contact") {
      const contact = await prisma.contactProfile.findFirst({
        where: { organizationId, accountContactId: scopeId },
        select: { id: true },
      });
      if (!contact) return reply.code(404).send({ ok: false, error: "Contact not found" });
    }
    if (scopeType === "deal") {
      const deal = await prisma.deal.findFirst({
        where: { organizationId, id: scopeId },
        select: { id: true },
      });
      if (!deal) return reply.code(404).send({ ok: false, error: "Deal not found" });
    }
    const slot = await upsertAgentMemory({
      organizationId: claims.organizationId,
      scopeType,
      scopeId,
      slotKey,
      slotValue: body.slotValue,
      source: "orchestrator",
      expiresAt:
        expires === undefined ? null : new Date(Date.now() + expires * 1000),
    });
    return reply.send({ ok: true, slot });
  });

  app.delete<{
    Body: { scopeType?: string; scopeId?: string; slotKey?: string };
  }>("/agent-memory", async (request, reply) => {
    const claims = memoryClaims(request);
    if (!claims || !/^\d+$/.test(claims.organizationId)) {
      return reply.code(401).send({ ok: false, error: "Unauthorized" });
    }
    const body = request.body || {};
    const rawScope = String(body.scopeType || "user");
    const slotKey = String(body.slotKey || "").trim();
    if (!isAllowedMemoryScopeType(rawScope) || !isAllowedMemorySlotKey(slotKey)) {
      return reply.code(400).send({ ok: false, error: "Invalid memory slot" });
    }
    const scopeType: AgentMemoryScopeType = rawScope;
    let scopeId = scopeType === "user" ? claims.actorId : String(body.scopeId || "").trim();
    if (scopeType === "org") {
      if (!["admin", "sales_manager"].includes(normalizeRole(claims.role))) {
        return reply.code(403).send({ ok: false, error: "Org memory requires manager access" });
      }
      scopeId = "";
    }
    if (scopeType !== "org" && !scopeId) {
      return reply.code(400).send({ ok: false, error: "Memory scope id required" });
    }
    const prisma = getPrismaClient();
    const organizationId = BigInt(claims.organizationId);
    if (scopeType === "contact") {
      const contact = await prisma.contactProfile.findFirst({
        where: { organizationId, accountContactId: scopeId },
        select: { id: true },
      });
      if (!contact) return reply.code(404).send({ ok: false, error: "Contact not found" });
    }
    if (scopeType === "deal") {
      const deal = await prisma.deal.findFirst({
        where: { organizationId, id: scopeId },
        select: { id: true },
      });
      if (!deal) return reply.code(404).send({ ok: false, error: "Deal not found" });
    }
    const cleared = await clearAgentMemory({
      organizationId: claims.organizationId,
      scopeType,
      scopeId,
      slotKey,
    });
    return reply.send({ ok: true, cleared });
  });
};
