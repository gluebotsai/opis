import { rowToCamel } from "./db/util.js";
import { decryptSecret, encryptSecret } from "./msGraphCrypto.js";
import { withLock } from "./infra/locks.js";
import {
  getMicrosoftClientId,
  getMicrosoftClientSecret,
  getMicrosoftMailScopes,
  getMicrosoftTokenEndpointForTenant,
  decodeMicrosoftAccessToken,
  hasMicrosoftMailScope,
} from "./msGraphConfig.js";
import {
  deleteMailOAuthConnection as deleteMailOAuthConnectionRow,
  selectLatestProfileMailConnection,
  selectMailOAuthConnection,
  upsertMailOAuthConnection,
} from "./repositories/raw/mailOAuth.repo.js";

function buildAccountKey(accountType, accountId, mailboxProfile) {
  return {
    accountType: accountType || "internal",
    accountId,
    mailboxProfile,
  };
}

function mapConnectionRow(row) {
  if (!row) {
    return null;
  }

  const connection = rowToCamel(row);
  return {
    id: connection.id,
    accountType: connection.accountType,
    accountId: connection.accountId,
    mailboxProfile: connection.mailboxProfile,
    accountEmail: connection.accountEmail,
    accountName: connection.accountName || "",
    msTenantId: connection.msTenantId || "",
    scope: connection.scope || "",
    expiresAt: new Date(connection.expiresAt).getTime(),
    createdAt: connection.createdAt,
    updatedAt: connection.updatedAt,
  };
}

function hydrateConnectionRow(row) {
  const connection = mapConnectionRow(row);
  if (!connection) {
    return null;
  }

  connection.accessToken = decryptSecret(row.access_token_encrypted);
  connection.refreshToken = decryptSecret(row.refresh_token_encrypted);
  return connection;
}

export async function getMailOAuthConnection(accountType, accountId, mailboxProfile) {
  if (!accountId) {
    return null;
  }

  const row = await selectMailOAuthConnection(accountType, accountId, mailboxProfile);
  return hydrateConnectionRow(row);
}

export async function getLatestProfileMailConnection(mailboxProfile) {
  const row = await selectLatestProfileMailConnection(mailboxProfile);
  return hydrateConnectionRow(row);
}

export async function saveMailOAuthConnection({
  accountType = "internal",
  accountId,
  mailboxProfile,
  accountEmail,
  accountName = "",
  msTenantId = "",
  accessToken,
  refreshToken,
  expiresInSeconds = 3600,
  scope = "",
}) {
  if (!accessToken) {
    throw new Error("Missing Microsoft access token.");
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

export async function deleteMailOAuthConnection(accountType, accountId, mailboxProfile) {
  await deleteMailOAuthConnectionRow(accountType, accountId, mailboxProfile);
}

async function refreshAccessToken(refreshToken, tenantId = "") {
  if (!refreshToken) {
    const error = new Error("Missing refresh token.");
    error.code = "invalid_grant";
    throw error;
  }

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
    const message = payload.error_description || payload.error || "Token refresh failed.";
    const error = new Error(message);
    error.code = payload.error || "refresh_failed";
    throw error;
  }

  if (!payload.access_token) {
    const error = new Error("Microsoft token refresh did not return an access token.");
    error.code = "refresh_failed";
    throw error;
  }

  return payload;
}

async function persistRefreshedConnection(connection, refreshed, accountType, accountId, mailboxProfile) {
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

export async function forceRefreshAccessTokenForAccount(accountType, accountId, mailboxProfile) {
  const connection = await getMailOAuthConnection(accountType, accountId, mailboxProfile);
  if (!connection) {
    return null;
  }

  try {
    const refreshed = await refreshAccessToken(connection.refreshToken, connection.msTenantId);
    return persistRefreshedConnection(connection, refreshed, accountType, accountId, mailboxProfile);
  } catch (error) {
    if (error.code === "invalid_grant") {
      await deleteMailOAuthConnection(accountType, accountId, mailboxProfile);
    }

    throw error;
  }
}

export async function getValidAccessTokenForAccount(accountType, accountId, mailboxProfile) {
  return withLock(
    `oauth:${accountType}:${accountId}:${mailboxProfile}`,
    async () => {
      const connection = await getMailOAuthConnection(accountType, accountId, mailboxProfile);
      if (!connection) {
        return null;
      }

      const expiresSoon = connection.expiresAt - Date.now() < 5 * 60_000;
      if (!expiresSoon) {
        return connection;
      }

      try {
        const refreshed = await refreshAccessToken(connection.refreshToken, connection.msTenantId);
        return persistRefreshedConnection(
          connection,
          refreshed,
          accountType,
          accountId,
          mailboxProfile,
        );
      } catch (error) {
        if (error.code === "invalid_grant") {
          await deleteMailOAuthConnection(accountType, accountId, mailboxProfile);
        }

        throw error;
      }
    },
    { ttlSeconds: 30, waitMs: 8000 },
  );
}

export async function getMailOAuthStatus(accountType, accountId, mailboxProfile) {
  const connection = await getMailOAuthConnection(accountType, accountId, mailboxProfile);
  if (!connection) {
    return {
      connected: false,
      accountEmail: "",
      accountName: "",
    };
  }

  return {
    connected: true,
    accountEmail: connection.accountEmail,
    accountName: connection.accountName,
    expiresAt: connection.expiresAt,
  };
}

export async function getValidAccessTokenForProfile(mailboxProfile) {
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

function formatGraphAuthError(error, connection = null) {
  const graphCode = error?.graphCode || "";
  const status = error?.status;
  const message = error instanceof Error ? error.message : "Microsoft Graph request failed.";

  if (
    connection &&
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

    return "Outlook session expired or is invalid. Click Disconnect, then Sign in with Microsoft again.";
  }

  if (graphCode === "MailboxNotEnabledForRESTAPI") {
    return "This Microsoft account does not have an Outlook mailbox. Use a Microsoft 365 or Outlook.com account.";
  }

  if (graphCode === "ErrorAccessDenied") {
    return "Outlook mail access was denied. Reconnect and accept Mail.Read / Mail.Send permissions.";
  }

  return message;
}

export async function withMicrosoftGraphAccess(accountType, accountId, mailboxProfile, handler) {
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
    if (error?.status !== 401 && error?.graphCode !== "InvalidAuthenticationToken") {
      throw new Error(formatGraphAuthError(error, connection));
    }

    try {
      connection = await forceRefreshAccessTokenForAccount(accountType, accountId, mailboxProfile);
    } catch (refreshError) {
      throw new Error(
        refreshError instanceof Error
          ? `Outlook session expired. Disconnect and sign in again. ${refreshError.message}`
          : "Outlook session expired. Disconnect and sign in again.",
      );
    }

    if (!connection?.accessToken) {
      throw new Error("Outlook session expired. Disconnect and sign in with Microsoft again.");
    }

    try {
      return await handler(connection.accessToken);
    } catch (retryError) {
      throw new Error(formatGraphAuthError(retryError, connection));
    }
  }
}

export { buildAccountKey };
