import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { RESPONSE } from "./helpers/constants.js";
import { errorBody, sendError } from "./helpers/response.js";
import { responseEnvelopePlugin } from "./plugins/response-envelope.js";
import { authRoutes } from "./modules/auth/routes.js";
import { voiceRoutes } from "./modules/voice/routes.js";
import { contactsRoutes } from "./modules/contacts/routes.js";
import { notificationsRoutes } from "./modules/notifications/routes.js";
import { companiesRoutes } from "./modules/companies/routes.js";
import { productsRoutes } from "./modules/products/routes.js";
import { salesRoutes } from "./modules/sales/routes.js";
import { financeRoutes } from "./modules/finance/routes.js";
import { configurationRoutes } from "./modules/configuration/routes.js";
import { privacyRequestsRoutes } from "./modules/privacy-requests/routes.js";
import { inboxRoutes } from "./modules/inbox/routes.js";
import { activitiesRoutes } from "./modules/activities/routes.js";
import { calendarRoutes } from "./modules/calendar/routes.js";
import { commerceRoutes } from "./modules/commerce/routes.js";
import { homeRoutes } from "./modules/home/routes.js";
import { reportsRoutes } from "./modules/reports/routes.js";
import { agentsRoutes } from "./modules/agents/routes.js";
import { coworkerRoutes } from "./modules/coworker/routes.js";
import { agentMemoryRoutes } from "./modules/agent-memory/routes.js";
import { serviceRoutes } from "./modules/service/routes.js";
import { marketingRoutes } from "./modules/marketing/routes.js";
import { seoRoutes } from "./modules/seo/routes.js";
import { internalSeoRoutes } from "./modules/internal-seo/routes.js";
import { googleOAuthRoutes } from "./modules/google-oauth/routes.js";
import { microsoftOAuthRoutes } from "./modules/microsoft-oauth/routes.js";
import { meetingAssistRoutes } from "./modules/meeting-assist/routes.js";
import { meetingAssistSttWsRoutes } from "./modules/meeting-assist/stt-ws.js";
import { meetingAssistHostRoutes } from "./modules/meeting-assist/host-routes.js";
import { meetingNotetakerRoutes } from "./modules/meeting-assist/notetaker-routes.js";
import { internalMeetingAssistRoutes } from "./modules/meeting-assist/internal-media-routes.js";
import { meetingServiceAddonProxyRoutes } from "./modules/meeting-service/addon-proxy.js";
import { meetingServicePublicRoutes } from "./modules/meeting-service/routes.js";
import { meetingTranscriptWebhookRoutes } from "./modules/webhooks/meeting-transcripts.js";
import { meetingServiceWebhookRoutes } from "./modules/webhooks/meeting-service-completed.js";
import { gmailPushWebhookRoutes } from "./modules/webhooks/gmail-push.js";
import { googleCalendarPushWebhookRoutes } from "./modules/webhooks/google-calendar-push.js";
import { paymentGatewayWebhookRoutes } from "./modules/webhooks/payment-gateways.js";
import { healthRoutes } from "./modules/health/routes.js";
import { internalAssignmentRoutes } from "./modules/internal-assignment/routes.js";
import {
  internalEnrichmentRoutes,
  internalScoringRoutes,
  internalSummaryRoutes,
  internalNurtureRoutes,
  internalLifecycleRoutes,
  internalAutoReplyRoutes,
  internalHubOutboundRoutes,
  internalMeetingBriefRoutes,
} from "./modules/internal-lead-agents/routes.js";
import {
  internalMeetingMissRoutes,
  internalMeetingMomRoutes,
  internalPostMeetingRoutes,
} from "./modules/internal-meeting-agents/routes.js";
import { internalForecastRoutes } from "./modules/internal-forecast/routes.js";
import { internalSalesCoachRoutes } from "./modules/internal-sales-coach/routes.js";
import { internalComplianceRoutes } from "./modules/internal-compliance/routes.js";
import { internalInvoiceEscalationRoutes } from "./modules/internal-invoice-escalation/routes.js";
import { internalCompanyCollectionRiskRoutes } from "./modules/internal-company-collection-risk/routes.js";
import { internalRevenueGapForecastRoutes } from "./modules/internal-revenue-gap-forecast/routes.js";
import { internalInvoiceDunningRoutes } from "./modules/internal-invoice-dunning/routes.js";
import { internalExpansionMatcherRoutes } from "./modules/internal-expansion-matcher/routes.js";
import { internalHubResolveRoutes } from "./modules/internal-hub-resolve/routes.js";
import { internalMcpRoutes } from "./modules/internal-mcp/routes.js";
import { appointmentsRoutes } from "./modules/appointments/routes.js";
import { cronRoutes } from "./modules/cron/routes.js";
import { processConfirmationsRoutes } from "./modules/process-confirmations/routes.js";
import { Server as SocketIOServer } from "socket.io";
import { attachCoworkerSocket } from "./modules/coworker/coworker-socket.js";
import { authMiddlewarePlugin } from "./middlewares/auth.js";

import { crmSpaPublicOrigins } from "./service/meeting-service/config.js";

function corsOrigins(): Array<string | RegExp> {
  const extras = crmSpaPublicOrigins();
  return [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:3000",
    // Dev: Vite on LAN (phone / another machine)
    /^http:\/\/192\.168\.\d{1,3}\.\d{1,3}:5173$/,
    /^http:\/\/10\.\d{1,3}\.\d{1,3}\.\d{1,3}:5173$/,
    // Meet add-on tunnels (Cloudflare quick tunnel / ngrok SPA)
    /^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/,
    /^https:\/\/[a-z0-9-]+\.ngrok-free\.dev$/,
    /^https:\/\/[a-z0-9-]+\.ngrok-free\.app$/,
    ...extras,
  ];
}

export async function buildApp() {
  const app = Fastify({
    logger: true,
  });

  await app.register(cors, {
    origin: corsOrigins(),
    credentials: true,
  });

  await app.register(cookie);
  await app.register(authMiddlewarePlugin);
  await app.register(responseEnvelopePlugin);

  app.setNotFoundHandler((_request, reply) => {
    return sendError(reply, RESPONSE.not_found, 404);
  });

  app.setErrorHandler((error, _request, reply) => {
    const handled = error instanceof Error ? error : new Error(RESPONSE.faild);
    const statusCode = (handled as Error & { statusCode?: unknown }).statusCode;
    const status =
      typeof statusCode === "number" && statusCode >= 400
        ? statusCode
        : 500;
    const message =
      status >= 500
        ? RESPONSE.internal_error
        : handled.message || RESPONSE.faild;
    if (status >= 500) {
      app.log.error(handled);
    }
    return reply.code(status).send(errorBody(message, status));
  });

  await app.register(swagger, {
    openapi: {
      info: {
        title: "Worktual CRM API",
        description:
          "CRM Fastify API. JSON responses use { statusCode, message, ...payload }. " +
          "Browser sessions use cookies; machine integrations use Authorization: Bearer <api_key> " +
          "(create keys in Configuration → Developers). See docs/customer-integration.md.",
        version: "0.1.0",
      },
    },
  });

  await app.register(swaggerUi, {
    routePrefix: "/docs",
  });

  await app.register(healthRoutes);
  await app.register(authRoutes, { prefix: "/api/auth" });
  await app.register(voiceRoutes, { prefix: "/api" });
  await app.register(contactsRoutes, { prefix: "/api/contacts" });
  await app.register(notificationsRoutes, { prefix: "/api/notifications" });
  await app.register(companiesRoutes, { prefix: "/api/companies" });
  await app.register(productsRoutes, { prefix: "/api/products" });
  await app.register(salesRoutes, { prefix: "/api/sales" });
  await app.register(financeRoutes, { prefix: "/api/finance" });
  await app.register(configurationRoutes, { prefix: "/api/configuration" });
  await app.register(privacyRequestsRoutes, {
    prefix: "/api/privacy-requests",
  });
  await app.register(inboxRoutes, { prefix: "/api/inbox" });
  await app.register(activitiesRoutes, { prefix: "/api/activities" });
  await app.register(appointmentsRoutes, { prefix: "/api/appointments" });
  await app.register(calendarRoutes, { prefix: "/api/calendar" });
  await app.register(commerceRoutes, { prefix: "/api/commerce" });
  await app.register(homeRoutes, { prefix: "/api/home" });
  await app.register(reportsRoutes, { prefix: "/api/reports" });
  await app.register(agentsRoutes, { prefix: "/api/agents" });
  await app.register(coworkerRoutes, { prefix: "/api/coworker" });
  await app.register(agentMemoryRoutes, { prefix: "/api/agent-memory" });
  await app.register(processConfirmationsRoutes, {
    prefix: "/api/process-confirmations",
  });
  await app.register(serviceRoutes, { prefix: "/api/service" });
  await app.register(marketingRoutes, { prefix: "/api/marketing" });
  await app.register(seoRoutes, { prefix: "/api/seo" });
  await app.register(internalSeoRoutes, { prefix: "/api/internal/seo" });
  await app.register(googleOAuthRoutes, { prefix: "/api/google/oauth" });
  await app.register(microsoftOAuthRoutes, { prefix: "/api/microsoft/oauth" });
  await app.register(meetingAssistRoutes, {
    prefix: "/api/meeting-assist/sessions",
  });
  await app.register(meetingAssistSttWsRoutes, {
    prefix: "/api/meeting-assist/sessions",
  });
  await app.register(meetingAssistHostRoutes, {
    prefix: "/api/meeting-assist/hosts",
  });
  await app.register(meetingNotetakerRoutes, {
    prefix: "/api/meeting-assist/notetaker",
  });
  await app.register(meetingServicePublicRoutes, { prefix: "/v1" });
  await app.register(meetingServiceAddonProxyRoutes);
  await app.register(meetingTranscriptWebhookRoutes, {
    prefix: "/api/webhooks",
  });
  await app.register(meetingServiceWebhookRoutes, {
    prefix: "/api/webhooks",
  });
  await app.register(gmailPushWebhookRoutes, {
    prefix: "/api/webhooks",
  });
  await app.register(googleCalendarPushWebhookRoutes, {
    prefix: "/api/webhooks",
  });
  await app.register(paymentGatewayWebhookRoutes, {
    prefix: "/api/webhooks",
  });
  await app.register(internalAssignmentRoutes, {
    prefix: "/api/internal/assignment",
  });
  await app.register(internalEnrichmentRoutes, {
    prefix: "/api/internal/enrichment",
  });
  await app.register(internalScoringRoutes, {
    prefix: "/api/internal/scoring",
  });
  await app.register(internalSummaryRoutes, {
    prefix: "/api/internal/summary",
  });
  await app.register(internalNurtureRoutes, {
    prefix: "/api/internal/nurture",
  });
  await app.register(internalLifecycleRoutes, {
    prefix: "/api/internal/lifecycle",
  });
  await app.register(internalAutoReplyRoutes, {
    prefix: "/api/internal/auto-reply",
  });
  await app.register(internalHubOutboundRoutes, {
    prefix: "/api/internal/hub-outbound-email",
  });
  await app.register(internalMeetingBriefRoutes, {
    prefix: "/api/internal/meeting-brief",
  });
  await app.register(internalMeetingMissRoutes, {
    prefix: "/api/internal/meeting-miss",
  });
  await app.register(internalMeetingMomRoutes, {
    prefix: "/api/internal/meeting-mom",
  });
  await app.register(internalPostMeetingRoutes, {
    prefix: "/api/internal/post-meeting",
  });
  await app.register(internalMeetingAssistRoutes, {
    prefix: "/api/internal/meeting-assist",
  });
  await app.register(internalForecastRoutes, {
    prefix: "/api/internal/forecast",
  });
  await app.register(internalSalesCoachRoutes, {
    prefix: "/api/internal/sales-coach",
  });
  await app.register(internalComplianceRoutes, {
    prefix: "/api/internal/compliance",
  });
  await app.register(internalInvoiceEscalationRoutes, {
    prefix: "/api/internal/invoice-escalation",
  });
  await app.register(internalCompanyCollectionRiskRoutes, {
    prefix: "/api/internal/company-collection-risk",
  });
  await app.register(internalRevenueGapForecastRoutes, {
    prefix: "/api/internal/revenue-gap-forecast",
  });
  await app.register(internalInvoiceDunningRoutes, {
    prefix: "/api/internal/invoice-dunning",
  });
  await app.register(internalExpansionMatcherRoutes, {
    prefix: "/api/internal/expansion-matcher",
  });
  await app.register(internalHubResolveRoutes, {
    prefix: "/api/internal/hub-resolve",
  });
  await app.register(internalMcpRoutes, { prefix: "/api/internal/mcp" });
  await app.register(cronRoutes, { prefix: "/api/cron" });

  // Socket.IO transport used for coworker chat turns (emit/ack).
  // Migration phase: REST endpoints remain available.
  const io = new SocketIOServer(app.server, {
    path: "/socket-io",
    cors: {
      origin: corsOrigins() as any,
      credentials: true,
    },
    // Polling-only on the server side too — dev proxy websocket upgrades are flaky.
    transports: ["polling"],
    allowUpgrades: false,
    pingInterval: 25_000,
    pingTimeout: 60_000,
  });
  attachCoworkerSocket(io);

  return app;
}
