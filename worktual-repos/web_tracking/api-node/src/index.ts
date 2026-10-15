import Fastify from "fastify";
import cors from "@fastify/cors";
import { env, corsOrigins } from "./config/env.js";
import { prismaPlugin } from "./plugins/prisma.js";
import { clickhousePlugin } from "./plugins/clickhouse.js";
import { redisPlugin } from "./plugins/redis.js";
import { jwtPlugin } from "./plugins/jwt.js";
import { swaggerOpenApiPlugin, swaggerUiPlugin } from "./plugins/swagger.js";
import { authRoutes } from "./routes/auth.js";
import { analyticsRoutes } from "./routes/analytics.js";
import { visitorsRoutes } from "./routes/visitors.js";
import { adminRoutes } from "./routes/admin.js";

async function buildApp() {
  const app = Fastify({ logger: true });

  await app.register(cors, {
    origin: corsOrigins(),
    credentials: true,
  });

  await app.register(prismaPlugin);
  await app.register(clickhousePlugin);
  await app.register(redisPlugin);
  await app.register(jwtPlugin);
  await app.register(swaggerOpenApiPlugin);

  app.get("/health", async () => ({ status: "ok", service: "worktual-analytics-api" }));

  await app.register(authRoutes);
  await app.register(analyticsRoutes);
  await app.register(visitorsRoutes);
  await app.register(adminRoutes);

  await app.register(swaggerUiPlugin);

  app.setErrorHandler((error: Error & { validation?: unknown }, _request, reply) => {
    app.log.error(error);
    if (error.validation) {
      return reply.status(400).send({ detail: error.message });
    }
    const message = error.message?.trim();
    return reply.status(500).send({
      detail: message && message.length < 500 ? message : "Internal server error",
    });
  });

  return app;
}

const app = await buildApp();
await app.listen({ port: env.API_PORT, host: env.SERVICE_HOST });
console.log(`API listening on http://${env.SERVICE_HOST}:${env.API_PORT}`);
