import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import { env } from "./config/env.js";
import swaggerPlugin from "./plugins/swagger.js";
import { errorHandler } from "./middlewares/error-handler.js";
import { initRedis } from "./plugins/redis.js";
import { SERVICE_PATH } from "./helpers/constants.js";
import { isDevWebPushDemoOrigin } from "./helpers/dev-webpush-origins.js";
import { isDevLanFrontendOrigin } from "./helpers/dev-lan-origins.js";

import authRoutes from "./modules/auth/routes.js";
import campaignRoutes from "./modules/campaign/routes.js";
import contactRoutes from "./modules/contact/routes.js";
import agentSessionRoutes from "./modules/agent-session/routes.js";
import channelTemplateRoutes from "./modules/channel-template/routes.js";
import configurationRoutes from "./modules/configuration/routes.js";
import templateRoutes from "./modules/template/routes.js";
import emailCampaignRoutes from "./modules/email-campaign/campaign/routes.js";
import smsCampaignRoutes from "./modules/sms-campaign/campaign/routes.js";
import webPushRoutes from "./modules/web-push/routes.js";
import webPushPublicRoutes from "./modules/web-push/public-routes.js";
import webPushV1Routes from "./modules/web-push/v1-routes.js";
import webPushSdkRoutes from "./modules/web-push/sdk-routes.js";
import publicFormRoutes from "./modules/public-forms/routes.js";
import publicTempContactRoutes from "./modules/public-temp-contacts/routes.js";
import appPushRoutes from "./modules/app-push/routes.js";
import internalRoutes from "./modules/internal/routes.js";
import notificationsRoutes from "./modules/notifications/routes.js";
import recommendationsRoutes from "./modules/recommendations/routes.js";
import opportunityEventsRoutes from "./modules/opportunity-events/routes.js";
import industryPackRoutes from "./modules/industry-pack/routes.js";
import mediaRoutes from "./modules/media/routes.js";
import imageGalleryRoutes from "./modules/image-gallery/routes.js";
import embedRoutes from "./modules/embed/routes.js";
import analyticsRoutes from "./modules/analytics/routes.js";

/**
 * Fastify app factory — same registration style as Downloads `server.ts`.
 */
export async function createServer(): Promise<FastifyInstance> {
  const server = Fastify({
    // Keep error logs; skip per-request "incoming request" noise (media upload, etc.).
    logger: { level: process.env.LOG_LEVEL?.trim() || "warn" },
    disableRequestLogging: true,
    // data_url uploads of images up to 3 MB (base64) need more than the 1 MB default
    bodyLimit: 5 * 1024 * 1024,
  });

  server.setErrorHandler(errorHandler);

  const extraDevOrigins =
    env.nodeEnv === "production"
      ? []
      : [
          "http://localhost:5500",
          "http://127.0.0.1:5500",
          "https://localhost:5500",
          "https://127.0.0.1:5500",
        ];
  const allowedOrigins = new Set([...env.corsOrigins, ...extraDevOrigins]);
  await server.register(cors, {
    origin: (origin, cb) => {
      if (
        !origin ||
        allowedOrigins.has(origin) ||
        (env.nodeEnv !== "production" && isDevWebPushDemoOrigin(origin)) ||
        (env.nodeEnv !== "production" && isDevLanFrontendOrigin(origin))
      ) {
        cb(null, true);
        return;
      }
      // Customer sites load /api/sdk/web-push.js and POST /api/v1/push/subscribe.
      try {
        const parsed = new URL(origin);
        if (parsed.protocol === "https:") {
          cb(null, true);
          return;
        }
        if (env.nodeEnv !== "production" && parsed.protocol === "http:") {
          cb(null, true);
          return;
        }
      } catch {
        /* ignore */
      }
      cb(null, false);
    },
    credentials: true,
  });

  await server.register(jwt, {
    secret: env.jwtSecret,
  });

  await server.register(swaggerPlugin);

  server.get("/health", {
    schema: { tags: ["System"], summary: "Health check" },
    handler: async (_req, reply) => {
      const { pipelineHealthFlags } = await import(
        "./helpers/email-send-pipeline-ready.js"
      );
      const flags = pipelineHealthFlags();
      return reply.status(200).send({
        statusCode: 200,
        message: "Campaign backend is healthy",
        service: "campaign-backend",
        googleOAuthConfigured: flags.googleOAuthConfigured,
        microsoftOAuthConfigured: flags.microsoftOAuthConfigured,
        msTokenEncryptionConfigured: flags.msTokenEncryptionConfigured,
      });
    },
  });

  const apiPrefix = SERVICE_PATH;

  await server.register(authRoutes, { prefix: `${apiPrefix}/auth` });
  await server.register(internalRoutes, { prefix: `${apiPrefix}/internal` });
  await server.register(campaignRoutes, { prefix: `${apiPrefix}/campaigns` });
  await server.register(contactRoutes, { prefix: `${apiPrefix}/contacts` });
  await server.register(agentSessionRoutes, {
    prefix: `${apiPrefix}/agent-sessions`,
  });
  await server.register(channelTemplateRoutes, {
    prefix: `${apiPrefix}/channel-templates`,
  });
  await server.register(configurationRoutes, {
    prefix: `${apiPrefix}/configuration`,
  });

  // Channel stubs (structure parity with Downloads; implement later)
  await server.register(templateRoutes, { prefix: `${apiPrefix}/templates` });
  await server.register(emailCampaignRoutes, {
    prefix: `${apiPrefix}/email-campaign`,
  });
  await server.register(smsCampaignRoutes, {
    prefix: `${apiPrefix}/sms-campaign`,
  });
  await server.register(webPushPublicRoutes, {
    prefix: `${apiPrefix}/public/web-push`,
  });
  await server.register(webPushV1Routes, {
    prefix: `${apiPrefix}/v1/push`,
  });
  await server.register(webPushSdkRoutes, {
    prefix: `${apiPrefix}/sdk`,
  });
  // Local / legacy alias (edge nginx often proxies only /api/*)
  await server.register(webPushSdkRoutes, { prefix: "/sdk" });
  await server.register(publicFormRoutes, {
    prefix: `${apiPrefix}/public/forms`,
  });
  await server.register(publicTempContactRoutes, {
    prefix: `${apiPrefix}/public`,
  });
  await server.register(webPushRoutes, { prefix: `${apiPrefix}/web-push` });
  await server.register(appPushRoutes, { prefix: `${apiPrefix}/app-push` });
  await server.register(notificationsRoutes, {
    prefix: `${apiPrefix}/notifications`,
  });
  await server.register(recommendationsRoutes, {
    prefix: `${apiPrefix}/recommendations`,
  });
  await server.register(opportunityEventsRoutes, {
    prefix: `${apiPrefix}/opportunity-events`,
  });
  await server.register(industryPackRoutes, {
    prefix: `${apiPrefix}/industry-pack`,
  });
  await server.register(mediaRoutes, {
    prefix: `${apiPrefix}/media`,
  });
  await server.register(imageGalleryRoutes, {
    prefix: `${apiPrefix}/image-gallery`,
  });
  await server.register(embedRoutes, { prefix: `${apiPrefix}/embed` });
  await server.register(analyticsRoutes, { prefix: `${apiPrefix}/analytics` });

  const cacheMode = await initRedis();
  server.log.info({ cacheMode }, "Cache backend ready");

  return server;
}
