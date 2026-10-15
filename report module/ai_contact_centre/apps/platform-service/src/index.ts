import "./load-env.js";
import Fastify from "fastify";
import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { getApiV1Bases } from "@ai-contact-center/api-paths";
import { createLogger } from "@ai-contact-center/observability";
import { registerPrisma } from "./plugins/prisma.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerPlatformRoutes } from "./routes/platform.js";

const PORT = Number(process.env.PORT ?? 3001);
const SERVICE_NAME = "platform-service";
const logger = createLogger({ service: SERVICE_NAME });

async function main() {
  const app = Fastify({ logger: false });

  await app.register(cors, { origin: true });
  await app.register(sensible);
  await app.register(swagger, {
    openapi: { info: { title: "Worktual Platform Service API", version: "0.1.0" } },
  });
  await app.register(swaggerUi, { routePrefix: "/docs" });
  await registerPrisma(app);
  await registerHealthRoutes(app, SERVICE_NAME);

  for (const apiV1Base of getApiV1Bases()) {
    await registerPlatformRoutes(app, apiV1Base);
  }

  app.setErrorHandler((error, _request, reply) => {
    const err = error as { statusCode?: number; name?: string; message?: string };
    logger.error({ err: error }, "request failed");
    reply.status(err.statusCode ?? 500).send({
      error: err.name ?? "Error",
      message: err.message ?? "Internal Server Error",
      statusCode: err.statusCode ?? 500,
    });
  });

  await app.listen({ port: PORT, host: "0.0.0.0" });
  logger.info({ port: PORT }, `${SERVICE_NAME} listening`);
}

main().catch((error) => {
  logger.error({ err: error }, "failed to start");
  process.exit(1);
});
