import type { FastifyInstance } from "fastify";
import { CAMPAIGN } from "../../helpers/constants.js";
import { validateCampaignAccess } from "../../middlewares/authendication.js";
import {
  campaignDesignCheckHandler,
  campaignOrchestrationCheckHandler,
  sendTimeInsightHandler,
  templateComplianceHandler,
  createCampaignHandler,
  createOnDemandLaunchHandler,
  acceptOnDemandFromHubHandler,
  dashboardHandler,
  campaignLiveStatusHandler,
  recentSendFailuresHandler,
  activeLiveSendsHandler,
  portfolioActivitySeriesHandler,
  portfolioPerformanceHandler,
  campaignOpsFeedHandler,
  campaignOpsFeedStreamHandler,
  getCampaignHandler,
  getCampaignRecipientsHandler,
  getOnDemandRunHandler,
  createPersonalisedCrmLaunchHandler,
  createPersonalisedCrmAutomationHandler,
  listPersonalisedCrmRunsHandler,
  getPersonalisedCrmRunHandler,
  getPersonalisedCrmRecipientsHandler,
  pickEmailAbWinnerHandler,
  listCampaignsHandler,
  portfolioMetricsHandler,
  listOnDemandRunsHandler,
  listWhatsAppApprovalNotificationsHandler,
  saveCampaignFromSessionHandler,
  setChannelRunStateHandler,
  stopCampaignHandler,
  trackEmailClickHandler,
  trackEmailOpenHandler,
  trackEmailUnsubscribeHandler,
  trackPublicOptionsHandler,
  trackPushClickHandler,
} from "./handler.js";
import { campaignSchemas } from "./schema.js";

export default async function campaignRoutes(server: FastifyInstance) {
  server.get(CAMPAIGN.TRACK_OPEN, {
    schema: {
      tags: ["Campaigns"],
      summary: "Email open tracking pixel (no auth)",
    },
    handler: trackEmailOpenHandler,
  });
  server.get(CAMPAIGN.TRACK_CLICK, {
    schema: {
      tags: ["Campaigns"],
      summary: "Email click tracking redirect (no auth)",
    },
    handler: trackEmailClickHandler,
  });
  server.get(CAMPAIGN.TRACK_PUSH_CLICK, {
    schema: {
      tags: ["Campaigns"],
      summary: "App / web push tap tracking (no auth)",
    },
    handler: trackPushClickHandler,
  });
  server.post(CAMPAIGN.TRACK_PUSH_CLICK, {
    schema: {
      tags: ["Campaigns"],
      summary: "App / web push tap tracking (no auth)",
    },
    handler: trackPushClickHandler,
  });
  server.get(CAMPAIGN.TRACK_UNSUBSCRIBE, {
    schema: {
      tags: ["Campaigns"],
      summary: "Email unsubscribe (no auth)",
    },
    handler: trackEmailUnsubscribeHandler,
  });
  server.post(CAMPAIGN.TRACK_UNSUBSCRIBE, {
    schema: {
      tags: ["Campaigns"],
      summary: "Email one-click unsubscribe (List-Unsubscribe=One-Click)",
    },
    handler: trackEmailUnsubscribeHandler,
  });
  server.options(CAMPAIGN.TRACK_OPEN, trackPublicOptionsHandler);
  server.options(CAMPAIGN.TRACK_CLICK, trackPublicOptionsHandler);
  server.options(CAMPAIGN.TRACK_PUSH_CLICK, trackPublicOptionsHandler);
  server.options(CAMPAIGN.TRACK_UNSUBSCRIBE, trackPublicOptionsHandler);

  server.addHook("preValidation", async (request, reply) => {
    const url = request.url.split("?")[0] || "";
    if (
      url.includes("/track/open/") ||
      url.includes("/track/click/") ||
      url.includes("/track/push-click/") ||
      url.includes("/track/unsubscribe/") ||
      url.includes("/personalised-crm/automation")
    ) {
      return;
    }
    await validateCampaignAccess(request, reply);
  });

  server.get(CAMPAIGN.DASHBOARD, {
    schema: { tags: ["Campaigns"], summary: "Dashboard counts" },
    handler: dashboardHandler,
  });

  server.get(CAMPAIGN.PORTFOLIO, {
    schema: {
      tags: ["Campaigns"],
      summary: "Portfolio KPI totals (Dashboard / agent parity)",
    },
    handler: portfolioMetricsHandler,
  });

  server.get(CAMPAIGN.PORTFOLIO_PERFORMANCE, {
    schema: {
      tags: ["Campaigns"],
      summary:
        "SSOT performance — launch KPIs + activity series (Dashboard + agent)",
    },
    handler: portfolioPerformanceHandler,
  });

  server.get(CAMPAIGN.ACTIVITY_SERIES, {
    schema: {
      tags: ["Campaigns"],
      summary: "Event-time daily send/open/click series (IST)",
    },
    handler: portfolioActivitySeriesHandler,
  });

  server.get(CAMPAIGN.OPS_FEED_STREAM, {
    schema: {
      tags: ["Campaigns"],
      summary: "SSE stream — live ops feed (Dashboard)",
    },
    handler: campaignOpsFeedStreamHandler,
  });

  server.get(CAMPAIGN.OPS_FEED, {
    schema: {
      tags: ["Campaigns"],
      summary: "Live sends + recent failures + activity series (Dashboard ops)",
    },
    handler: campaignOpsFeedHandler,
  });

  server.get(CAMPAIGN.LIST, {
    schema: {
      tags: ["Campaigns"],
      summary: "List campaigns by monitoring bucket",
      querystring: campaignSchemas.listQuery,
    },
    handler: listCampaignsHandler,
  });

  server.get(CAMPAIGN.WHATSAPP_APPROVAL_NOTIFICATIONS, {
    schema: {
      tags: ["Campaigns"],
      summary:
        "In-app notifications for WhatsApp templates approved by Meta",
    },
    handler: listWhatsAppApprovalNotificationsHandler,
  });

  server.post(CAMPAIGN.FROM_SESSION, {
    schema: {
      tags: ["Campaigns"],
      summary:
        "Save campaign + channels + audience from a create-campaign session (on template save)",
      params: campaignSchemas.sessionIdParams,
      body: campaignSchemas.fromSessionBody,
    },
    handler: saveCampaignFromSessionHandler,
  });

  server.get(CAMPAIGN.ON_DEMAND, {
    schema: {
      tags: ["Campaigns"],
      summary: "List on-demand sends (excluded from Live/Scheduled/Past)",
    },
    handler: listOnDemandRunsHandler,
  });

  server.post(CAMPAIGN.ON_DEMAND, {
    schema: {
      tags: ["Campaigns"],
      summary:
        "Launch an on-demand send for all Phase-1 channels (email/push/web/whatsapp)",
      body: campaignSchemas.onDemandBody,
    },
    handler: createOnDemandLaunchHandler,
  });

  server.post(CAMPAIGN.ON_DEMAND_ACCEPT, {
    schema: {
      tags: ["Campaigns"],
      summary:
        "Hub/spoke accept: receive run payload and ack immediately (no further hub chat)",
      body: campaignSchemas.onDemandAcceptBody,
    },
    handler: acceptOnDemandFromHubHandler,
  });

  server.get(CAMPAIGN.ON_DEMAND_GET, {
    schema: {
      tags: ["Campaigns"],
      summary: "Get one on-demand send with live performance",
      params: campaignSchemas.idParams,
    },
    handler: getOnDemandRunHandler,
  });

  server.get(CAMPAIGN.PERSONALISED_CRM, {
    schema: {
      tags: ["Campaigns"],
      summary: "List Personalised CRM sends (excluded from Live/Scheduled/Past and On-demand)",
    },
    handler: listPersonalisedCrmRunsHandler,
  });

  server.post(CAMPAIGN.PERSONALISED_CRM, {
    schema: {
      tags: ["Campaigns"],
      summary:
        "CRM Personalised CRM: named people, channels, optional send_at (202 run_id)",
      body: campaignSchemas.personalisedCrmBody,
    },
    handler: createPersonalisedCrmLaunchHandler,
  });

  server.post(CAMPAIGN.PERSONALISED_CRM_AUTOMATION, {
    schema: {
      tags: ["Campaigns"],
      summary:
        "CRM monitor/agent Personalised CRM: integration key + organization_id (202 run_id)",
      body: campaignSchemas.personalisedCrmAutomationBody,
    },
    handler: createPersonalisedCrmAutomationHandler,
  });

  server.get(CAMPAIGN.PERSONALISED_CRM_RECIPIENTS, {
    schema: {
      tags: ["Campaigns"],
      summary: "Personalised CRM contact × channel × time × status grid",
      params: campaignSchemas.idParams,
      querystring: campaignSchemas.recipientsQuery,
    },
    handler: getPersonalisedCrmRecipientsHandler,
  });

  server.get(CAMPAIGN.PERSONALISED_CRM_GET, {
    schema: {
      tags: ["Campaigns"],
      summary: "Get one Personalised CRM send with live performance",
      params: campaignSchemas.idParams,
    },
    handler: getPersonalisedCrmRunHandler,
  });

  server.post(CAMPAIGN.DESIGN_CHECK, {
    schema: {
      tags: ["Campaigns"],
      summary: "Soft CDA design readiness (warnings only, never blocks)",
    },
    handler: campaignDesignCheckHandler,
  });

  server.post(CAMPAIGN.ORCHESTRATION_CHECK, {
    schema: {
      tags: ["Campaigns"],
      summary:
        "Soft PDOA channel orchestration suggestions (warnings only, never blocks)",
    },
    handler: campaignOrchestrationCheckHandler,
  });

  server.get(CAMPAIGN.SEND_TIME_INSIGHT, {
    schema: {
      tags: ["Campaigns"],
      summary: "B2B send-time optimizer from past email opens",
    },
    handler: sendTimeInsightHandler,
  });

  server.get(CAMPAIGN.TEMPLATE_COMPLIANCE, {
    schema: {
      tags: ["Campaigns"],
      summary: "WA/SMS template rejection, pause, and near-expiry issues",
    },
    handler: templateComplianceHandler,
  });

  server.get(CAMPAIGN.RECENT_FAILURES, {
    schema: {
      tags: ["Campaigns"],
      summary: "Recent send failures (recipient-level skip/fail reasons)",
    },
    handler: recentSendFailuresHandler,
  });

  server.get(CAMPAIGN.ACTIVE_LIVE_SENDS, {
    schema: {
      tags: ["Campaigns"],
      summary: "Campaigns with queued or sending batches (live ops)",
    },
    handler: activeLiveSendsHandler,
  });

  server.get(CAMPAIGN.LIVE_STATUS, {
    schema: {
      tags: ["Campaigns"],
      summary: "Live batch + recipient status for one campaign",
      params: campaignSchemas.idParams,
    },
    handler: campaignLiveStatusHandler,
  });

  server.get(CAMPAIGN.GET, {
    schema: {
      tags: ["Campaigns"],
      summary: "Get one campaign with channels and run metrics",
      params: campaignSchemas.idParams,
    },
    handler: getCampaignHandler,
  });

  server.get(CAMPAIGN.RECIPIENTS, {
    schema: {
      tags: ["Campaigns"],
      summary:
        "Audience + send recipients: selected, sent, stub, failed, missed",
      params: campaignSchemas.idParams,
      querystring: campaignSchemas.recipientsQuery,
    },
    handler: getCampaignRecipientsHandler,
  });

  server.post(CAMPAIGN.AB_WINNER, {
    schema: {
      tags: ["Campaigns"],
      summary: "Pick email A/B winner and send remainder (or auto-analyse)",
      params: campaignSchemas.idParams,
      body: campaignSchemas.abWinnerBody,
    },
    handler: pickEmailAbWinnerHandler,
  });

  server.post(CAMPAIGN.CHANNEL_RUN_STATE, {
    schema: {
      tags: ["Campaigns"],
      summary: "Pause (stop) or resume a campaign channel",
      params: campaignSchemas.channelRunParams,
      body: campaignSchemas.channelRunBody,
    },
    handler: setChannelRunStateHandler,
  });

  server.post(CAMPAIGN.STOP, {
    schema: {
      tags: ["Campaigns"],
      summary:
        "Stop a live or scheduled campaign (requires reason). Past campaigns are reported as already completed.",
      params: campaignSchemas.idParams,
      body: campaignSchemas.stopBody,
    },
    handler: stopCampaignHandler,
  });

  server.post(CAMPAIGN.CREATE, {
    schema: {
      tags: ["Campaigns"],
      summary: "Create campaign",
      body: campaignSchemas.createBody,
    },
    handler: createCampaignHandler,
  });
}
