/**
 * Org research provider configs (Apollo / ZoomInfo / Lusha / BuiltWith).
 */

import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { getPrismaClient } from "@/dao/db/prisma";
import {
  decryptGatewaySecret,
  encryptGatewaySecret,
} from "@/service/finance/gateway-secret-crypto";

export const RESEARCH_PROVIDERS = [
  "apollo",
  "zoominfo",
  "lusha",
  "builtwith",
] as const;

export type ResearchProviderId = (typeof RESEARCH_PROVIDERS)[number];

export type OrgResearchProviderView = {
  provider: ResearchProviderId;
  enabled: boolean;
  configured: boolean;
  apiKeyHint: string | null;
  settings: Record<string, unknown> | null;
  updatedAt: string | null;
  /** Keys from Onboarding connected-apps API or legacy accounts.setup_app_connections. */
  source: "accounts" | "crm_legacy" | "none";
  needsReauth: boolean;
  displayName: string | null;
  accountEmail: string | null;
};

export type OrgResearchProviderSecret = {
  provider: ResearchProviderId;
  enabled: boolean;
  apiKey: string | null;
  settings: Record<string, unknown> | null;
};

function cuidLike(): string {
  return `rpc_${randomBytes(12).toString("hex")}`;
}

function isProvider(value: string): value is ResearchProviderId {
  return (RESEARCH_PROVIDERS as readonly string[]).includes(value);
}

function hintFromKey(key: string): string {
  const t = key.trim();
  if (t.length <= 4) return "••••";
  return `••••${t.slice(-4)}`;
}

function asSettings(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return raw as Record<string, unknown>;
}

function orgId(value: string): bigint {
  return BigInt(value);
}

export async function listOrgResearchProviderConfigs(
  organizationId: string,
): Promise<OrgResearchProviderView[]> {
  const { listResearchAppConnectionStatus } = await import(
    "@/dao/account/setup-app-connections"
  );
  const prisma = getPrismaClient();
  const [accounts, rows] = await Promise.all([
    listResearchAppConnectionStatus(organizationId),
    prisma.orgResearchProviderConfig.findMany({
      where: { organizationId: orgId(organizationId) },
    }),
  ]);
  const byProvider = new Map(
    rows.map((r) => [String(r.provider) as ResearchProviderId, r]),
  );
  const byAccounts = new Map(accounts.map((a) => [a.provider, a]));
  const { isZoominfoGatewayConfigured } = await import(
    "@/service/zoominfo/zoominfo-gateway"
  );
  const zoominfoGateway = isZoominfoGatewayConfigured();
  return RESEARCH_PROVIDERS.map((provider) => {
    const row = byProvider.get(provider);
    const account = byAccounts.get(provider);
    if (provider === "zoominfo" && zoominfoGateway) {
      return {
        provider,
        enabled: true,
        configured: true,
        apiKeyHint: "gateway",
        settings: asSettings(row?.settings),
        updatedAt: row?.updatedAt?.toISOString() ?? null,
        source: "accounts" as const,
        needsReauth: false,
        displayName: "ZoomInfo (gateway)",
        accountEmail: null,
      };
    }
    if (account?.connected) {
      return {
        provider,
        enabled: true,
        configured: true,
        apiKeyHint: account.accountEmail || account.displayName || "••••",
        settings: asSettings(row?.settings),
        updatedAt: row?.updatedAt?.toISOString() ?? null,
        source: "accounts" as const,
        needsReauth: false,
        displayName: account.displayName,
        accountEmail: account.accountEmail,
      };
    }
    if (account?.needsReauth) {
      return {
        provider,
        enabled: false,
        configured: false,
        apiKeyHint: null,
        settings: asSettings(row?.settings),
        updatedAt: row?.updatedAt?.toISOString() ?? null,
        source: "accounts" as const,
        needsReauth: true,
        displayName: account.displayName,
        accountEmail: account.accountEmail,
      };
    }
    // Legacy CRM-stored keys until Accounts rows exist for this org.
    if (row?.apiKeyEnc) {
      return {
        provider,
        enabled: row.enabled,
        configured: true,
        apiKeyHint: row.apiKeyHint,
        settings: asSettings(row.settings),
        updatedAt: row.updatedAt?.toISOString() ?? null,
        source: "crm_legacy" as const,
        needsReauth: false,
        displayName: null,
        accountEmail: null,
      };
    }
    return {
      provider,
      enabled: false,
      configured: false,
      apiKeyHint: null,
      settings: asSettings(row?.settings),
      updatedAt: row?.updatedAt?.toISOString() ?? null,
      source: "none" as const,
      needsReauth: false,
      displayName: null,
      accountEmail: null,
    };
  });
}

export async function upsertOrgResearchProviderConfig(input: {
  organizationId: string;
  provider: ResearchProviderId;
  enabled?: boolean;
  apiKey?: string | null;
  clearApiKey?: boolean;
  settings?: Record<string, unknown> | null;
  updatedByUserId: string | null;
}): Promise<OrgResearchProviderView> {
  if (!isProvider(input.provider)) {
    throw new Error("Invalid research provider.");
  }
  const prisma = getPrismaClient();
  const oid = orgId(input.organizationId);
  const existing = await prisma.orgResearchProviderConfig.findUnique({
    where: {
      organizationId_provider: {
        organizationId: oid,
        provider: input.provider,
      },
    },
  });

  let apiKeyEnc = existing?.apiKeyEnc ?? null;
  let apiKeyHint = existing?.apiKeyHint ?? null;
  if (input.clearApiKey) {
    apiKeyEnc = null;
    apiKeyHint = null;
  } else if (input.apiKey != null && input.apiKey.trim()) {
    const plain = input.apiKey.trim();
    apiKeyEnc = encryptGatewaySecret(plain);
    apiKeyHint = hintFromKey(plain);
  }

  const enabled =
    input.enabled !== undefined
      ? input.enabled
      : (existing?.enabled ?? false);
  const settingsJson =
    input.settings !== undefined
      ? input.settings === null
        ? Prisma.JsonNull
        : (input.settings as Prisma.InputJsonValue)
      : existing?.settings === null || existing?.settings === undefined
        ? undefined
        : (existing.settings as Prisma.InputJsonValue);

  const row = await prisma.orgResearchProviderConfig.upsert({
    where: {
      organizationId_provider: {
        organizationId: oid,
        provider: input.provider,
      },
    },
    create: {
      id: cuidLike(),
      organizationId: oid,
      provider: input.provider,
      enabled,
      apiKeyEnc,
      apiKeyHint,
      settings: settingsJson,
      updatedByUserId: input.updatedByUserId
        ? BigInt(input.updatedByUserId)
        : null,
    },
    update: {
      enabled,
      apiKeyEnc,
      apiKeyHint,
      ...(settingsJson !== undefined ? { settings: settingsJson } : {}),
      updatedByUserId: input.updatedByUserId
        ? BigInt(input.updatedByUserId)
        : null,
    },
  });

  return {
    provider: input.provider,
    enabled: row.enabled,
    configured: Boolean(row.apiKeyEnc),
    apiKeyHint: row.apiKeyHint,
    settings: asSettings(row.settings),
    updatedAt: row.updatedAt.toISOString(),
    source: row.apiKeyEnc ? ("crm_legacy" as const) : ("none" as const),
    needsReauth: false,
    displayName: null,
    accountEmail: null,
  };
}

/** Decrypt keys for agents — Accounts first, then legacy CRM rows. */
export async function listEnabledResearchProviderSecrets(
  organizationId: string,
): Promise<OrgResearchProviderSecret[]> {
  const { listResearchAppConnectionStatus } = await import(
    "@/dao/account/setup-app-connections"
  );
  const {
    isZoominfoGatewayConfigured,
    ZOOMINFO_GATEWAY_API_KEY,
  } = await import("@/service/zoominfo/zoominfo-gateway");
  const prisma = getPrismaClient();
  const [accounts, rows] = await Promise.all([
    listResearchAppConnectionStatus(organizationId, { includeSecrets: true }),
    prisma.orgResearchProviderConfig.findMany({
      where: { organizationId: orgId(organizationId) },
    }),
  ]);
  const byCrm = new Map(
    rows.map((r) => [String(r.provider) as ResearchProviderId, r]),
  );
  const out: OrgResearchProviderSecret[] = [];
  for (const provider of RESEARCH_PROVIDERS) {
    if (provider === "zoominfo" && isZoominfoGatewayConfigured()) {
      const crmSettings = asSettings(byCrm.get(provider)?.settings) || {};
      out.push({
        provider,
        enabled: true,
        apiKey: ZOOMINFO_GATEWAY_API_KEY,
        settings: { ...crmSettings, organizationId },
      });
      continue;
    }
    const account = accounts.find((a) => a.provider === provider);
    if (account?.connected && account.apiKey) {
      out.push({
        provider,
        enabled: true,
        apiKey: account.apiKey,
        settings: asSettings(byCrm.get(provider)?.settings),
      });
      continue;
    }
    const row = byCrm.get(provider);
    if (!row?.enabled || !row.apiKeyEnc) continue;
    let apiKey: string | null = null;
    try {
      apiKey = decryptGatewaySecret(row.apiKeyEnc);
    } catch {
      apiKey = null;
    }
    if (!apiKey) continue;
    out.push({
      provider,
      enabled: true,
      apiKey,
      settings: asSettings(row.settings),
    });
  }
  return out;
}

export async function getOrgCompetitorStacks(
  organizationId: string,
): Promise<string[]> {
  const configs = await listOrgResearchProviderConfigs(organizationId);
  const stacks = new Set<string>();
  for (const c of configs) {
    const raw = c.settings?.competitorStacks;
    if (!Array.isArray(raw)) continue;
    for (const item of raw) {
      if (typeof item === "string" && item.trim()) {
        stacks.add(item.trim());
      }
    }
  }
  return [...stacks];
}

export async function setOrgCompetitorStacks(input: {
  organizationId: string;
  competitorStacks: string[];
  updatedByUserId: string | null;
}): Promise<string[]> {
  const stacks = input.competitorStacks
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 50);
  await upsertOrgResearchProviderConfig({
    organizationId: input.organizationId,
    provider: "builtwith",
    settings: { competitorStacks: stacks },
    updatedByUserId: input.updatedByUserId,
  });
  return stacks;
}
