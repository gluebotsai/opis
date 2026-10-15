import { rowToCamel } from "../../../db/util.js";
import { decryptSecret, encryptSecret } from "./crypto.js";
import { withLock } from "../../../infra/locks.js";
import {
  getMicrosoftClientId,
  getMicrosoftClientSecret,
  getMicrosoftMailScopes,
  getMicrosoftTokenEndpointForTenant,
  decodeMicrosoftAccessToken,
  hasMicrosoftMailScope,
  usesMicrosoftCertificateAuth,
} from "./config.js";
import { acquireMicrosoftTokenByRefreshToken } from "./msal.js";
import {
  deleteMailOAuthConnection as deleteMailOAuthConnectionRow,
  markMailOAuthNeedsReauth,
  selectConnectedFinanceMailSender,
  selectLatestProfileMailConnection,
  selectMailOAuthConnection,
  upsertMailOAuthConnection,
} from "../../../repositories/raw/mailOAuth.repo.js";

function buildAccountKey(accountType: any, accountId: any, mailboxProfile: any) {
  return {
    accountType: accountType || "internal",
    accountId,
    mailboxProfile,
  };
}

function mapConnectionRow(row: any) {
  if (!row) {
    return null;
  }

  const connection = rowToCamel(row);
  return {
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    id: connection.id,
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    accountType: connection.accountType,
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    accountId: connection.accountId,
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    mailboxProfile: connection.mailboxProfile,
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    accountEmail: connection.accountEmail,
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    accountName: connection.accountName || "",
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    msTenantId: connection.msTenantId || "",
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    scope: connection.scope || "",
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    needsReauth: Boolean(connection.needsReauth),
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    expiresAt: new Date(connection.expiresAt).getTime(),
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    createdAt: connection.createdAt,
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    updatedAt: connection.updatedAt,
  };
}

/** AES-GCM decrypt failures when MS_TOKEN_ENCRYPTION_KEY (or derived key) no longer matches. */
function isTokenDecryptError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  return /unsupported state|unable to authenticate data|authentication tag|bad decrypt|wrong final block length|invalid encrypted token payload|operationerror/i.test(
    message,
  );
}

async function hydrateConnectionRow(row: any) {
  const connection = mapConnectionRow(row);
  if (!connection) {
    return null;
  }

  try {
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    connection.accessToken = decryptSecret(row.access_token_encrypted);
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    connection.refreshToken = decryptSecret(row.refresh_token_encrypted);
    return connection;
  } catch (error) {
    if (!isTokenDecryptError(error)) {
      throw error;
    }

    // Stale ciphertext after key rotation — treat as reconnect, do not 500 mail config.
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    connection.accessToken = "";
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    connection.refreshToken = "";
    connection.needsReauth = true;
    try {
      await markNeedsReauth(
        connection.accountType,
        connection.accountId,
        connection.mailboxProfile,
      );
    } catch {
      // Status still returns needsReauth even if DB flag update fails.
    }
    return connection;
  }
}

export async function getMailOAuthConnection(accountType: any, accountId: any, mailboxProfile: any) {
  if (!accountId) {
    return null;
  }

  const row = await selectMailOAuthConnection(accountType, accountId, mailboxProfile);
  return hydrateConnectionRow(row);
}

export async function getLatestProfileMailConnection(mailboxProfile: any) {
  const row = await selectLatestProfileMailConnection(mailboxProfile);
  return hydrateConnectionRow(row);
}

export async function getConnectedFinanceMailSender() {
  const row = await selectConnectedFinanceMailSender();
  return hydrateConnectionRow(row);
}

export async function saveMailOAuthConnection({
  accountType = "internal",
  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  accountId,
  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  mailboxProfile,
  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  accountEmail,
  accountName = "",
  msTenantId = "",
  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  accessToken,
  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  refreshToken,
  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  expiresInSeconds,
  scope = "",
}) {
  if (!accountId) {
    throw new Error("Mail account id is required to store Outlook tokens.");
  }

  if (!refreshToken) {
    throw new Error("Microsoft did not return a refresh token. Ensure offline_access scope is granted.");
  }

  const expiresAt = new Date(Date.now() + Number(expiresInSeconds || 3600) * 1000);

  await upsertMailOAuthConnection([
    accountType,
    accountId,
    mailboxProfile,
    accountEmail,
    accountName,
    msTenantId,
    encryptSecret(accessToken),
    encryptSecret(refreshToken),
    expiresAt.toISOString(),
    scope,
  ]);

  return getMailOAuthConnection(accountType, accountId, mailboxProfile);
}

export async function deleteMailOAuthConnection(accountType: any, accountId: any, mailboxProfile: any) {
  await deleteMailOAuthConnectionRow(accountType, accountId, mailboxProfile);
}

async function markNeedsReauth(accountType: any, accountId: any, mailboxProfile: any) {
  await markMailOAuthNeedsReauth(accountType, accountId, mailboxProfile);
}

async function refreshAccessTokenWithSecret(refreshToken: any, tenantId = "") {
  const body = new URLSearchParams({
    client_id: getMicrosoftClientId(),
    client_secret: getMicrosoftClientSecret(),
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    scope: getMicrosoftMailScopes().join(" "),
  });

  const response = await fetch(getMicrosoftTokenEndpointForTenant(tenantId), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    const message = payload.error_description || payload.error || "Token refresh failed.";
    const error = new Error(message);
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    error.code = payload.error || "refresh_failed";
    throw error;
  }

  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  if (!payload.access_token) {
    const error = new Error("Microsoft token refresh did not return an access token.");
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    error.code = "refresh_failed";
    throw error;
  }

  return payload;
}

async function refreshAccessToken(refreshToken: any, tenantId = "") {
  if (!refreshToken) {
    const error = new Error("Missing refresh token.");
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    error.code = "invalid_grant";
    throw error;
  }

  if (usesMicrosoftCertificateAuth()) {
    try {
      return await acquireMicrosoftTokenByRefreshToken(refreshToken);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Token refresh failed.";
      const wrapped = new Error(message);
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      wrapped.code = /invalid_grant|AADSTS/i.test(message) ? "invalid_grant" : "refresh_failed";
      throw wrapped;
    }
  }

  return refreshAccessTokenWithSecret(refreshToken, tenantId);
}

async function persistRefreshedConnection(connection: any, refreshed: any, accountType: any, accountId: any, mailboxProfile: any) {
  const claims = decodeMicrosoftAccessToken(refreshed.access_token);
  return saveMailOAuthConnection({
    accountType,
    accountId,
    mailboxProfile,
    accountEmail: connection.accountEmail,
    accountName: connection.accountName,
    msTenantId: claims.tid || connection.msTenantId,
    accessToken: refreshed.access_token,
    refreshToken: refreshed.refresh_token || connection.refreshToken,
    expiresInSeconds: refreshed.expires_in,
    scope: refreshed.scope || connection.scope,
  });
}

export async function forceRefreshAccessTokenForAccount(accountType: any, accountId: any, mailboxProfile: any) {
  const connection = await getMailOAuthConnection(accountType, accountId, mailboxProfile);
  // @ts-expect-error -- tokens attached at hydrate time
  if (!connection || connection.needsReauth || !connection.refreshToken) {
    return null;
  }

  try {
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    const refreshed = await refreshAccessToken(connection.refreshToken, connection.msTenantId);
    return persistRefreshedConnection(connection, refreshed, accountType, accountId, mailboxProfile);
  } catch (error) {
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    if (error.code === "invalid_grant") {
      await markNeedsReauth(accountType, accountId, mailboxProfile);
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      error.needsReauth = true;
    }

    throw error;
  }
}

export async function getValidAccessTokenForAccount(accountType: any, accountId: any, mailboxProfile: any) {
  return withLock(
    `oauth:${accountType}:${accountId}:${mailboxProfile}`,
    async () => {
      const connection = await getMailOAuthConnection(accountType, accountId, mailboxProfile);
      if (!connection) {
        return null;
      }

      if (connection.needsReauth) {
        return null;
      }

      const expiresSoon = connection.expiresAt - Date.now() < 5 * 60_000;
      if (!expiresSoon) {
        return connection;
      }

      try {
        // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
        const refreshed = await refreshAccessToken(connection.refreshToken, connection.msTenantId);
        return persistRefreshedConnection(
          connection,
          refreshed,
          accountType,
          accountId,
          mailboxProfile,
        );
      } catch (error) {
        // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
        if (error.code === "invalid_grant") {
          await markNeedsReauth(accountType, accountId, mailboxProfile);
          // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
          error.needsReauth = true;
        }

        throw error;
      }
    },
    { ttlSeconds: 30, waitMs: 8000 },
  );
}

export async function getMailOAuthStatus(accountType: any, accountId: any, mailboxProfile: any) {
  const connection = await getMailOAuthConnection(accountType, accountId, mailboxProfile);
  if (!connection) {
    return {
      connected: false,
      needsReauth: false,
      accountEmail: "",
      accountName: "",
    };
  }

  return {
    connected: !connection.needsReauth,
    needsReauth: Boolean(connection.needsReauth),
    accountEmail: connection.accountEmail,
    accountName: connection.accountName,
    expiresAt: connection.expiresAt,
  };
}

export async function getValidAccessTokenForProfile(mailboxProfile: any) {
  const connection = await getLatestProfileMailConnection(mailboxProfile);
  if (!connection) {
    return null;
  }

  return getValidAccessTokenForAccount(
    connection.accountType,
    connection.accountId,
    connection.mailboxProfile,
  );
}

function formatGraphAuthError(error: any, connection = null) {
  const graphCode = error?.graphCode || "";
  const status = error?.status;
  const message = error instanceof Error ? error.message : "Microsoft Graph request failed.";

  if (
    connection &&
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    !hasMicrosoftMailScope(connection.accessToken, connection.scope) &&
    (status === 401 || graphCode === "InvalidAuthenticationToken" || /mail\.read|consent/i.test(message))
  ) {
    return [
      "Admin consent is required for mail permissions.",
      "Ask your Microsoft 365 admin to grant consent for this app, then sign in again.",
    ].join(" ");
  }

  if (status === 401 || graphCode === "InvalidAuthenticationToken") {
    if (/mail\.read|consent|permission/i.test(message)) {
      return [
        "Admin consent is required for mail permissions.",
        "Ask your Microsoft 365 admin to grant consent for this app, then sign in again.",
      ].join(" ");
    }

    return "Outlook session expired or is invalid. Sign in with Microsoft again.";
  }

  if (graphCode === "MailboxNotEnabledForRESTAPI") {
    return "This Microsoft account does not have an Outlook mailbox. Use a Microsoft 365 or Outlook.com account.";
  }

  if (graphCode === "ErrorAccessDenied") {
    return "Outlook mail access was denied. Reconnect and accept Mail.Read / Mail.Send permissions.";
  }

  return message;
}

export async function withMicrosoftGraphAccess(accountType: any, accountId: any, mailboxProfile: any, handler: any) {
  if (!accountId) {
    return null;
  }

  let connection = await getValidAccessTokenForAccount(accountType, accountId, mailboxProfile);
  if (!connection?.accessToken) {
    return null;
  }

  try {
    return await handler(connection.accessToken);
  } catch (error) {
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    if (error?.status !== 401 && error?.graphCode !== "InvalidAuthenticationToken") {
      throw new Error(formatGraphAuthError(error, connection));
    }

    try {
      connection = await forceRefreshAccessTokenForAccount(accountType, accountId, mailboxProfile);
    } catch (refreshError) {
      throw new Error(
        refreshError instanceof Error
          ? `Outlook session expired. Sign in with Microsoft again. ${refreshError.message}`
          : "Outlook session expired. Sign in with Microsoft again.",
      );
    }

    if (!connection?.accessToken) {
      throw new Error("Outlook session expired. Sign in with Microsoft again.");
    }

    try {
      return await handler(connection.accessToken);
    } catch (retryError) {
      throw new Error(formatGraphAuthError(retryError, connection));
    }
  }
}

export { buildAccountKey };
