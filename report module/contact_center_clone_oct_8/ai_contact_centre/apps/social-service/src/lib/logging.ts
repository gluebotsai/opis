import { mkdirSync } from "node:fs";
import { join } from "node:path";

import pino, { type Logger } from "pino";

export type SocialLoggers = {
  app: Logger;
  webhooks: Logger;
  messages: Logger;
  instagram: Logger;
  facebook: Logger;
};

const SERVICE_NAME = "social-service";

function resolveLogDir(): string {
  return process.env.LOG_DIR ?? join(process.cwd(), "logs");
}

function createCategoryLogger(category: string, filename: string): Logger {
  const categoryDir = join(resolveLogDir(), category);
  mkdirSync(categoryDir, { recursive: true });

  const logPath = join(categoryDir, filename);
  const level = process.env.LOG_LEVEL ?? "info";
  const isDev = process.env.NODE_ENV !== "production";

  const streams: pino.StreamEntry[] = [
    {
      level: level as pino.Level,
      stream: isDev
        ? pino.transport({
            target: "pino-pretty",
            options: { colorize: true, translateTime: "SYS:standard" },
          })
        : process.stdout,
    },
    {
      level: level as pino.Level,
      stream: pino.destination({ dest: logPath, sync: false }),
    },
  ];

  return pino(
    {
      level,
      base: { service: SERVICE_NAME, category },
    },
    pino.multistream(streams),
  );
}

export function createSocialLoggers(): SocialLoggers {
  return {
    app: createCategoryLogger("app", "social-service.log"),
    webhooks: createCategoryLogger("webhooks", "whatsapp.log"),
    messages: createCategoryLogger("messages", "outbound.log"),
    // Channel-specific files contain the complete inbound, ingest, bot, handoff,
    // and outbound trail for Messenger channels.
    instagram: createCategoryLogger("webhooks", "instagram.log"),
    facebook: createCategoryLogger("webhooks", "facebook.log"),
  };
}
