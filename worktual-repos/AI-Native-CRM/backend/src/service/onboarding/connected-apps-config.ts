/** Onboarding internal API for org connected-app credentials (replaces CRM reads of accounts.setup_app_connections). */

export function onboardingInternalBaseUrl(): string {
  return (
    process.env.ONBOARDING_INTERNAL_BASE_URL?.trim() ||
    "https://staging-onboarding.worktual.com"
  ).replace(/\/$/, "");
}

export function productMcpConnectorsToken(): string {
  return process.env.PRODUCT_MCP_CONNECTORS_TOKEN?.trim() || "";
}

export function isOnboardingConnectorsConfigured(): boolean {
  return Boolean(productMcpConnectorsToken());
}

/** When true, CRM may still SELECT accounts.setup_app_connections (local dev / migration only). */
export function allowSetupAppConnectionsFallback(): boolean {
  const raw = (
    process.env.ONBOARDING_ALLOW_SETUP_APP_CONNECTIONS_FALLBACK || ""
  )
    .trim()
    .toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}
