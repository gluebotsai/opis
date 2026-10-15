/**
 * Microsoft identity (delegated OAuth for Outlook / personal Microsoft mail).
 * Mail OAuth uses the "common" tenant so outlook.com / hotmail accounts work.
 * MICROSOFT_TENANT_ID is reserved for Teams app-only (client credentials).
 */

const MS_AUTH = (tenant: string) =>
  `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`;
const MS_TOKEN = (tenant: string) =>
  `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;
const MS_GRAPH = "https://graph.microsoft.com/v1.0";

export const MICROSOFT_MAIL_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "User.Read",
  "Mail.Send",
  "Mail.Read",
  /** Inbound calendar → CRM meeting activities (same connection as mail). */
  "Calendars.Read",
] as const;

export function isMicrosoftOAuthConfigured(): boolean {
  return Boolean(
    process.env.MICROSOFT_CLIENT_ID?.trim() &&
      process.env.MICROSOFT_CLIENT_SECRET?.trim(),
  );
}

/** Tenant for Teams / app-only Graph calls. */
export function microsoftAppTenant(): string {
  return process.env.MICROSOFT_TENANT_ID?.trim() || "common";
}

/**
 * Tenant for user mail OAuth. Prefer "common" so personal Outlook accounts
 * get a real mailbox token (not a guest #EXT# identity in a work tenant).
 */
export function microsoftMailTenant(): string {
  return (
    process.env.MICROSOFT_MAIL_TENANT?.trim() ||
    "common"
  );
}

/** @deprecated Use microsoftMailTenant for OAuth / microsoftAppTenant for Teams */
export function microsoftTenant(): string {
  return microsoftMailTenant();
}

export function microsoftRedirectUri(): string {
  if (process.env.MICROSOFT_REDIRECT_URI?.trim()) {
    return process.env.MICROSOFT_REDIRECT_URI.trim();
  }
  const callbackOrigin =
    process.env.OAUTH_CALLBACK_ORIGIN?.trim() ||
    process.env.API_PUBLIC_URL?.trim();
  if (callbackOrigin) {
    try {
      const u = new URL(
        callbackOrigin.includes("://")
          ? callbackOrigin
          : `http://${callbackOrigin}`,
      );
      return `${u.protocol}//${u.host}/api/microsoft/oauth/callback`;
    } catch {
      /* fall through */
    }
  }
  const base =
    process.env.NEXT_PUBLIC_APP_URL?.trim() || "http://localhost:3000";
  return `${base.replace(/\/$/, "")}/api/microsoft/oauth/callback`;
}

export function buildMicrosoftAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.MICROSOFT_CLIENT_ID!,
    response_type: "code",
    redirect_uri: microsoftRedirectUri(),
    response_mode: "query",
    scope: MICROSOFT_MAIL_SCOPES.join(" "),
    state,
    prompt: "select_account",
  });
  return `${MS_AUTH(microsoftMailTenant())}?${params.toString()}`;
}

export type MicrosoftTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
};

export async function exchangeMicrosoftCode(
  code: string,
): Promise<MicrosoftTokenResponse> {
  const res = await fetch(MS_TOKEN(microsoftMailTenant()), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.MICROSOFT_CLIENT_ID!,
      client_secret: process.env.MICROSOFT_CLIENT_SECRET!,
      code,
      redirect_uri: microsoftRedirectUri(),
      grant_type: "authorization_code",
      scope: MICROSOFT_MAIL_SCOPES.join(" "),
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Microsoft token exchange failed: ${text}`);
  }
  return res.json() as Promise<MicrosoftTokenResponse>;
}

export async function refreshMicrosoftAccessToken(
  refreshToken: string,
): Promise<MicrosoftTokenResponse> {
  // Try mail tenant first, then common, then org tenant (legacy connections).
  const tenants = Array.from(
    new Set([
      microsoftMailTenant(),
      "common",
      "consumers",
      microsoftAppTenant(),
    ]),
  );

  let lastError = "Microsoft token refresh failed.";
  for (const tenant of tenants) {
    const res = await fetch(MS_TOKEN(tenant), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.MICROSOFT_CLIENT_ID!,
        client_secret: process.env.MICROSOFT_CLIENT_SECRET!,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
        scope: MICROSOFT_MAIL_SCOPES.join(" "),
      }),
    });
    if (res.ok) {
      return res.json() as Promise<MicrosoftTokenResponse>;
    }
    lastError = await res.text();
  }
  throw new Error(`Microsoft token refresh failed: ${lastError}`);
}

function normalizeGuestUpnToEmail(upn: string): string | null {
  // yaswanth3451_outlook.com#EXT#@tenant.onmicrosoft.com → yaswanth3451@outlook.com
  const m = upn.match(/^([^#]+)#EXT#@/i);
  if (!m?.[1]) return null;
  const local = m[1];
  const at = local.lastIndexOf("_");
  if (at <= 0) return null;
  const user = local.slice(0, at);
  const domain = local.slice(at + 1).replace(/_/g, ".");
  if (!user || !domain.includes(".")) return null;
  return `${user}@${domain}`;
}

export async function fetchMicrosoftAccountEmail(
  accessToken: string,
): Promise<string | null> {
  const res = await fetch(
    `${MS_GRAPH}/me?$select=mail,userPrincipalName,otherMails`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );
  if (!res.ok) return null;
  const data = (await res.json()) as {
    mail?: string;
    userPrincipalName?: string;
    otherMails?: string[];
  };

  const mail = data.mail?.trim();
  if (mail && !mail.includes("#EXT#")) return mail;

  const other = data.otherMails?.find(
    (e) => e.includes("@") && !e.includes("#EXT#"),
  );
  if (other) return other.trim();

  const upn = data.userPrincipalName?.trim();
  if (upn?.includes("#EXT#")) {
    // Keep the #EXT# marker so send/UI can refuse guest tokens that have no mailbox.
    // (Normalizing to outlook.com hid the problem and made send fail silently.)
    return upn;
  }
  return upn || mail || null;
}

/** Friendly address for UI when Graph returned a guest UPN. */
export function displayMicrosoftAccountEmail(
  accountEmail: string | null | undefined,
): string | null {
  if (!accountEmail) return null;
  if (!accountEmail.includes("#EXT#")) return accountEmail;
  return normalizeGuestUpnToEmail(accountEmail) || accountEmail;
}

export function microsoftHasMailSendScope(
  scope: string | null | undefined,
): boolean {
  if (!scope) return false;
  return scope.includes("Mail.Send");
}

export function microsoftHasMailReadScope(
  scope: string | null | undefined,
): boolean {
  if (!scope) return false;
  return scope.includes("Mail.Read");
}

export function microsoftHasCalendarReadScope(
  scope: string | null | undefined,
): boolean {
  if (!scope) return false;
  return scope.includes("Calendars.Read");
}

export function isMicrosoftGuestMailbox(
  accountEmail: string | null | undefined,
): boolean {
  return Boolean(accountEmail?.includes("#EXT#"));
}
