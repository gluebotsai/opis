export const TENANT_FEATURE_FLAGS = [
  "dialog-routing",
  "presence-db-read",
  "publish-only-presence",
  "offer-snapshot",
] as const;

export type TenantFeatureFlag = (typeof TENANT_FEATURE_FLAGS)[number];

export const TENANT_FEATURE_FLAG_ENV: Readonly<Record<TenantFeatureFlag, string>> = {
  "dialog-routing": "CCAAS_DIALOG_ROUTING_ORGANIZATIONS",
  "presence-db-read": "CCAAS_PRESENCE_DB_READ_ORGANIZATIONS",
  "publish-only-presence": "CCAAS_PUBLISH_ONLY_PRESENCE_ORGANIZATIONS",
  "offer-snapshot": "CCAAS_OFFER_SNAPSHOT_ORGANIZATIONS",
};

export type TenantFeatureFlagSnapshot = Readonly<Record<TenantFeatureFlag, boolean>>;

function requireOrganizationId(organizationId: string): string {
  const normalized = organizationId.trim();
  if (!normalized) {
    throw new Error("organizationId is required for tenant feature flags");
  }
  return normalized;
}

function parseOrganizationAllowlist(value: string | undefined): ReadonlySet<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
}

export type TenantFeatureFlagResolver = {
  isEnabled(flag: TenantFeatureFlag, organizationId: string): boolean;
  snapshot(organizationId: string): TenantFeatureFlagSnapshot;
};

/**
 * Builds an immutable tenant flag resolver from environment-style allowlists.
 * Every flag defaults off, and every lookup requires an organization id.
 */
export function createTenantFeatureFlagResolver(
  env: Readonly<Record<string, string | undefined>> = process.env,
): TenantFeatureFlagResolver {
  const allowlists = Object.fromEntries(
    TENANT_FEATURE_FLAGS.map((flag) => [
      flag,
      parseOrganizationAllowlist(env[TENANT_FEATURE_FLAG_ENV[flag]]),
    ]),
  ) as Record<TenantFeatureFlag, ReadonlySet<string>>;

  const isEnabled = (flag: TenantFeatureFlag, organizationId: string): boolean => {
    const tenant = requireOrganizationId(organizationId);
    return allowlists[flag].has(tenant);
  };

  return {
    isEnabled,
    snapshot(organizationId) {
      const tenant = requireOrganizationId(organizationId);
      return Object.fromEntries(
        TENANT_FEATURE_FLAGS.map((flag) => [flag, isEnabled(flag, tenant)]),
      ) as TenantFeatureFlagSnapshot;
    },
  };
}

let defaultResolver: TenantFeatureFlagResolver | null = null;

export function isTenantFeatureEnabled(
  flag: TenantFeatureFlag,
  organizationId: string,
): boolean {
  defaultResolver ??= createTenantFeatureFlagResolver();
  return defaultResolver.isEnabled(flag, organizationId);
}

/** Test/bootstrap seam for rebuilding the process-level environment snapshot. */
export function resetTenantFeatureFlagResolver(): void {
  defaultResolver = null;
}
