import fs from "node:fs";
import path from "node:path";

import { ClientAssertion, CryptoProvider } from "@azure/msal-node";

import { backendRoot } from "../../../config/runtime-paths.js";
import {
  getMicrosoftAppTenantId,
  getMicrosoftClientId,
  getMicrosoftClientSecret,
  getMicrosoftCertThumbprint,
  getMicrosoftPrivateKeyPath,
  getMicrosoftTokenEndpointForTenant,
  isMicrosoftMailConfigured,
  normalizeCertThumbprint,
  usesMicrosoftCertificateAuth,
  usesMicrosoftClientSecretAuth,
} from "./config.js";

const APP_ONLY_SCOPE = "https://graph.microsoft.com/.default";

// @ts-expect-error -- legacy runtime boundary is validated by integration checks.
let cachedToken = null;
let cachedExpiresAt = 0;

function resolvePrivateKeyPath(configuredPath = "") {
  if (!configuredPath) {
    return "";
  }

  if (path.isAbsolute(configuredPath)) {
    return configuredPath;
  }

  return path.resolve(backendRoot, configuredPath);
}

function loadPrivateKey() {
  const keyPath = resolvePrivateKeyPath(getMicrosoftPrivateKeyPath());
  if (!keyPath) {
    throw new Error("MS_PRIVATE_KEY_PATH is not configured.");
  }

  if (!fs.existsSync(keyPath)) {
    throw new Error(`Microsoft certificate private key not found at ${keyPath}.`);
  }

  return fs.readFileSync(keyPath, "utf8");
}

/**
 * Client credentials requires a directory (tenant) GUID — not "common".
 */
export function getMicrosoftAppOnlyTenantId() {
  return getMicrosoftAppTenantId();
}

function certificatePrivateKeyReady() {
  if (!usesMicrosoftCertificateAuth()) {
    return false;
  }

  const keyPath = resolvePrivateKeyPath(getMicrosoftPrivateKeyPath());
  return Boolean(keyPath && fs.existsSync(keyPath));
}

function appOnlyAuthMode() {
  if (certificatePrivateKeyReady()) {
    return "certificate";
  }

  if (usesMicrosoftClientSecretAuth()) {
    return "client_secret";
  }

  return "none";
}

/**
 * Human-readable reason app-only Graph mail cannot run (empty string if ready).
 */
export function getMicrosoftAppOnlyUnavailableReason() {
  if (!isMicrosoftMailConfigured()) {
    return "Microsoft Graph is not configured (MS_CLIENT_ID / cert or client secret / redirect).";
  }

  if (!getMicrosoftAppOnlyTenantId()) {
    return (
      'MS_APP_TENANT_ID is missing or MS_TENANT_ID is "common". ' +
      "Set MS_APP_TENANT_ID to your Entra Directory (tenant) GUID for unattended OTP mail."
    );
  }

  if (appOnlyAuthMode() !== "none") {
    return "";
  }

  if (usesMicrosoftCertificateAuth()) {
    const keyPath = resolvePrivateKeyPath(getMicrosoftPrivateKeyPath());
    return (
      `MS_PRIVATE_KEY_PATH not found at ${keyPath || "(empty)"}. ` +
      "Place the private key there, or set MS_CLIENT_SECRET as a fallback for unattended OTP mail."
    );
  }

  return "Set MS_CERT_THUMBPRINT + MS_PRIVATE_KEY_PATH, or MS_CLIENT_SECRET, for app-only Graph auth.";
}

export function canUseMicrosoftAppOnlyMail() {
  return !getMicrosoftAppOnlyUnavailableReason();
}

async function createCertificateClientAssertion(tokenEndpoint: any) {
  const privateKey = loadPrivateKey();
  const thumbprint = normalizeCertThumbprint(getMicrosoftCertThumbprint());
  const clientId = getMicrosoftClientId();
  const assertion = ClientAssertion.fromCertificate(thumbprint, privateKey);
  const cryptoProvider = new CryptoProvider();
  return assertion.getJwt(cryptoProvider, clientId, tokenEndpoint);
}

async function exchangeClientCredentials(tenantId: any) {
  const tokenEndpoint = getMicrosoftTokenEndpointForTenant(tenantId);
  const authMode = appOnlyAuthMode();
  let body;

  if (authMode === "certificate") {
    const clientAssertion = await createCertificateClientAssertion(tokenEndpoint);
    body = new URLSearchParams({
      client_id: getMicrosoftClientId(),
      client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
      client_assertion: clientAssertion,
      grant_type: "client_credentials",
      scope: APP_ONLY_SCOPE,
    });
  } else if (authMode === "client_secret") {
    body = new URLSearchParams({
      client_id: getMicrosoftClientId(),
      client_secret: getMicrosoftClientSecret(),
      grant_type: "client_credentials",
      scope: APP_ONLY_SCOPE,
    });
  } else {
    const error = new Error(getMicrosoftAppOnlyUnavailableReason() || "App-only Graph auth is not configured.");
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    error.code = "app_only_not_configured";
    throw error;
  }

  const response = await fetch(tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      payload.error_description ||
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      payload.error ||
      "Microsoft app-only token request failed.";
    const error = new Error(
      `${message} Ensure the app has Application permission Mail.Send with admin consent.`,
    );
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    error.code = payload.error || "app_only_token_failed";
    throw error;
  }

  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  if (!payload.access_token) {
    const error = new Error("Microsoft app-only token request did not return an access token.");
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    error.code = "app_only_token_failed";
    throw error;
  }

  return payload;
}

/**
 * Acquire (and cache) a Graph application access token for unattended mail.
 */
export async function acquireMicrosoftAppOnlyAccessToken() {
  if (!canUseMicrosoftAppOnlyMail()) {
    const error = new Error(
      getMicrosoftAppOnlyUnavailableReason() ||
        "Unattended Graph mail requires MS_CLIENT_ID, MS_APP_TENANT_ID, and certificate or client secret auth.",
    );
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    error.code = "app_only_not_configured";
    throw error;
  }

  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  if (cachedToken && cachedExpiresAt - Date.now() > 5 * 60_000) {
    return cachedToken;
  }

  const tenantId = getMicrosoftAppOnlyTenantId();
  const payload = await exchangeClientCredentials(tenantId);
  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  const expiresInSeconds = Number(payload.expires_in || 3600);

  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  cachedToken = payload.access_token;
  cachedExpiresAt = Date.now() + expiresInSeconds * 1000;

  return cachedToken;
}
