/**
 * Framework-agnostic Marketing / Campaign MS handoff for Fastify Wave 12.
 * Campaign data stays in campaign_db; CRM receives leads via webhook.
 */

import { upsertLeadContact } from "@/dao/contacts/inbound-lead-upsert";
import { locationFromInbound } from "@/lib/inbound-location";
import { onLeadCreated } from "@/service/ai/lead-pipeline";
import { writeAuditLog } from "@/dao/audit/audit-log";
import { issueCrmAccessJwt } from "@/service/account/crm-access-jwt";
import {
  campaignUiBaseUrl,
  createCampaign,
  isCampaignConnectConfigured,
  isMarketingMsConfigured,
  listCampaigns,
  marketingMsBaseUrl,
  peekCampaignProbe,
  probeCampaignReachability,
  verifyMarketingWebhookHeaders,
  type CreateCampaignBody,
} from "@/service/integrations/marketing-ms";
import { notifyAdminsOfLeadEventAsync } from "@/dao/notifications/notify-admins";
import {
  ForbiddenError,
  getCurrentBusinessType,
  getCurrentOrganizationId,
  getCurrentUserRole,
  resolveRequestOrganizationId,
} from "@/service/auth/require-role";
import { getServerUserId } from "@/service/account/session-cookie";
import { isModuleEnabledForAccess } from "@/config/modules";

const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 30;
const hits = new Map<string, { count: number; resetAt: number }>();

const CAMPAIGN_BUCKETS = new Set([
  "live",
  "scheduled",
  "past",
  "draft",
  "all",
  "calendar",
]);

function rateLimit(key: string): boolean {
  const now = Date.now();
  const row = hits.get(key);
  if (!row || now > row.resetAt) {
    hits.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  if (row.count >= RATE_MAX) return false;
  row.count += 1;
  return true;
}

async function requireMarketingAccess() {
  const userId = await getServerUserId();
  if (!userId) {
    throw new ForbiddenError("Not signed in.");
  }
  const role = await getCurrentUserRole();
  const businessType = await getCurrentBusinessType();
  if (!isModuleEnabledForAccess("marketing", businessType, role)) {
    throw new ForbiddenError("Marketing is not available for your role.");
  }
  const organizationId = await getCurrentOrganizationId();
  return { userId, organizationId, role };
}

function mintMarketingJwt(scope: {
  userId: string;
  organizationId: string;
  role: string;
}) {
  const token = issueCrmAccessJwt({
    userId: scope.userId,
    organizationId: scope.organizationId,
    role: scope.role,
  });
  if (!token) {
    throw new ForbiddenError(
      "Campaign connect is not configured (JWT_ACCESS_SECRET missing).",
    );
  }
  return token;
}

export async function getMarketingStatusCommand() {
  const base = marketingMsBaseUrl()?.replace(/\/$/, "") ?? null;
  const uiUrl = campaignUiBaseUrl()?.replace(/\/$/, "") ?? null;
  const configured = isMarketingMsConfigured();
  const connectReady = isCampaignConnectConfigured();
  const probe = configured ? await probeCampaignReachability() : null;

  return {
    configured,
    connectReady,
    baseUrl: base,
    uiUrl,
    apiReachable: probe?.apiReachable ?? false,
    uiReachable: probe?.uiReachable ?? false,
    reachable: probe?.reachable ?? false,
  };
}

export async function getMarketingEmbedSessionCommand() {
  const scope = await requireMarketingAccess();
  if (!isCampaignConnectConfigured()) {
    return {
      ok: false as const,
      error: "Campaign connect is not fully configured.",
      status: 503,
    };
  }

  const uiOrigin = campaignUiBaseUrl()?.replace(/\/$/, "") ?? null;
  const token = mintMarketingJwt(scope);

  // Do not await probes on the embed hot path — they can add seconds of latency.
  // Use last known probe if fresh; otherwise optimistic when UI URL is configured.
  // Refresh probe in the background for the next status/list call.
  const cached = peekCampaignProbe();
  void probeCampaignReachability().catch(() => {
    /* best-effort */
  });

  const uiReachable = cached && !cached.stale ? cached.uiReachable : Boolean(uiOrigin);
  const apiReachable = cached && !cached.stale ? cached.apiReachable : true;

  return {
    ok: true as const,
    token,
    uiOrigin,
    apiReachable,
    uiReachable,
    reachable: Boolean(uiOrigin),
  };
}

export async function listMarketingCampaignsCommand(bucket: string) {
  const scope = await requireMarketingAccess();
  if (!isCampaignConnectConfigured()) {
    return {
      ok: false as const,
      error: "Campaign connect is not fully configured.",
      status: 503,
    };
  }

  const normalized = CAMPAIGN_BUCKETS.has(bucket) ? bucket : "all";
  const token = mintMarketingJwt(scope);
  const result = await listCampaigns(token, normalized);

  if (!result.ok) {
    return {
      ok: false as const,
      error: result.error,
      status: result.status,
    };
  }

  const items =
    result.data.getCampaignDetails ??
    result.data.campaigns ??
    [];

  return {
    ok: true as const,
    bucket: normalized,
    campaigns: items,
    status: result.status,
  };
}

export async function createMarketingCampaignCommand(
  body: Record<string, unknown>,
) {
  const scope = await requireMarketingAccess();
  if (!isCampaignConnectConfigured()) {
    return {
      ok: false as const,
      error: "Campaign connect is not fully configured.",
      status: 503,
    };
  }

  const name = String(body.name ?? "").trim();
  if (!name) {
    return {
      ok: false as const,
      error: "name is required.",
      status: 400,
    };
  }

  const token = mintMarketingJwt(scope);

  const payload: CreateCampaignBody = {
    name,
    description:
      typeof body.description === "string" ? body.description : null,
    goal: typeof body.goal === "string" ? body.goal : null,
    objective: typeof body.objective === "string" ? body.objective : null,
    status: typeof body.status === "string" ? body.status : "draft",
    startsAt: typeof body.startsAt === "string" ? body.startsAt : null,
    endsAt: typeof body.endsAt === "string" ? body.endsAt : null,
  };

  const result = await createCampaign(token, payload);
  if (!result.ok) {
    return {
      ok: false as const,
      error: result.error,
      status: result.status,
    };
  }

  return {
    ok: true as const,
    id: result.data.id ?? null,
    status: result.status,
  };
}

export async function ingestMarketingLeadCommand(input: {
  headers: {
    authorization?: string | null;
    "x-marketing-token"?: string | null;
  };
  ip: string;
  body: Record<string, unknown>;
}): Promise<
  | { ok: true; id: string; merged: boolean; status: number }
  | { ok: false; error: string; status: number }
> {
  if (!verifyMarketingWebhookHeaders(input.headers)) {
    return { ok: false, error: "Unauthorized", status: 401 };
  }

  if (!rateLimit(input.ip || "unknown")) {
    return { ok: false, error: "Rate limit exceeded.", status: 429 };
  }

  const body = input.body;
  const firstName = String(body.firstName ?? "").trim();
  const lastName = String(body.lastName ?? "").trim() || "Lead";
  const email = String(body.email ?? "").trim().toLowerCase();
  if (!firstName || !email || !email.includes("@")) {
    return {
      ok: false,
      error: "firstName and valid email are required.",
      status: 400,
    };
  }

  try {
    const organizationId = await resolveRequestOrganizationId(
      typeof body.organizationId === "string" ? body.organizationId : null,
    );
    const ownerUserId =
      typeof body.ownerUserId === "string" ? body.ownerUserId.trim() : null;

    const phone = typeof body.phone === "string" ? body.phone : null;
    const loc = locationFromInbound(body, phone);

    const { contact, merged, primaryContactId, archivedContactIds } =
      await upsertLeadContact(
        {
          firstName,
          lastName,
          email,
          phone,
          city: loc.city,
          country: loc.country,
          addressLine: loc.addressLine,
          companyName:
            typeof body.companyName === "string" ? body.companyName : null,
          ownerUserId,
          leadSource:
            typeof body.leadSource === "string"
              ? body.leadSource
              : "marketing_ms",
          leadStatus: "new",
          contactType: "lead",
          notes: typeof body.notes === "string" ? body.notes : null,
          status: "active",
        },
        {
          organizationId,
          source: "marketing_ms",
        },
      );

    try {
      const { accountQuery } = await import("@/dao/db/account-pool");
      await accountQuery(
        `UPDATE cdp.customer_profile
         SET organization_id = $2::bigint, updated_at = now()
         WHERE cdp_id = $1::text`,
        [contact.id, organizationId],
      );
      await accountQuery(
        `UPDATE cdp.identity_keys
         SET organization_id = $2::bigint
         WHERE cdp_id = $1::text`,
        [contact.id, organizationId],
      );
    } catch {
      /* optional */
    }

    await writeAuditLog({
      action: merged ? "merge" : "create",
      entityType: "contact",
      entityId: contact.id,
      organizationId,
      meta: {
        source: "marketing_ms",
        ip: input.ip,
        ownerUserId,
        merged,
        primaryContactId,
        archivedContactIds,
      },
    });

    await onLeadCreated({
      contactId: contact.id,
      organizationId,
      companyId: contact.person.companyId,
      triggerReason: merged ? "marketing_merged" : "marketing_inbound",
    });

    notifyAdminsOfLeadEventAsync({
      kind: "lead_inbound",
      organizationId,
      contactId: contact.id,
      contactName: contact.displayName,
      companyName:
        contact.person.company?.name ??
        (typeof body.companyName === "string" ? body.companyName : null),
      ownerUserId:
        ownerUserId ||
        contact.crm.ownerUserId ||
        contact.person.ownerUserId ||
        null,
      detail: merged
        ? "Marketing lead matched an existing contact and merged."
        : `Source: ${typeof body.leadSource === "string" ? body.leadSource : "marketing_ms"}`,
      excludeUserId: null,
    });

    return {
      ok: true,
      id: contact.id,
      merged,
      status: merged ? 200 : 201,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to create lead.",
      status: 500,
    };
  }
}
