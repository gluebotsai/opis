import "@ai-contact-center/config/load-root-env";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createSocialLoggers } from "./lib/logging.js";
import { startKafkaConsumerStub } from "./workers/kafka-stub.js";

const config = loadConfig();
const loggers = createSocialLoggers();

async function main() {
  const app = await buildApp(config, loggers);

  if (
    config.metaWhatsApp?.appSecret &&
    (config.directCredentialStore || config.accounts)
  ) {
    loggers.app.info(
      {
        graphApiVersion: config.metaWhatsApp.graphApiVersion,
        logDir: process.env.LOG_DIR ?? "logs",
      },
      "meta whatsapp integration enabled",
    );
  } else {
    loggers.app.warn(
      "meta whatsapp integration disabled — configure Meta app and Accounts internal API settings",
    );
  }

  startKafkaConsumerStub(loggers.app, config.serviceName);

  await app.listen({ port: config.port, host: "0.0.0.0" });
  loggers.app.info({ port: config.port }, `${config.serviceName} listening`);
}

main().catch((error) => {
  loggers.app.error({ err: error }, "failed to start");
  process.exit(1);
});
