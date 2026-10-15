import type { FastifyInstance, RouteOptions } from "fastify";
import fp from "fastify-plugin";

const openApiConfig = {
  openapi: {
    info: { title: "Worktual Web Tracking API", version: "1.0.0" },
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
      },
    },
  },
} as const;

function tagForUrl(url: string): string {
  if (url.startsWith("/api/auth")) return "auth";
  if (url.startsWith("/api/analytics")) return "analytics";
  if (url.startsWith("/api/visitors")) return "visitors";
  if (url.startsWith("/api/admin")) return "admin";
  return "system";
}

function autoDocumentRoute(routeOptions: RouteOptions): void {
  if (routeOptions.schema) return;
  const url = routeOptions.url ?? "";
  const publicRoute =
    url === "/health" ||
    url === "/api/auth/login" ||
    url === "/api/auth/onboarding/exchange";
  routeOptions.schema = {
    tags: [tagForUrl(url)],
    summary: url,
    ...(publicRoute ? {} : { security: [{ bearerAuth: [] }] }),
  };
}

/** Register OpenAPI spec generation — must run before routes. */
export const swaggerOpenApiPlugin = fp(async function swaggerOpenApiPlugin(app: FastifyInstance) {
  app.addHook("onRoute", autoDocumentRoute);
  await app.register(import("@fastify/swagger"), openApiConfig);
});

/** Register Swagger UI — must run after all routes are registered. */
export const swaggerUiPlugin = fp(async function swaggerUiPlugin(app: FastifyInstance) {
  await app.register(import("@fastify/swagger-ui"), { routePrefix: "/docs" });
});
