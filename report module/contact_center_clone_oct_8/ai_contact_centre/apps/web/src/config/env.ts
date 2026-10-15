function resolveDevServiceUrl(url: string): string {
  const trimmed = url.replace(/\/$/, "");
  if (!import.meta.env.DEV || typeof window === "undefined") {
    return trimmed;
  }
  const host = window.location.hostname;
  if (host === "localhost" || host === "127.0.0.1") {
    return trimmed;
  }
  return trimmed.replace(/\/\/(localhost|127\.0\.0\.1)(?=:\d+|\/|$)/g, `//${host}`);
}

export const env = {
  ccCoreUrl: resolveDevServiceUrl(
    import.meta.env.VITE_CC_CORE_URL ?? "http://localhost:3000",
  ),
  nlpServiceUrl: resolveDevServiceUrl(
    import.meta.env.VITE_NLP_SERVICE_URL ?? "http://localhost:8000",
  ),
  platformUrl: resolveDevServiceUrl(
    import.meta.env.VITE_PLATFORM_SERVICE_URL ??
      import.meta.env.VITE_PLATFORM_URL ??
      "http://localhost:3001",
  ),
  apiV1Prefix: (import.meta.env.VITE_API_V1_PREFIX ?? "/api/v1").replace(/\/$/, ""),
  socketUrl: resolveDevServiceUrl(
    import.meta.env.VITE_SOCKET_URL ??
      import.meta.env.VITE_CC_CORE_URL ??
      "http://localhost:3000",
  ),
  socketPath: import.meta.env.VITE_SOCKET_PATH ?? "/socket.io",
  callServiceUrl: resolveDevServiceUrl(
    import.meta.env.VITE_CALL_SERVICE_URL ?? "http://localhost:3003",
  ),
  passiveAssistStructuredEnabled:
    import.meta.env.VITE_PASSIVE_ASSIST_STRUCTURED_ENABLED === "true",
  /**
   * Optional local-dev only. Never used as a product default tenant.
   * Production and logged-in users must use JWT / auth.organizationId.
   */
  tenantId: (import.meta.env.VITE_TENANT_ID as string | undefined) || undefined,
  userId: (import.meta.env.VITE_USER_ID as string | undefined) || undefined,
} as const;
