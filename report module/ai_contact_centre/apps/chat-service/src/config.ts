import "@ai-contact-center/config/load-root-env";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type GmailPubSubConfig = {
  projectId: string;
  topic: string;
  subscription: string;
  credentialsPath: string;
};

export type GmailOAuthConfig = {
  clientId: string;
  clientSecret: string;
};

export type ChatServiceConfig = {
  port: number;
  serviceName: string;
  internalServiceKey: string | null;
  ccCoreUrl: string;
  gmailPubSub: GmailPubSubConfig | null;
  gmailOAuth: GmailOAuthConfig | null;
  tokenEncryptionKey: string | null;
};

function readRequired(name: string): string | null {
  const value = process.env[name]?.trim();
  return value || null;
}

const CHAT_SERVICE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function resolvePathFromChatService(path: string): string {
  return isAbsolute(path) ? path : resolve(CHAT_SERVICE_ROOT, path);
}

export function loadConfig(): ChatServiceConfig {
  const projectId = readRequired("GMAIL_PUBSUB_PROJECT_ID") ?? "gmail-test-502808";
  const topic =
    process.env.GMAIL_PUBSUB_TOPIC?.trim() ??
    `projects/${projectId}/topics/Gmail_Mcp`;
  const subscription = process.env.GMAIL_PUBSUB_SUBSCRIPTION?.trim() ?? "mcp";
  const credentialsPath = readRequired("GMAIL_PUBSUB_CREDENTIALS");

  const gmailPubSub = credentialsPath
    ? {
        projectId,
        topic,
        subscription,
        credentialsPath: resolvePathFromChatService(credentialsPath),
      }
    : null;

  const clientId = readRequired("GOOGLE_OAUTH_CLIENT_ID");
  const clientSecret = readRequired("GOOGLE_OAUTH_CLIENT_SECRET");
  const gmailOAuth = clientId && clientSecret ? { clientId, clientSecret } : null;

  const encryptionKey = readRequired("MS_TOKEN_ENCRYPTION_KEY");

  return {
    port: Number(process.env.PORT ?? 3002),
    serviceName: "chat-service",
    internalServiceKey: readRequired("INTERNAL_SERVICE_KEY"),
    ccCoreUrl: (process.env.CC_CORE_URL ?? "http://localhost:3000").replace(/\/$/, ""),
    gmailPubSub,
    gmailOAuth,
    tokenEncryptionKey: encryptionKey,
  };
}
