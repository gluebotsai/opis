import { AsyncLocalStorage } from "async_hooks";
import type { ApiKeyScope } from "@/lib/api-key-scopes";

export type ApiKeyAuthContext = {
  keyId: string;
  organizationId: string;
  scopes: ApiKeyScope[];
};

export type RequestContextStore = {
  userId: string | null;
  /** Preferred mail send provider cookie (Fastify ALS). */
  preferredEmailProvider?: "google" | "microsoft" | null;
  /** Set when authenticated via tenant API key (Bearer). */
  apiKeyAuth?: ApiKeyAuthContext | null;
};

/**
 * Lets Fastify (and tests) set the signed-in user for the current async
 * request so existing domain code that calls getServerUserId() keeps working.
 */
export const requestContext = new AsyncLocalStorage<RequestContextStore>();

export function getRequestContextUserId(): string | null {
  return requestContext.getStore()?.userId ?? null;
}

export function getRequestApiKeyAuth(): ApiKeyAuthContext | null {
  return requestContext.getStore()?.apiKeyAuth ?? null;
}

export function runWithRequestUserId<T>(
  userId: string | null,
  fn: () => T,
): T {
  return requestContext.run({ userId }, fn);
}

export function runWithRequestContext<T>(
  store: RequestContextStore,
  fn: () => T,
): T {
  return requestContext.run(store, fn);
}
