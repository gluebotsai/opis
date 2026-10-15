import {
  getGoogleAuthorizeEndpoint,
  getGoogleClientId,
  getGoogleClientSecret,
  getGoogleRedirectUri,
  getGoogleTokenEndpoint,
  getGoogleUserInfoEndpoint,
  GOOGLE_MAIL_SCOPES,
} from "./googleMailConfig.js";
import { saveMailOAuthConnection } from "./msGraphTokens.js";
import { consumeOAuthState } from "./msGraphOAuth.js";

export function buildGoogleAuthorizationUrl(state) {
  const params = new URLSearchParams({
    client_id: getGoogleClientId(),
    response_type: "code",
    redirect_uri: getGoogleRedirectUri(),
    scope: GOOGLE_MAIL_SCOPES.join(" "),
    state,
    access_type: "offline",
    prompt: "consent select_account",
    include_granted_scopes: "true",
  });
  return `${getGoogleAuthorizeEndpoint()}?${params.toString()}`;
}

export async function exchangeGoogleAuthorizationCode(code) {
  const body = new URLSearchParams({
    client_id: getGoogleClientId(),
    client_secret: getGoogleClientSecret(),
    grant_type: "authorization_code",
    code,
    redirect_uri: getGoogleRedirectUri(),
  });

  const response = await fetch(getGoogleTokenEndpoint(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload.error_description || payload.error || "Google token exchange failed.";
    throw new Error(message);
  }
  return payload;
}

export async function fetchGoogleProfile(accessToken) {
  const response = await fetch(getGoogleUserInfoEndpoint(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload.error?.message || payload.error || "Could not read Google profile.";
    throw new Error(message);
  }
  return {
    displayName: payload.name || "",
    email: payload.email || "",
  };
}

export async function completeGoogleOAuthConnection({ code, state }) {
  const pending = await consumeOAuthState(state);
  const tokenPayload = await exchangeGoogleAuthorizationCode(code);

  if (!tokenPayload.refresh_token) {
    throw new Error(
      "Google did not return a refresh token. Disconnect the app in Google Account permissions and try again.",
    );
  }

  const profile = await fetchGoogleProfile(tokenPayload.access_token);
  if (!profile.email) {
    throw new Error("Google did not return an email for this account.");
  }

  await saveMailOAuthConnection({
    accountType: pending.accountType,
    accountId: pending.accountId,
    mailboxProfile: pending.mailboxProfile,
    accountEmail: profile.email,
    accountName: profile.displayName,
    msTenantId: "google",
    accessToken: tokenPayload.access_token,
    refreshToken: tokenPayload.refresh_token,
    expiresInSeconds: tokenPayload.expires_in,
    scope: tokenPayload.scope || GOOGLE_MAIL_SCOPES.join(" "),
  });

  return {
    returnPath: pending.returnPath || "/mail",
    accountEmail: profile.email,
    accountName: profile.displayName,
    mailboxProfile: pending.mailboxProfile,
    accountType: pending.accountType,
    accountId: pending.accountId,
    provider: "google",
  };
}
