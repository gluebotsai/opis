import { env } from "./config/env.js";
import { createServer } from "./server.js";
import { attachSocketIO } from "./plugins/socket.js";
import { startEmailSendWorker } from "./services/email-send-worker.js";
import { startPushSendWorker } from "./services/push-send-worker.js";
import {
  startWhatsAppSendWorker,
  startApprovedTemplateScheduleWorker,
} from "./services/whatsapp-send-worker.js";
import { startWhatsAppStatusWorker } from "./services/whatsapp-status-worker.js";
import { startProactiveAgentWorker } from "./services/proactive-agent-worker.js";
import { startDailyReportWorker } from "./services/daily-report-worker.js";
import { startGalleryBootstrapWorker } from "./services/gallery-bootstrap-worker.js";
import { backfillCampaignSendLifecycles } from "./services/campaign-send-lifecycle.js";
import { ensureDbSchemaReady } from "./helpers/ensure-db-schema.js";
import { pipelineHealthFlags } from "./helpers/email-send-pipeline-ready.js";

async function startServer() {
  const server = await createServer();

  await ensureDbSchemaReady(server.log);

  await server.listen({ port: env.port, host: env.host });
  const io = attachSocketIO(server);
  startEmailSendWorker(server.log);
  startPushSendWorker(server.log);
  startWhatsAppSendWorker(server.log);
  startApprovedTemplateScheduleWorker(server.log);
  startWhatsAppStatusWorker(server.log);
  startProactiveAgentWorker(server.log);
  startDailyReportWorker(server.log);
  startGalleryBootstrapWorker(server.log);
  void backfillCampaignSendLifecycles(server.log).catch((err) => {
    server.log.warn(
      { err },
      "Startup campaign lifecycle backfill skipped (database unreachable?)",
    );
  });

  server.log.info(
    {
      docs: "/docs",
      socket: "/socket-io",
      socketPort: env.socketPort,
      clients: typeof io.engine?.clientsCount,
      emailTransport: "accounts_mailbox",
      ...pipelineHealthFlags(),
      pushStubAudience: env.push.stubAudience,
      apiPublicUrl: env.apiPublicUrl,
      whatsappChannelConfigEnvFallback:
        env.social.whatsappChannelConfigId || "(org Accounts row)",
      socialServiceBase: env.social.baseUrl,
    },
    `Campaign API listening on ${env.host}:${env.port}` +
      (env.socketPort !== env.port
        ? `; Socket.IO on ${env.host}:${env.socketPort}`
        : ""),
  );

  const trackBase = env.apiPublicUrl.toLowerCase();
  if (
    env.nodeEnv === "production" &&
    (/localhost|127\.0\.0\.1|192\.168\.|10\.\d+\.|172\.(1[6-9]|2\d|3[0-1])\./.test(
      trackBase,
    ) ||
      trackBase.startsWith("http://"))
  ) {
    server.log.warn(
      { apiPublicUrl: env.apiPublicUrl },
      "API_PUBLIC_URL is not public HTTPS — email open/click pixels will not load from Gmail/Outlook; open/click rates stay empty",
    );
  }
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
