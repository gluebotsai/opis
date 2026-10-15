import "@ai-contact-center/config/load-root-env";

if (!process.env.API_V1_PUBLIC_BASE?.trim() && process.env.CC_CORE_API_V1_PUBLIC_BASE?.trim()) {
  process.env.API_V1_PUBLIC_BASE = process.env.CC_CORE_API_V1_PUBLIC_BASE.trim();
}

import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { getApiV1Bases } from "@ai-contact-center/api-paths";
import { Server as SocketIOServer } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { createLogger } from "@ai-contact-center/observability";
import { registerAuth } from "./middleware/auth.js";
import { registerInternalAuth, isInternalPublicRoute } from "./middleware/internal-auth.js";
import { registerContactCenterEntitlement } from "./middleware/entitlement.js";
import { registerPrisma } from "./plugins/prisma.js";
import { registerRedis } from "./plugins/redis.js";
import { registerTraceContext } from "./plugins/trace-context.js";
import { getRedisClient } from "./lib/redis-client.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerAssistantRoutes } from "./routes/assistant.js";
import { registerChannelRoutes } from "./routes/channels.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerContactRoutes } from "./routes/contacts.js";
import { registerQueueRoutes } from "./routes/queues.js";
import { registerRuntimeRoutes } from "./routes/runtime.js";
import { registerWorkforceRoutes } from "./routes/workforce.js";
import { registerOrganizationSettingsRoutes } from "./routes/organization-settings.js";
import { registerAutoBotCallRoutes } from "./routes/auto-bot-call.js";
import { registerLiveConversationRoutes } from "./routes/live-conversations.js";
import { registerVoiceOmniSummaryRoutes } from "./routes/voice-omni-summary.js";
import { registerVoiceCallOutcomeRoutes } from "./routes/voice-call-outcome.js";
import { registerInternalRoutes } from "./routes/internal.js";
import { registerInternalA2ARoutes } from "./routes/internal-a2a.js";
import { registerWorkspaceRoutes } from "./routes/workspace.js";
import { registerPresenceRoutes } from "./routes/presence.js";
import { registerDashboardRoutes } from "./routes/dashboard.js";
import { registerReportRoutes } from "./routes/reports.js";
import { registerPerformanceRoutes } from "./routes/performance.js";
import { registerAgentTaskRoutes } from "./routes/agent-tasks.js";
import { registerAgentMissedContactRoutes } from "./routes/agent-missed-contacts.js";
import { registerMonitoringRoutes } from "./routes/monitoring.js";
import { registerEmailPolicyRoutes } from "./routes/email-policies.js";
import { registerChannelPolicyRoutes } from "./routes/channel-policies.js";
import { registerPublicWebchatRoutes } from "./routes/public-webchat.js";
import { registerInternalChatRoutes } from "./routes/internal-chat.js";
import { registerSocketHandlers } from "./plugins/socket.js";
import { setRealtimeServer } from "./services/realtime.js";
import { startSessionSweeper } from "./services/session-sweeper.js";
import { startOfferExpirationSweeper } from "./services/offer-lifecycle.js";
import { startCapacityReconciler } from "./services/capacity-reconcile.js";
import { startProactiveCallbackSweeper } from "./services/proactive-callback-sweeper.js";
import { startVoiceCallOutcomeSweeper } from "./services/voice-call-outcome-sweeper.js";
import { startReportRunner } from "./services/report-runner.js";

const PORT = Number(process.env.PORT ?? 3000);
const SERVICE_NAME = "cc-core";
const logger = createLogger({ service: SERVICE_NAME });

async function registerPublicApiRoutes(app: FastifyInstance, apiV1Base: string): Promise<void> {
  await registerQueueRoutes(app, apiV1Base);
  await registerContactRoutes(app, apiV1Base);
  await registerWorkforceRoutes(app, apiV1Base);
  await registerOrganizationSettingsRoutes(app, apiV1Base);
  await registerChannelRoutes(app, apiV1Base);
  await registerRuntimeRoutes(app, apiV1Base);
  await registerAssistantRoutes(app, apiV1Base);
  await registerWorkspaceRoutes(app, apiV1Base);
  await registerPresenceRoutes(app, apiV1Base);
  await registerPerformanceRoutes(app, apiV1Base);
  await registerAgentTaskRoutes(app, apiV1Base);
  await registerAgentMissedContactRoutes(app, apiV1Base);
  await registerMonitoringRoutes(app, apiV1Base);
  await registerDashboardRoutes(app, apiV1Base);
  await registerReportRoutes(app, apiV1Base);
  await registerEmailPolicyRoutes(app, apiV1Base);
  await registerChannelPolicyRoutes(app, apiV1Base);
  await registerPublicWebchatRoutes(app, apiV1Base);
  await registerInternalChatRoutes(app, apiV1Base);
}

async function buildApp() {
  const app = Fastify({ logger: false });

  await app.register(cors, {
    origin: true,
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "x-tenant-id",
      "x-user-id",
      "x-internal-service-key",
      "traceparent",
      "tracestate",
    ],
    maxAge: 86400,
  });
  await app.register(sensible);
  await app.register(swagger, {
    openapi: {
      info: { title: "Worktual CC Core API", version: "0.1.0" },
    },
  });
  await app.register(swaggerUi, { routePrefix: "/docs" });
  await registerTraceContext(app);
  await registerPrisma(app);
  await registerRedis(app);
  await registerAuth(app);
  await registerInternalAuth(app);
  await registerContactCenterEntitlement(app);
  await registerHealthRoutes(app, SERVICE_NAME);

  for (const apiV1Base of getApiV1Bases()) {
    await registerAuthRoutes(app, apiV1Base);
  }

  app.addHook("preHandler", async (request, reply) => {
    if (isInternalPublicRoute(request.url)) {
      return;
    }
    return app.authenticate(request, reply);
  });

  for (const apiV1Base of getApiV1Bases()) {
    await registerPublicApiRoutes(app, apiV1Base);
  }

  await registerInternalRoutes(app);
  await registerAutoBotCallRoutes(app);
  await registerLiveConversationRoutes(app);
  await registerVoiceOmniSummaryRoutes(app);
  await registerVoiceCallOutcomeRoutes(app);
  await registerInternalA2ARoutes(app);

  app.setErrorHandler((error, _request, reply) => {
    const err = error as {
      statusCode?: number;
      httpStatus?: number;
      status?: number;
      name?: string;
      message?: string;
    };
    logger.error({ err: error }, "request failed");
    const statusCode = err.statusCode ?? err.httpStatus ?? err.status ?? 500;
    reply.status(statusCode).send({
      error: err.name ?? "Error",
      message: err.message ?? "Internal Server Error",
      statusCode,
    });
  });

  return app;
}

async function main() {
  const app = await buildApp();

  await app.listen({ port: PORT, host: "0.0.0.0" });

  const socketPath = process.env.SOCKET_IO_PATH ?? "/socket.io";
  const io = new SocketIOServer(app.server, {
    cors: { origin: true },
    path: socketPath,
  });
  const socketRedis = getRedisClient();
  if (socketRedis) {
    const subscriber = socketRedis.duplicate();
    io.adapter(createAdapter(socketRedis, subscriber));
  }

  setRealtimeServer(io);
  registerSocketHandlers(io, process.env.JWT_SECRET);
  startSessionSweeper(() => app.prisma);
  startOfferExpirationSweeper(app);
  startCapacityReconciler(() => app.prisma, logger);
  startProactiveCallbackSweeper(app);
  startVoiceCallOutcomeSweeper(app);
  startReportRunner(app);
  logger.info({ port: PORT, socketPath }, `${SERVICE_NAME} listening with socket.io`);
}

main().catch((error) => {
  logger.error({ err: error }, "failed to start");
  process.exit(1);
});
