import type { FastifyPluginAsync } from "fastify";
import {
  frontendAppOrigin,
  handleMicrosoftOAuthCallbackCommand,
  startMicrosoftOAuthCommand,
} from "@/service/oauth/oauth-bff";
import { setPreferredSendProviderCookie } from "@/service/oauth/oauth-send-cookie";
import { resolveSessionUserId, withUser } from "../../middlewares/auth.js";

export const microsoftOAuthRoutes: FastifyPluginAsync = async (app) => {
  app.get<{
    Querystring: { returnTo?: string };
  }>("/start", async (request, reply) => {
    const returnTo =
      request.query.returnTo ||
      `${frontendAppOrigin()}/configuration/email`;
    const userId = await resolveSessionUserId(request);
    const result = await withUser(
      userId,
      async () =>
        startMicrosoftOAuthCommand({
          returnTo,
          requestOrigin: frontendAppOrigin(),
        }),
      request,
    );
    return reply.redirect(result.redirectUrl);
  });

  app.get<{
    Querystring: { code?: string; state?: string; error?: string };
  }>("/callback", async (request, reply) => {
    const result = await handleMicrosoftOAuthCallbackCommand({
      code: request.query.code ?? null,
      state: request.query.state ?? null,
      oauthError: request.query.error ?? null,
    });
    setPreferredSendProviderCookie(reply, result.preferredSendProvider);
    return reply.redirect(result.redirectUrl);
  });
};
