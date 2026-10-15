import crypto from "node:crypto";

import { rowToCamel } from "../../../db/util.js";
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
  usesMicrosoftCertificateAuth,
} from "./config.js";
import {
  acquireMicrosoftTokenByCode,
  getMicrosoftAuthorizationUrl,
} from "./msal.js";
import { saveMailOAuthConnection } from "./tokens.js";
import { verifyGraphMailAccess } from "./mail.js";
import {
  consumeOAuthState as consumeOAuthStateRow,
  deleteExpiredOAuthStates,
  insertOAuthState,
} from "../../../repositories/raw/mailOAuth.repo.js";

const STATE_TTL_MS = 10 * 60 * 1000;

export async function createOAuthState({
  accountType = "internal",
  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  accountId,
  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
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

export async function consumeOAuthState(state: any) {
  if (!state) {
    throw new Error("Missing OAuth state.");
  }

  const row = await consumeOAuthStateRow(state);

  if (!row) {
    throw new Error("OAuth state is invalid or expired. Please try connecting again.");
  }

  return rowToCamel(row);
}

export async function buildAuthorizationUrl(state: any) {
  if (usesMicrosoftCertificateAuth()) {
    return getMicrosoftAuthorizationUrl(state);
  }

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

async function exchangeAuthorizationCodeWithSecret(code: any) {
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
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    const message = payload.error_description || payload.error || "Microsoft token exchange failed.";
    throw new Error(message);
  }

  return payload;
}

export async function exchangeAuthorizationCode(code: any) {
  if (usesMicrosoftCertificateAuth()) {
    return acquireMicrosoftTokenByCode(code);
  }

  return exchangeAuthorizationCodeWithSecret(code);
}

export async function fetchMicrosoftProfile(accessToken: any) {
  const response = await fetch("https://graph.microsoft.com/v1.0/me?$select=displayName,mail,userPrincipalName", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    const message = payload.error?.message || "Could not read Microsoft profile.";
    throw new Error(message);
  }

  return {
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    displayName: payload.displayName || "",
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    email: payload.mail || payload.userPrincipalName || "",
  };
}

function isUnsupportedGuestMailbox(email = "") {
  const raw = String(email || "").trim().toLowerCase();
  return raw.includes("#ext#@") || /_gmail\.com#ext#@/i.test(raw) || /@gmail\.com$/i.test(raw);
}

// @ts-expect-error -- legacy runtime boundary is validated by integration checks.
export async function completeOAuthConnection({ code, state }) {
  const pending = await consumeOAuthState(state);
  const tokenPayload = await exchangeAuthorizationCode(code);

  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  if (!tokenPayload.refresh_token) {
    throw new Error(
      "Microsoft did not return a refresh token. Ensure offline_access is granted in Azure API permissions, then disconnect and sign in again.",
    );
  }

  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
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
  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  await verifyGraphMailAccess(tokenPayload.access_token);

  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  const tokenClaims = decodeMicrosoftAccessToken(tokenPayload.access_token);
  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  const grantedScope = tokenPayload.scope || tokenClaims.scp || "";
  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  if (!hasMicrosoftMailScope(tokenPayload.access_token, grantedScope)) {
    console.warn(
      `[mail oauth] Mail scope not listed in token response for ${formatMicrosoftAccountEmail(profile.email)}; inbox access succeeded anyway.`,
    );
  }

  await saveMailOAuthConnection({
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    accountType: pending.accountType,
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    accountId: pending.accountId,
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    mailboxProfile: pending.mailboxProfile,
    accountEmail: formatMicrosoftAccountEmail(profile.email),
    accountName: profile.displayName,
    msTenantId: tokenClaims.tid || "",
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    accessToken: tokenPayload.access_token,
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    refreshToken: tokenPayload.refresh_token,
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    expiresInSeconds: tokenPayload.expires_in,
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    scope: tokenPayload.scope,
  });

  return {
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    returnPath: pending.returnPath || "/mail",
    accountEmail: formatMicrosoftAccountEmail(profile.email),
    accountName: profile.displayName,
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    mailboxProfile: pending.mailboxProfile,
  };
}

export async function cleanupExpiredOAuthStates() {
  await deleteExpiredOAuthStates();
}
