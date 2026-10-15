import compress from "@fastify/compress";
import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import fp from "fastify-plugin";
import rawBody from "fastify-raw-body";

export default fp(async (app) => {
  const origins = app.config.CORS_ORIGINS.split(",").map((origin) =>
    origin.trim(),
  );
  await app.register(cors, {
    origin: origins,
    credentials: true,
    allowedHeaders: ["authorization", "content-type", "x-request-id"],
  });
  await app.register(compress, { global: true, threshold: 1_024 });
  await app.register(sensible);
  await app.register(rawBody, {
    field: "rawBody",
    global: false,
    encoding: false,
    runFirst: true,
  });
  await app.register(swagger, {
    openapi: {
      info: { title: "MY_ACCOUNTS API", version: "0.1.0" },
      components: {
        securitySchemes: {
          bearerAuth: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "JWT or legacy token",
          },
        },
      },
    },
  });
  if (app.config.SWAGGER_ENABLED) {
    await app.register(swaggerUi, { routePrefix: "/openapi" });
  }
});

export const rawBodyRouteConfig = { rawBody: true } as const;
