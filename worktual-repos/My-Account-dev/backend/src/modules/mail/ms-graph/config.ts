const TENANT_ALIASES = new Set(["common", "organizations", "consumers"]);

function env(name: any) {
  let value = process.env[name]?.trim() || "";

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }

  return value;
}

function isTenantGuid(value: any) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export const MS_GRAPH_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "User.Read",
  "Mail.Read",
  "Mail.Send",
];

function envFlag(name: any) {
  return env(name).toLowerCase() === "true";
}

export function getMicrosoftMailScopes() {
  const scopes = [...MS_GRAPH_SCOPES];
  if (envFlag("MS_GRAPH_INCLUDE_READWRITE")) {
    scopes.push("Mail.ReadWrite");
  }
  return scopes;
}

export function getGrantedMicrosoftScopes(accessToken: any, grantedScopeString = "") {
  const claims = decodeMicrosoftAccessToken(accessToken);
  const raw = String(grantedScopeString || claims.scp || "").trim();
  return raw.split(/\s+/).filter(Boolean);
}

export function hasMicrosoftMailScope(accessToken: any, grantedScopeString = "") {
  const scopes = new Set(getGrantedMicrosoftScopes(accessToken, grantedScopeString));
  const mailScopes = [
    "Mail.Read",
    "Mail.ReadWrite",
    "Mail.ReadBasic",
    "https://graph.microsoft.com/Mail.Read",
    "https://graph.microsoft.com/Mail.ReadWrite",
    "https://graph.microsoft.com/Mail.ReadBasic",
  ];
  return mailScopes.some((scope) => scopes.has(scope));
}

export function getMicrosoftAdminConsentUrl(tenantId = "") {
  const tenant = tenantId || getMicrosoftAppTenantId();
  if (!tenant) {
    return "";
  }

  const params = new URLSearchParams({
    client_id: getMicrosoftClientId(),
    redirect_uri: getMicrosoftRedirectUri(),
  });

  const scope = getMicrosoftMailScopes().join(" ");
  if (scope) {
    params.set("scope", scope);
  }

  return `https://login.microsoftonline.com/${tenant}/v2.0/adminconsent?${params.toString()}`;
}

export function assertMicrosoftMailScopes(accessToken: any, grantedScopeString = "") {
  if (hasMicrosoftMailScope(accessToken, grantedScopeString)) {
    return;
  }

  const granted = getGrantedMicrosoftScopes(accessToken, grantedScopeString);
  const adminUrl = getMicrosoftAdminConsentUrl(decodeMicrosoftAccessToken(accessToken).tid);

  throw new Error(
    [
      "Mail.Read was not granted to this app.",
      `Granted scopes: ${granted.length ? granted.join(", ") : "none"}.`,
      "In Azure Portal → App registrations → API permissions → add delegated Mail.Read and Mail.Send → click Grant admin consent.",
      `Admin consent URL: ${adminUrl}`,
      "Then disconnect and sign in with Microsoft again.",
    ].join(" "),
  );
}

export function getMicrosoftClientId() {
  return env("MS_CLIENT_ID");
}

export function getMicrosoftClientSecret() {
  return env("MS_CLIENT_SECRET");
}

export function getMicrosoftCertThumbprint() {
  return env("MS_CERT_THUMBPRINT");
}

export function getMicrosoftPrivateKeyPath() {
  return env("MS_PRIVATE_KEY_PATH");
}

export function normalizeCertThumbprint(value = "") {
  return String(value || "").replace(/[\s:]/g, "").toUpperCase();
}

export function usesMicrosoftCertificateAuth() {
  return Boolean(getMicrosoftCertThumbprint() && getMicrosoftPrivateKeyPath());
}

export function usesMicrosoftClientSecretAuth() {
  return Boolean(getMicrosoftClientSecret());
}

export function getMicrosoftAuthMode() {
  if (usesMicrosoftCertificateAuth()) {
    return "certificate";
  }

  if (usesMicrosoftClientSecretAuth()) {
    return "client_secret";
  }

  return "none";
}

export function getMicrosoftTenantId() {
  const configured = env("MS_TENANT_ID");
  if (!configured) {
    return "common";
  }

  return configured.toLowerCase();
}

/** Directory ID where the app registration lives — required for admin consent URLs. */
export function getMicrosoftAppTenantId() {
  const configured = env("MS_APP_TENANT_ID") || env("MS_TENANT_ID");
  if (!configured) {
    return "";
  }

  const value = configured.toLowerCase();
  if (value === "common" || value === "organizations" || value === "consumers") {
    return "";
  }

  return value;
}

export function isSpecificMicrosoftTenant() {
  return isTenantGuid(getMicrosoftTenantId());
}

export function getMicrosoftRedirectUri() {
  return env("MS_REDIRECT_URI");
}

export function getMicrosoftAuthority() {
  const tenant = getMicrosoftTenantId();
  const configured = env("MS_AUTHORITY").replace(/\/$/, "");

  if (!configured) {
    return `https://login.microsoftonline.com/${tenant}`;
  }

  // Common misconfiguration: base host without /{tenant}
  if (/^https:\/\/login\.microsoftonline\.com$/i.test(configured)) {
    return `${configured}/${tenant}`;
  }

  return configured;
}

export function getMicrosoftTokenEndpoint() {
  return `${getMicrosoftAuthority()}/oauth2/v2.0/token`;
}

export function getMicrosoftAuthorizeEndpoint() {
  return `${getMicrosoftAuthority()}/oauth2/v2.0/authorize`;
}

export function isMicrosoftMailConfigured() {
  return Boolean(
    getMicrosoftClientId() &&
      getMicrosoftRedirectUri() &&
      (usesMicrosoftCertificateAuth() || usesMicrosoftClientSecretAuth()),
  );
}

export function getAppUrl() {
  return env("APP_URL") || "http://localhost:5173";
}

export function decodeMicrosoftAccessToken(accessToken: any) {
  try {
    const segment = String(accessToken || "").split(".")[1];
    if (!segment) {
      return {};
    }

    const normalized = segment.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
  } catch {
    return {};
  }
}

export function getMicrosoftTokenEndpointForTenant(tenantId = "") {
  const tenant = tenantId || getMicrosoftTenantId();
  return `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;
}

export function formatMicrosoftAccountEmail(value = "") {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }

  if (raw.includes("#EXT#@")) {
    const localPart = raw.split("#EXT#@")[0] || "";
    const normalized = localPart.replace(/_([a-z0-9.-]+)$/i, (_match, domain) => `@${domain.replace(/_/g, ".")}`);
    if (normalized.includes("@")) {
      return normalized;
    }
  }

  return raw;
}

export function getMicrosoftOAuthDiagnostics() {
  const tenantId = getMicrosoftTenantId();
  const clientId = getMicrosoftClientId();
  const hints = [];

  if (isSpecificMicrosoftTenant()) {
    hints.push(
      "MS_TENANT_ID is a specific directory GUID. The app registration must exist in that exact Entra ID tenant.",
    );
    hints.push(
      "If you see AADSTS700016, either register the app inside that tenant or set MS_TENANT_ID=common for a multitenant app.",
    );
  } else if (TENANT_ALIASES.has(tenantId)) {
    hints.push(
      `Using multitenant login endpoint "${tenantId}". Ensure the Azure app supports external tenants and users can consent.`,
    );
  }

  if (!clientId) {
    hints.push("MS_CLIENT_ID is missing.");
  }

  if (!getMicrosoftAppTenantId()) {
    hints.push(
      "Set MS_APP_TENANT_ID to your app registration Directory (tenant) ID so admin consent links work.",
    );
  }

  if (usesMicrosoftCertificateAuth()) {
    hints.push("Using certificate-based Microsoft auth (MSAL + MS_CERT_THUMBPRINT).");
  } else if (!usesMicrosoftClientSecretAuth()) {
    hints.push(
      "Set MS_CERT_THUMBPRINT and MS_PRIVATE_KEY_PATH for certificate auth, or MS_CLIENT_SECRET for legacy secret auth.",
    );
  }

  const adminConsentUrl = getMicrosoftAdminConsentUrl();

  return {
    tenantId,
    tenantMode: isSpecificMicrosoftTenant() ? "single-directory" : "multitenant",
    appTenantId: getMicrosoftAppTenantId(),
    authMode: getMicrosoftAuthMode(),
    authorizeEndpoint: getMicrosoftAuthorizeEndpoint(),
    redirectUri: getMicrosoftRedirectUri(),
    adminConsentUrl,
    clientIdPreview: clientId ? `${clientId.slice(0, 8)}...` : "",
    hints,
  };
}

export function formatMicrosoftOAuthError(message = "") {
  const text = String(message);

  if (/AADSTS50194/i.test(text)) {
    return [
      "This Azure app is single-tenant but login used the /common endpoint.",
      "Fix option 1: In Azure → App registration → Authentication → set Supported account types to Multitenant, then use MS_TENANT_ID=common.",
      "Fix option 2: Keep single-tenant and set MS_TENANT_ID to the Directory (tenant) ID where this app is registered (from the app Overview page).",
    ].join(" ");
  }

  if (/AADSTS700016/i.test(text)) {
    return [
      "This Azure app is not registered in the Microsoft directory you signed into.",
      "Fix: set MS_TENANT_ID=common in .env (multitenant app), OR register the app inside Worktual Innovations Entra ID and use that tenant's Directory ID.",
      "Also verify MS_CLIENT_ID matches the Application (client) ID from the same Entra directory.",
    ].join(" ");
  }

  if (/AADSTS65001|consent/i.test(text)) {
    return [
      "Admin consent is required for mail permissions in your Microsoft tenant.",
      "Step 1: Click Grant admin consent in Azure (or ask your M365 admin).",
      "Step 2: After consent succeeds, click Sign in with Microsoft again.",
      "Optional: Entra ID → Enterprise applications → Consent and permissions → allow user consent for apps.",
    ].join(" ");
  }

  return text;
}
