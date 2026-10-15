import {
  getYahooAuthorizeEndpoint,
  getYahooClientId,
  getYahooClientSecret,
  getYahooRedirectUri,
  getYahooTokenEndpoint,
  getYahooUserInfoEndpoint,
  YAHOO_MAIL_SCOPES,
} from "./yahooMailConfig.js";
import { saveMailOAuthConnection } from "./msGraphTokens.js";
import { consumeOAuthState } from "./msGraphOAuth.js";

export function buildYahooAuthorizationUrl(state) {
  const params = new URLSearchParams({
    client_id: getYahooClientId(),
    response_type: "code",
    redirect_uri: getYahooRedirectUri(),
    scope: YAHOO_MAIL_SCOPES.join(" "),
    state,
    language: "en-us",
  });
  return `${getYahooAuthorizeEndpoint()}?${params.toString()}`;
}

export async function exchangeYahooAuthorizationCode(code) {
  const basic = Buffer.from(`${getYahooClientId()}:${getYahooClientSecret()}`).toString("base64");
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: getYahooRedirectUri(),
  });

  const response = await fetch(getYahooTokenEndpoint(), {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload.error_description || payload.error || "Yahoo token exchange failed.";
    throw new Error(message);
  }
  return payload;
}

export async function fetchYahooProfile(accessToken) {
  const response = await fetch(getYahooUserInfoEndpoint(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload.error?.message || payload.error || "Could not read Yahoo profile.";
    throw new Error(message);
  }
  const email =
    payload.email ||
    payload.emails?.preferred ||
    (Array.isArray(payload.emails) ? payload.emails[0] : "") ||
    "";
  return {
    displayName: payload.name || payload.nickname || "",
    email: String(email || "").trim(),
  };
}

export async function completeYahooOAuthConnection({ code, state }) {
  const pending = await consumeOAuthState(state);
  const tokenPayload = await exchangeYahooAuthorizationCode(code);

  if (!tokenPayload.refresh_token) {
    throw new Error(
      "Yahoo did not return a refresh token. Reconnect and accept all requested permissions.",
    );
  }

  const profile = await fetchYahooProfile(tokenPayload.access_token);
  if (!profile.email) {
    throw new Error("Yahoo did not return an email for this account.");
  }

  await saveMailOAuthConnection({
    accountType: pending.accountType,
    accountId: pending.accountId,
    mailboxProfile: pending.mailboxProfile,
    accountEmail: profile.email,
    accountName: profile.displayName,
    msTenantId: "yahoo",
    accessToken: tokenPayload.access_token,
    refreshToken: tokenPayload.refresh_token,
    expiresInSeconds: tokenPayload.expires_in,
    scope: tokenPayload.scope || YAHOO_MAIL_SCOPES.join(" "),
  });

  return {
    returnPath: pending.returnPath || "/mail",
    accountEmail: profile.email,
    accountName: profile.displayName,
    mailboxProfile: pending.mailboxProfile,
    accountType: pending.accountType,
    accountId: pending.accountId,
    provider: "yahoo",
  };
}
