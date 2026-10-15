import { requestContext } from "@/service/account/request-context";

export type ConnectedEmailProvider = "google" | "microsoft";

export const EMAIL_SEND_PROVIDER_COOKIE = "worktual_email_send";

const VALID = new Set<ConnectedEmailProvider>(["google", "microsoft"]);

export function parsePreferredEmailProvider(
  raw: string | null | undefined,
): ConnectedEmailProvider | null {
  if (raw && VALID.has(raw as ConnectedEmailProvider)) {
    return raw as ConnectedEmailProvider;
  }
  return null;
}

export async function getPreferredEmailProvider(): Promise<ConnectedEmailProvider | null> {
  const store = requestContext.getStore();
  if (store && store.preferredEmailProvider !== undefined) {
    return store.preferredEmailProvider;
  }
  return null;
}

export async function setPreferredEmailProvider(
  provider: ConnectedEmailProvider,
): Promise<void> {
  const store = requestContext.getStore();
  if (store) {
    store.preferredEmailProvider = provider;
  }
  // Fastify sets Set-Cookie on the reply.
}

export async function clearPreferredEmailProvider(): Promise<void> {
  const store = requestContext.getStore();
  if (store) {
    store.preferredEmailProvider = null;
  }
  // Fastify clears via reply.
}
