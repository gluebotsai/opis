import fs from "node:fs";
import path from "node:path";

import {
  ClientAssertion,
  ConfidentialClientApplication,
  CryptoProvider,
} from "@azure/msal-node";

import { backendRoot } from "../../../config/runtime-paths.js";
import {
  getMicrosoftAuthority,
  getMicrosoftCertThumbprint,
  getMicrosoftClientId,
  getMicrosoftMailScopes,
  getMicrosoftPrivateKeyPath,
  getMicrosoftRedirectUri,
  getMicrosoftTokenEndpoint,
  normalizeCertThumbprint,
  usesMicrosoftCertificateAuth,
} from "./config.js";

// @ts-expect-error -- legacy runtime boundary is validated by integration checks.
let msalClient = null;
let cachedPrivateKey = "";

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

export function getMicrosoftMsalClient() {
  if (!usesMicrosoftCertificateAuth()) {
    throw new Error("Microsoft certificate auth is not configured.");
  }

  const privateKey = loadPrivateKey();
  const thumbprint = normalizeCertThumbprint(getMicrosoftCertThumbprint());

  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  if (msalClient && cachedPrivateKey === privateKey) {
    return msalClient;
  }

  cachedPrivateKey = privateKey;
  msalClient = new ConfidentialClientApplication({
    auth: {
      clientId: getMicrosoftClientId(),
      authority: getMicrosoftAuthority(),
      clientCertificate: {
        thumbprint,
        privateKey,
      },
    },
  });

  return msalClient;
}

async function createCertificateClientAssertion() {
  const privateKey = loadPrivateKey();
  const thumbprint = normalizeCertThumbprint(getMicrosoftCertThumbprint());
  const clientId = getMicrosoftClientId();
  const tokenEndpoint = getMicrosoftTokenEndpoint();
  const assertion = ClientAssertion.fromCertificate(thumbprint, privateKey);
  const cryptoProvider = new CryptoProvider();

  return assertion.getJwt(cryptoProvider, clientId, tokenEndpoint);
}

async function exchangeWithCertificateAssertion(params: any) {
  const clientAssertion = await createCertificateClientAssertion();
  const body = new URLSearchParams({
    client_id: getMicrosoftClientId(),
    client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
    client_assertion: clientAssertion,
    ...params,
  });

  const response = await fetch(getMicrosoftTokenEndpoint(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    const message = payload.error_description || payload.error || "Microsoft token request failed.";
    throw new Error(message);
  }

  return payload;
}

export async function getMicrosoftAuthorizationUrl(state: any) {
  const client = getMicrosoftMsalClient();
  return client.getAuthCodeUrl({
    scopes: getMicrosoftMailScopes(),
    redirectUri: getMicrosoftRedirectUri(),
    state,
    prompt: "select_account",
  });
}

export async function acquireMicrosoftTokenByCode(code: any) {
  const payload = await exchangeWithCertificateAssertion({
    grant_type: "authorization_code",
    code,
    redirect_uri: getMicrosoftRedirectUri(),
    scope: getMicrosoftMailScopes().join(" "),
  });

  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  if (!payload.access_token) {
    throw new Error("Microsoft token exchange did not return an access token.");
  }

  return payload;
}

export async function acquireMicrosoftTokenByRefreshToken(refreshToken: any) {
  const payload = await exchangeWithCertificateAssertion({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    scope: getMicrosoftMailScopes().join(" "),
  });

  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  if (!payload.access_token) {
    throw new Error("Microsoft token refresh did not return an access token.");
  }

  return payload;
}
