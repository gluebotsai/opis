import cors from "@fastify/cors";
import Fastify from "fastify";
import rawBody from "fastify-raw-body";

import "./config/load-env.js";
import { createCorsOriginValidator } from "./infra/cors.js";
import { prepareServer, startBackgroundServices } from "./bootstrap.js";
import { staffAuthRoutes } from "./modules/auth/staff-auth-routes.js";
import { adminNativeBranchRequestRoutes } from "./modules/branch-requests/admin-native-routes.js";
import { nativeCommissionsRoutes } from "./modules/commissions/native-routes.js";
import { nativeCustomerPortalRoutes } from "./modules/customer-portal/native-routes.js";
import { nativeEventsRoutes } from "./modules/events/native-routes.js";
import { legacyHealthRoutes } from "./modules/health/legacy-health.js";
import { nativeInvoiceSettingsRoutes } from "./modules/invoice-settings/native-routes.js";
import { nativeLeadsRoutes } from "./modules/leads/native-routes.js";
import { nativeMailRoutes } from "./modules/mail/native-routes.js";
import { nativeNumberManagementRoutes } from "./modules/number-management/native-routes.js";
import { nativePartnersRoutes } from "./modules/partners/native-routes.js";
import { nativePaymentWebhookRoutes } from "./modules/payments/native-webhook-routes.js";
import { platformRoutes } from "./modules/platform/routes.js";
import { nativeQuotationRoutes } from "./modules/quotations/native-routes.js";
import { nativeResellersRoutes } from "./modules/resellers/native-routes.js";
import { nativeSalesOversightRoutes } from "./modules/sales-oversight/native-routes.js";
import { adminUserRoutes } from "./modules/users/admin-routes.js";
import apiResponseEnvelope from "./plugins/api-response-envelope.js";
import { registerSpaStatic } from "./plugins/spa-static.js";

await prepareServer();

const host = process.env.HOST || "0.0.0.0";
const port = Number(process.env.MAIL_API_PORT || process.env.PORT || 3002);

const fastify = Fastify({
  logger: true,
  trustProxy: true,
  bodyLimit: 20 * 1024 * 1024,
});

await fastify.register(cors, {
  origin: createCorsOriginValidator(),
  credentials: true,
});
await fastify.register(rawBody, {
  field: "rawBody",
  global: false,
  encoding: false,
  runFirst: true,
});
await fastify.register(apiResponseEnvelope);

// Register all native Fastify routes before listening.
await fastify.register(legacyHealthRoutes, { prefix: "/api" });
await fastify.register(staffAuthRoutes, { prefix: "/api/auth" });
await fastify.register(platformRoutes, { prefix: "/api" });
await fastify.register(adminUserRoutes, { prefix: "/api/admin/users" });
await fastify.register(nativeLeadsRoutes, { prefix: "/api/leads" });
await fastify.register(nativeQuotationRoutes, { prefix: "/api" });
await fastify.register(nativeSalesOversightRoutes, {
  prefix: "/api/sales-oversight",
});
await fastify.register(nativeCustomerPortalRoutes);
await fastify.register(adminNativeBranchRequestRoutes);
await fastify.register(nativePartnersRoutes);
await fastify.register(nativeResellersRoutes);
await fastify.register(nativeCommissionsRoutes);
await fastify.register(nativeInvoiceSettingsRoutes);
await fastify.register(nativeNumberManagementRoutes);
await fastify.register(nativeEventsRoutes);
await fastify.register(nativePaymentWebhookRoutes);
await fastify.register(nativeMailRoutes);
// SPA last so /api/* routes win; static files + client routes from workspace dist/.
await registerSpaStatic(fastify);

const shutdown = async (signal: NodeJS.Signals) => {
  fastify.log.info({ signal }, "Shutting down backend");
  await fastify.close();
  process.exit(0);
};

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await fastify.listen({ host, port });
  fastify.log.info(`Backend listening on http://${host}:${port}`);
  await startBackgroundServices();
} catch (error) {
  fastify.log.fatal({ err: error }, "Backend failed to start");
  process.exit(1);
}
