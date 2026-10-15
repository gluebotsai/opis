import "@ai-contact-center/config/load-root-env";
import Fastify from "fastify";
import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
import { createLogger } from "@ai-contact-center/observability";
import { inboundMessageEventSchema } from "@ai-contact-center/event-contracts";
import { loadConfig } from "./config.js";
import { GmailCredentialStore } from "./email/credential-store.js";
import { EmailDeliveryWorker } from "./email/delivery-worker.js";
import { GmailInboundProcessor } from "./email/inbound-processor.js";
import { GmailPubSubWorker } from "./email/pubsub-worker.js";
import { GmailWatchManager } from "./email/watch-manager.js";
import { registerEmailDeliverRoute } from "./routes/email-deliver.js";
import { registerEmailSendRoute } from "./routes/email-send.js";
import { registerEmailSendReportRoute } from "./routes/email-send-report.js";
import { registerWebchatDeliverRoute } from "./routes/webchat-deliver.js";
import { registerWebchatTriggerBotRoute } from "./routes/webchat-trigger-bot.js";
import { AccountsConfigClient } from "./services/accounts-config-client.js";
import { OrchestratedBotResponder } from "./services/webchat-orchestrator.js";
import { WebchatSessionStore } from "./services/webchat-session-store.js";
import { WebchatConnectionRegistry } from "./websocket/webchat-connection-registry.js";
import { registerWebchatWsGateway, webchatWsInfo } from "./websocket/webchat-ws-gateway.js";

const config = loadConfig();
const SERVICE_NAME = config.serviceName;
const WEBCHAT_WS_PATHS = (process.env.WEBCHAT_WS_PATHS ?? "/ws/webchat,/ccaas/chat")
  .split(",")
  .map((p) => p.trim())
  .filter(Boolean);
const ACCOUNTS_PUBLIC_API_URL = process.env.ACCOUNTS_PUBLIC_API_URL;
const logger = createLogger({ service: SERVICE_NAME });

process.on("unhandledRejection", (reason) => {
  logger.error({ err: reason }, "unhandled promise rejection");
});

async function main() {
  const app = Fastify({ logger: false });

  await app.register(cors, { origin: true });
  await app.register(sensible);

  app.get("/health", async () => ({
    status: "ok" as const,
    service: SERVICE_NAME,
    channels: ["webchat", ...(config.gmailPubSub ? ["email"] : [])],
    webchatWsPaths: WEBCHAT_WS_PATHS,
    gmail: config.gmailPubSub
      ? {
          enabled: true,
          deliveryMode: "pubsub_pull" as const,
          webhookRequired: false,
          projectId: config.gmailPubSub.projectId,
          topic: config.gmailPubSub.topic,
          subscription: config.gmailPubSub.subscription,
          liveAgentRouting: true,
        }
      : { enabled: false },
    timestamp: new Date().toISOString(),
  }));

  for (const path of WEBCHAT_WS_PATHS) {
    app.get(path, async () => webchatWsInfo(WEBCHAT_WS_PATHS));
  }

  app.get("/health/ready", async () => ({
    status: "ok" as const,
    service: SERVICE_NAME,
    timestamp: new Date().toISOString(),
  }));

  app.post("/internal/messages", async (request) => {
    const event = inboundMessageEventSchema.parse({
      ...(request.body as object),
      channel_type: "webchat",
    });
    logger.info({ event_id: event.event_id, tenant_id: event.tenant_id }, "inbound message received");
    return { accepted: true, event_id: event.event_id };
  });

  const connectionRegistry = new WebchatConnectionRegistry();
  const sessionStore = new WebchatSessionStore();
  const bot = new OrchestratedBotResponder();
  const accountsClient = new AccountsConfigClient(ACCOUNTS_PUBLIC_API_URL, logger);

  registerWebchatDeliverRoute(app, connectionRegistry, logger);
  registerWebchatTriggerBotRoute(
    app,
    {
      registry: connectionRegistry,
      sessionStore,
      bot,
      accountsClient,
      logger,
    },
    logger,
  );
  registerEmailDeliverRoute(app, config, logger);
  registerEmailSendRoute(app, config, logger);
  registerEmailSendReportRoute(app, config, logger);

  let gmailPubSubWorker: GmailPubSubWorker | null = null;
  let gmailWatchManager: GmailWatchManager | null = null;
  let emailDeliveryWorker: EmailDeliveryWorker | null = null;

  if (config.gmailPubSub && config.tokenEncryptionKey) {
    const credentialStore = new GmailCredentialStore(config);
    const inboundProcessor = new GmailInboundProcessor(credentialStore, logger);
    gmailPubSubWorker = new GmailPubSubWorker(config, inboundProcessor, logger);
    gmailWatchManager = new GmailWatchManager(config, credentialStore, logger);
    emailDeliveryWorker = new EmailDeliveryWorker(credentialStore, logger);
    await gmailPubSubWorker.start();
    gmailWatchManager.start();
    emailDeliveryWorker.start();
  } else {
    logger.info("gmail email integration disabled (missing pubsub or encryption config)");
  }

  registerWebchatWsGateway(app.server, logger, {
    paths: WEBCHAT_WS_PATHS,
    accountsPublicApiUrl: ACCOUNTS_PUBLIC_API_URL,
    connectionRegistry,
    sessionStore,
    bot,
  });

  const shutdown = async () => {
    await gmailPubSubWorker?.stop();
    gmailWatchManager?.stop();
    emailDeliveryWorker?.stop();
    await app.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());

  await app.listen({ port: config.port, host: "0.0.0.0" });

  logger.info(
    {
      port: config.port,
      webchatWsPaths: WEBCHAT_WS_PATHS,
      gmailEnabled: Boolean(config.gmailPubSub && config.tokenEncryptionKey),
      gmailTopic: config.gmailPubSub?.topic ?? null,
      gmailSubscription: config.gmailPubSub?.subscription ?? null,
      gmailDeliveryMode: config.gmailPubSub ? "pubsub_pull" : null,
    },
    `${SERVICE_NAME} listening`,
  );
}

main().catch((error) => {
  logger.error({ err: error }, "failed to start");
  process.exit(1);
});
