import type { FastifyReply } from "fastify";
import {
  EMAIL_SEND_PROVIDER_COOKIE,
  type ConnectedEmailProvider,
} from "@/service/email/preferred-provider";
import { sessionCookieSecure } from "@/service/account/session-crypto";

/** Persist send provider choice after OAuth connect (same cookie as Configuration → preferred). */
export function setPreferredSendProviderCookie(
  reply: FastifyReply,
  provider: ConnectedEmailProvider | null | undefined,
): void {
  if (!provider) return;
  reply.setCookie(EMAIL_SEND_PROVIDER_COOKIE, provider, {
    httpOnly: true,
    sameSite: "lax",
    secure: sessionCookieSecure(),
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}

export function clearPreferredSendProviderCookie(reply: FastifyReply): void {
  reply.clearCookie(EMAIL_SEND_PROVIDER_COOKIE, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: sessionCookieSecure(),
  });
}
