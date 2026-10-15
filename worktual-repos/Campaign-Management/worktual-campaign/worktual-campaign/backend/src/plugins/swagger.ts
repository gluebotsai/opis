import fp from "fastify-plugin";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import type { FastifyInstance } from "fastify";

async function swaggerPlugin(app: FastifyInstance) {
  await app.register(swagger, {
    openapi: {
      info: {
        title: "Worktual Campaign API",
        description:
          "Standalone Campaign MS API — campaign_db + my_account_qa auth",
        version: "0.1.0",
      },
      components: {
        securitySchemes: {
          bearerAuth: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "JWT",
          },
        },
      },
      security: [{ bearerAuth: [] }],
    },
  });

  await app.register(swaggerUi, {
    routePrefix: "/docs",
    uiConfig: {
      docExpansion: "list",
      deepLinking: true,
    },
  });
}

export default fp(swaggerPlugin);
