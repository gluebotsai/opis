import type { FastifyPluginAsync } from "fastify";
import {
  frontendAppOrigin,
  handleGoogleOAuthCallbackCommand,
  startGoogleOAuthCommand,
} from "@/service/oauth/oauth-bff";
import { setPreferredSendProviderCookie } from "@/service/oauth/oauth-send-cookie";
import { resolveSessionUserId, withUser } from "../../middlewares/auth.js";

export const googleOAuthRoutes: FastifyPluginAsync = async (app) => {
  app.get<{
    Querystring: { returnTo?: string; intent?: string };
  }>("/start", async (request, reply) => {
    const returnTo =
      request.query.returnTo ||
      `${frontendAppOrigin()}/configuration/email`;
    const userId = await resolveSessionUserId(request);
    const result = await withUser(
      userId,
      async () =>
        startGoogleOAuthCommand({
          returnTo,
          requestOrigin: frontendAppOrigin(),
          intent: request.query.intent ?? null,
        }),
      request,
    );
    return reply.redirect(result.redirectUrl);
  });

  app.get<{
    Querystring: { code?: string; state?: string; error?: string };
  }>("/callback", async (request, reply) => {
    const result = await handleGoogleOAuthCallbackCommand({
      code: request.query.code ?? null,
      state: request.query.state ?? null,
      oauthError: request.query.error ?? null,
    });
    setPreferredSendProviderCookie(reply, result.preferredSendProvider);
    return reply.redirect(result.redirectUrl);
  });
};
