import crypto from "node:crypto";

import { rowToCamel } from "./db/util.js";
import {
  getMicrosoftAuthorizeEndpoint,
  getMicrosoftClientId,
  getMicrosoftClientSecret,
  getMicrosoftMailScopes,
  getMicrosoftRedirectUri,
  getMicrosoftTokenEndpointForTenant,
  decodeMicrosoftAccessToken,
  formatMicrosoftAccountEmail,
  hasMicrosoftMailScope,
} from "./msGraphConfig.js";
import { saveMailOAuthConnection } from "./msGraphTokens.js";
import { verifyGraphMailAccess } from "./msGraphMail.js";
import {
  consumeOAuthState as consumeOAuthStateRow,
  deleteExpiredOAuthStates,
  insertOAuthState,
} from "./repositories/raw/mailOAuth.repo.js";

const STATE_TTL_MS = 10 * 60 * 1000;

export async function createOAuthState({
  accountType = "internal",
  accountId,
  mailboxProfile,
  returnPath = "/mail",
}) {
  const state = crypto.randomBytes(24).toString("hex");
  const expiresAt = new Date(Date.now() + STATE_TTL_MS);

  await insertOAuthState([
    state,
    accountType,
    accountId,
    mailboxProfile,
    returnPath,
    expiresAt.toISOString(),
  ]);

  return state;
}

export async function consumeOAuthState(state) {
  if (!state) {
    throw new Error("Missing OAuth state.");
  }

  const row = await consumeOAuthStateRow(state);

  if (!row) {
    throw new Error("OAuth state is invalid or expired. Please try connecting again.");
  }

  return rowToCamel(row);
}

export function buildAuthorizationUrl(state) {
  const params = new URLSearchParams({
    client_id: getMicrosoftClientId(),
    response_type: "code",
    redirect_uri: getMicrosoftRedirectUri(),
    response_mode: "query",
    scope: getMicrosoftMailScopes().join(" "),
    state,
    prompt: "select_account",
  });

  return `${getMicrosoftAuthorizeEndpoint()}?${params.toString()}`;
}

export async function exchangeAuthorizationCode(code) {
  const body = new URLSearchParams({
    client_id: getMicrosoftClientId(),
    client_secret: getMicrosoftClientSecret(),
    grant_type: "authorization_code",
    code,
    redirect_uri: getMicrosoftRedirectUri(),
  });

  const response = await fetch(getMicrosoftTokenEndpointForTenant(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload.error_description || payload.error || "Microsoft token exchange failed.";
    throw new Error(message);
  }

  return payload;
}

export async function fetchMicrosoftProfile(accessToken) {
  const response = await fetch("https://graph.microsoft.com/v1.0/me?$select=displayName,mail,userPrincipalName", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload.error?.message || "Could not read Microsoft profile.";
    throw new Error(message);
  }

  return {
    displayName: payload.displayName || "",
    email: payload.mail || payload.userPrincipalName || "",
  };
}

function isUnsupportedGuestMailbox(email = "") {
  const raw = String(email || "").trim().toLowerCase();
  return raw.includes("#ext#@") || /_gmail\.com#ext#@/i.test(raw) || /@gmail\.com$/i.test(raw);
}

export async function completeOAuthConnection({ code, state }) {
  const pending = await consumeOAuthState(state);
  const tokenPayload = await exchangeAuthorizationCode(code);

  if (!tokenPayload.refresh_token) {
    throw new Error(
      "Microsoft did not return a refresh token. Reconnect and accept all requested permissions (offline_access).",
    );
  }

  const profile = await fetchMicrosoftProfile(tokenPayload.access_token);

  if (!profile.email) {
    throw new Error("Microsoft did not return a mailbox email for this account.");
  }

  if (isUnsupportedGuestMailbox(profile.email)) {
    throw new Error(
      "This account cannot be used for Outlook mail. Sign in with a native Microsoft 365 or Outlook.com mailbox — not a Gmail guest account.",
    );
  }

  // Graph inbox access is the real permission check; scope strings can be incomplete in the token response.
  await verifyGraphMailAccess(tokenPayload.access_token);

  const tokenClaims = decodeMicrosoftAccessToken(tokenPayload.access_token);
  const grantedScope = tokenPayload.scope || tokenClaims.scp || "";
  if (!hasMicrosoftMailScope(tokenPayload.access_token, grantedScope)) {
    console.warn(
      `[mail oauth] Mail scope not listed in token response for ${formatMicrosoftAccountEmail(profile.email)}; inbox access succeeded anyway.`,
    );
  }

  await saveMailOAuthConnection({
    accountType: pending.accountType,
    accountId: pending.accountId,
    mailboxProfile: pending.mailboxProfile,
    accountEmail: formatMicrosoftAccountEmail(profile.email),
    accountName: profile.displayName,
    msTenantId: tokenClaims.tid || "",
    accessToken: tokenPayload.access_token,
    refreshToken: tokenPayload.refresh_token,
    expiresInSeconds: tokenPayload.expires_in,
    scope: tokenPayload.scope,
  });

  return {
    returnPath: pending.returnPath || "/mail",
    accountEmail: formatMicrosoftAccountEmail(profile.email),
    accountName: profile.displayName,
    mailboxProfile: pending.mailboxProfile,
    accountType: pending.accountType,
    accountId: pending.accountId,
  };
}

export async function cleanupExpiredOAuthStates() {
  await deleteExpiredOAuthStates();
}
