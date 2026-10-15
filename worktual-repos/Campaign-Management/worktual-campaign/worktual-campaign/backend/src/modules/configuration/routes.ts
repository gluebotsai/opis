import type { FastifyInstance } from "fastify";
import { CONFIGURATION } from "../../helpers/constants.js";
import { validateSession } from "../../middlewares/authendication.js";
import {
  getChannelStubHandler,
  getEmailConfigHandler,
  getEmailPhase2ConfigHandler,
  getEmailSendReadinessHandler,
  getEmailSenderConfirmHandler,
  getPushConfigHandler,
  getSmsConfigHandler,
  listConfigChannelsHandler,
  postEmailDomainVerifyHandler,
  postEmailDomainDkimExportHandler,
  postEmailReturnPathVerifyHandler,
  postEmailSenderHandler,
  postEmailSenderResendHandler,
  postEmailSenderVerifyHandler,
  postEmailSenderActivateHandler,
  postEmailPhase2TestSendHandler,
  postEmailTrackLinkPreviewHandler,
  getAppPushIntegrationApiKeyHandler,
  postAppPushIntegrationApiKeyHandler,
  postInternalOrgAppPushApiKeyHandler,
  deleteEmailSenderHandler,
  putEmailCapsHandler,
  putEmailDomainHandler,
  putEmailDomainProviderHandler,
  putEmailOrgHandler,
  putEmailReturnPathHandler,
  putPushConfigHandler,
  postPushTestSendHandler,
  putSmsConfigHandler,
} from "./handler.js";

/** Campaign email + push config (campaign DB) + other channels (Accounts read-only). */
export default async function configurationRoutes(server: FastifyInstance) {
  // Public mailbox verification (no auth) — must be registered before the auth hook.
  server.get(CONFIGURATION.EMAIL_SENDER_CONFIRM, {
    schema: {
      tags: ["Configuration"],
      summary: "Confirm sender via mailbox verification link",
    },
    handler: getEmailSenderConfirmHandler,
  });

  server.post(CONFIGURATION.INTERNAL_ORG_APP_PUSH_API_KEY, {
    schema: {
      tags: ["Configuration"],
      summary:
        "Onboarding: mint org app-push API key (x-internal-service-key)",
      body: {
        type: "object",
        required: ["organizationId"],
        properties: {
          organizationId: { type: "string" },
          purpose: { type: "string" },
        },
      },
    },
    handler: postInternalOrgAppPushApiKeyHandler,
  });

  server.addHook("preValidation", async (request, reply) => {
    // Skip auth for public confirm route and internal onboarding key mint
    const url = request.url.split("?")[0] || "";
    if (url.endsWith("/email/senders/confirm")) return;
    if (url.endsWith("/internal/org-app-push-api-key")) return;
    await validateSession(request, reply);
  });

  server.get(CONFIGURATION.CHANNELS, {
    schema: {
      tags: ["Configuration"],
      summary: "List channel configs (email/push from campaign DB; others Accounts)",
    },
    handler: listConfigChannelsHandler,
  });

  server.get(CONFIGURATION.CHANNEL, {
    schema: {
      tags: ["Configuration"],
      summary: "Get one channel config detail",
    },
    handler: getChannelStubHandler,
  });

  server.get(CONFIGURATION.PUSH, {
    schema: {
      tags: ["Configuration"],
      summary: "Get web_push or app_push config bundle",
    },
    handler: getPushConfigHandler,
  });

  server.put(CONFIGURATION.PUSH, {
    schema: {
      tags: ["Configuration"],
      summary: "Save web_push or app_push provider fields",
    },
    handler: putPushConfigHandler,
  });

  server.post(CONFIGURATION.PUSH_TEST_SEND, {
    schema: {
      tags: ["Configuration"],
      summary: "Send a one-off test App push or Web push using saved credentials",
    },
    handler: postPushTestSendHandler,
  });

  server.get(CONFIGURATION.SMS, {
    schema: {
      tags: ["Configuration"],
      summary: "Get SMS / DLT sending config bundle",
    },
    handler: getSmsConfigHandler,
  });

  server.put(CONFIGURATION.SMS, {
    schema: {
      tags: ["Configuration"],
      summary: "Save SMS / DLT provider fields",
    },
    handler: putSmsConfigHandler,
  });

  server.get(CONFIGURATION.EMAIL, {
    schema: {
      tags: ["Configuration"],
      summary: "Get email sending config bundle (campaign DB)",
    },
    handler: getEmailConfigHandler,
  });

  server.put(CONFIGURATION.EMAIL_ORG, {
    schema: { tags: ["Configuration"], summary: "Save org postal address" },
    handler: putEmailOrgHandler,
  });

  server.post(CONFIGURATION.EMAIL_SENDERS, {
    schema: { tags: ["Configuration"], summary: "Add campaign From sender" },
    handler: postEmailSenderHandler,
  });

  server.post(CONFIGURATION.EMAIL_SENDER_VERIFY, {
    schema: {
      tags: ["Configuration"],
      summary: "Verify pending sender (or confirm via mailbox link)",
    },
    handler: postEmailSenderVerifyHandler,
  });

  server.post(CONFIGURATION.EMAIL_SENDER_RESEND, {
    schema: { tags: ["Configuration"], summary: "Resend sender verification" },
    handler: postEmailSenderResendHandler,
  });

  server.post(CONFIGURATION.EMAIL_SENDER_ACTIVATE, {
    schema: {
      tags: ["Configuration"],
      summary:
        "Set verified company-domain sender as active (not used for launch From — My Accounts mailbox is)",
    },
    handler: postEmailSenderActivateHandler,
  });

  server.delete(CONFIGURATION.EMAIL_SENDER_BY_ID, {
    schema: {
      tags: ["Configuration"],
      summary: "Delete a campaign From sender",
    },
    handler: deleteEmailSenderHandler,
  });

  server.put(CONFIGURATION.EMAIL_DOMAINS, {
    schema: { tags: ["Configuration"], summary: "Add/update sending domain" },
    handler: putEmailDomainHandler,
  });

  server.post(CONFIGURATION.EMAIL_DOMAIN_VERIFY, {
    schema: {
      tags: ["Configuration"],
      summary: "Verify domain DNS against stored DKIM/SPF/DMARC",
    },
    handler: postEmailDomainVerifyHandler,
  });

  server.put(CONFIGURATION.EMAIL_DOMAIN_PROVIDER, {
    schema: {
      tags: ["Configuration"],
      summary:
        "Save Postfix domainId after OpenDKIM handoff (Mode B branded send)",
    },
    handler: putEmailDomainProviderHandler,
  });

  server.post(CONFIGURATION.EMAIL_DOMAIN_DKIM_EXPORT, {
    schema: {
      tags: ["Configuration"],
      summary:
        "Ops-only: export DKIM private PEM (requires x-internal-service-key)",
    },
    handler: postEmailDomainDkimExportHandler,
  });

  server.put(CONFIGURATION.EMAIL_RETURN_PATH, {
    schema: { tags: ["Configuration"], summary: "Save return-path domain" },
    handler: putEmailReturnPathHandler,
  });

  server.post(CONFIGURATION.EMAIL_RETURN_PATH_VERIFY, {
    schema: { tags: ["Configuration"], summary: "Verify return-path" },
    handler: postEmailReturnPathVerifyHandler,
  });

  server.put(CONFIGURATION.EMAIL_CAPS, {
    schema: {
      tags: ["Configuration"],
      summary: "Update batch / warmup sending caps",
    },
    handler: putEmailCapsHandler,
  });

  server.get(CONFIGURATION.EMAIL_PHASE2, {
    schema: {
      tags: ["Configuration"],
      summary:
        "Phase 2 — My Accounts campaign mailbox (read-only; not Worktual API)",
    },
    handler: getEmailPhase2ConfigHandler,
  });

  server.get(CONFIGURATION.EMAIL_SEND_READINESS, {
    schema: {
      tags: ["Configuration"],
      summary:
        "Email send pipeline readiness (mailbox + GOOGLE/MICROSOFT OAuth + MS_TOKEN on API)",
    },
    handler: getEmailSendReadinessHandler,
  });

  server.post(CONFIGURATION.EMAIL_PHASE2_TEST_SEND, {
    schema: {
      tags: ["Configuration"],
      summary:
        "Phase 2 — send one test email via Accounts OAuth/SMTP (not Worktual blast API)",
    },
    handler: postEmailPhase2TestSendHandler,
  });

  server.post(CONFIGURATION.EMAIL_TRACK_LINK_PREVIEW, {
    schema: {
      tags: ["Configuration"],
      summary:
        "Temporary QA — homepage UTM + wt={token} track link from org/campaign/contact ids",
    },
    handler: postEmailTrackLinkPreviewHandler,
  });

  server.get(CONFIGURATION.INTEGRATION_APP_PUSH_API_KEY, {
    schema: {
      tags: ["Configuration"],
      summary: "Admin: app push integration key status (prefix only)",
    },
    handler: getAppPushIntegrationApiKeyHandler,
  });

  server.post(CONFIGURATION.INTEGRATION_APP_PUSH_API_KEY, {
    schema: {
      tags: ["Configuration"],
      summary:
        "Admin: mint or rotate org app push API key (plain key returned once)",
    },
    handler: postAppPushIntegrationApiKeyHandler,
  });
}
