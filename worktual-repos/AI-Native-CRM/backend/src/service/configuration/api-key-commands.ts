import { canManageUsers } from "@/service/auth/rbac";
import {
  ForbiddenError,
  getCurrentOrganizationId,
  requireRole,
} from "@/service/auth/require-role";
import { getServerUserId } from "@/service/account/session-cookie";
import {
  createApiKey,
  listApiKeysForOrg,
  revokeApiKey,
} from "@/dao/configuration/api-key-store";
import {
  normalizeApiKeyScopes,
  type ApiKeyScope,
} from "@/lib/api-key-scopes";

export async function listTenantApiKeysCommand() {
  try {
    await requireRole(canManageUsers, "Only admins can manage API keys.");
    const organizationId = await getCurrentOrganizationId();
    const items = await listApiKeysForOrg(organizationId);
    return {
      ok: true as const,
      items: items.map((k) => ({
        id: k.id,
        name: k.name,
        keyPrefix: k.keyPrefix,
        scopes: k.scopes,
        createdAt: k.createdAt.toISOString(),
        lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
      })),
    };
  } catch (err) {
    return {
      ok: false as const,
      error:
        err instanceof Error ? err.message : "Failed to list API keys.",
      status: err instanceof ForbiddenError ? 403 : 400,
    };
  }
}

export async function createTenantApiKeyCommand(input: {
  name?: string;
  scopes?: unknown;
}) {
  try {
    await requireRole(canManageUsers, "Only admins can manage API keys.");
    const organizationId = await getCurrentOrganizationId();
    const userId = await getServerUserId();
    if (!userId) throw new ForbiddenError("Not signed in.");
    const scopes = normalizeApiKeyScopes(input.scopes) as ApiKeyScope[];
    const { row, secret } = await createApiKey({
      organizationId,
      name: String(input.name ?? "").trim(),
      scopes,
      createdByUserId: userId,
    });
    return {
      ok: true as const,
      secret,
      key: {
        id: row.id,
        name: row.name,
        keyPrefix: row.keyPrefix,
        scopes: row.scopes,
        createdAt: row.createdAt.toISOString(),
        lastUsedAt: null as string | null,
      },
    };
  } catch (err) {
    return {
      ok: false as const,
      error:
        err instanceof Error ? err.message : "Failed to create API key.",
      status: err instanceof ForbiddenError ? 403 : 400,
    };
  }
}

export async function revokeTenantApiKeyCommand(id: string) {
  try {
    await requireRole(canManageUsers, "Only admins can manage API keys.");
    const organizationId = await getCurrentOrganizationId();
    const ok = await revokeApiKey({ organizationId, id });
    if (!ok) {
      return { ok: false as const, error: "API key not found.", status: 404 };
    }
    return { ok: true as const, id };
  } catch (err) {
    return {
      ok: false as const,
      error:
        err instanceof Error ? err.message : "Failed to revoke API key.",
      status: err instanceof ForbiddenError ? 403 : 400,
    };
  }
}
