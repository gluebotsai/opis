const INVALID_TOKEN_MESSAGE = "Invalid or expired token";
const INACTIVE_SESSION_MESSAGE = "Session expired or signed out";

export function isSessionAuthenticationFailure(message: unknown): boolean {
  return (
    message === INVALID_TOKEN_MESSAGE ||
    (typeof message === "string" && message.startsWith(INACTIVE_SESSION_MESSAGE))
  );
}

export function bearerTokenFromAuthorization(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const [scheme, token] = value.trim().split(/\s+/, 2);
  return scheme?.toLowerCase() === "bearer" && token ? token : undefined;
}

export function shouldClearCurrentSession(input: {
  isCcCore: boolean;
  responseMessage: unknown;
  requestAuthorization: unknown;
  currentToken?: string;
}): boolean {
  if (!input.isCcCore || !input.currentToken) return false;
  if (!isSessionAuthenticationFailure(input.responseMessage)) return false;

  return bearerTokenFromAuthorization(input.requestAuthorization) === input.currentToken;
}
