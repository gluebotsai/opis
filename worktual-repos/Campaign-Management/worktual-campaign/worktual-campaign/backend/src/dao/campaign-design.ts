/**
 * Soft CDA — campaign design readiness (warnings only; never blocks launch).
 */
import type { CampaignSessionUser } from "../types/auth.js";
import { getCampaignEmailStatusDao } from "./email-config.js";
import { getCampaignSmsStatusDao } from "./sms-config.js";
import { getCampaignPushStatusDao } from "./push-config.js";
import { listPushEndpointsDao } from "./push-endpoints.js";
import { audienceInsightsDao } from "./contact.js";
import { toAgentChannel } from "../helpers/channel-ids.js";

export type CampaignDesignCheckInput = {
  channels: string[];
  contactIds: string[];
  /** Template channel keys present in the draft (email, sms, …). */
  templateChannels?: string[];
};

export type CampaignDesignCheckResult = {
  warnings: string[];
  config: Record<string, string>;
  audience: {
    count: number;
    with_email: number;
    with_phone: number;
    push_endpoints: number;
    web_endpoints: number;
  };
};

function normalizeChannel(raw: string): string {
  const c = String(raw || "").trim().toLowerCase();
  if (c === "app_push" || c === "apppush") return "push";
  if (c === "web_push" || c === "webpush") return "web";
  return c;
}

export async function checkCampaignDesignDao(
  session: CampaignSessionUser,
  input: CampaignDesignCheckInput,
): Promise<CampaignDesignCheckResult> {
  const channels = [
    ...new Set(
      (input.channels || [])
        .map(normalizeChannel)
        .filter(Boolean),
    ),
  ];
  const contactIds = [...new Set((input.contactIds || []).filter(Boolean))];
  const templateChannels = new Set(
    (input.templateChannels || []).map(normalizeChannel),
  );

  const warnings: string[] = [];
  const config: Record<string, string> = {};

  const [emailStatus, smsStatus, appPushStatus, webPushStatus] =
    await Promise.all([
      getCampaignEmailStatusDao(session.organizationId).catch(() => "not_started"),
      getCampaignSmsStatusDao(session.organizationId).catch(() => "not_started"),
      getCampaignPushStatusDao(session.organizationId, "app_push").catch(
        () => "not_started",
      ),
      getCampaignPushStatusDao(session.organizationId, "web_push").catch(
        () => "not_started",
      ),
    ]);

  if (channels.includes("email")) {
    config.email = String(emailStatus);
    if (emailStatus !== "ready") {
      warnings.push(
        `Email channel config is "${emailStatus}" (not ready). Launch is still allowed — finish Configuration → Email when you can.`,
      );
    }
  }
  if (channels.includes("sms")) {
    config.sms = String(smsStatus);
    if (smsStatus !== "ready") {
      warnings.push(
        `SMS channel config is "${smsStatus}" (not ready). Launch is still allowed.`,
      );
    }
  }
  if (channels.includes("whatsapp")) {
    config.whatsapp = "static_channel_config";
  }
  if (channels.includes("push")) {
    config.app_push = String(appPushStatus);
    if (appPushStatus !== "ready") {
      warnings.push(
        `App push is "${appPushStatus}" (not ready). Complete My Accounts → Setup → Channel Setup → App Push, then launch.`,
      );
    }
  }
  if (channels.includes("web")) {
    config.web_push = String(webPushStatus);
    if (webPushStatus !== "ready") {
      warnings.push(
        `Web push is "${webPushStatus}" (not ready). Complete My Accounts → Setup → Channel Setup → Web Push, then launch.`,
      );
    }
  }

  for (const ch of channels) {
    if (ch === "ppc") continue;
    if (templateChannels.size > 0 && !templateChannels.has(ch)) {
      warnings.push(
        `No template card yet for channel "${ch}". Create/regenerate templates before sending.`,
      );
    }
  }

  const insights = await audienceInsightsDao(session, contactIds);
  for (const w of insights.consent.warnings) warnings.push(w);
  for (const n of insights.quality.notes) warnings.push(n);

  if (
    channels.includes("whatsapp") &&
    contactIds.length > 0 &&
    insights.quality.with_phone === 0
  ) {
    warnings.push(
      "No selected contacts have a phone number. WhatsApp will skip the audience until phones are added.",
    );
  } else if (
    channels.includes("whatsapp") &&
    contactIds.length > 0 &&
    insights.quality.missing_phone > 0
  ) {
    warnings.push(
      `${insights.quality.missing_phone} contact(s) have no phone — WhatsApp will skip them.`,
    );
  }

  let pushEndpoints = 0;
  let webEndpoints = 0;
  if (contactIds.length && (channels.includes("push") || channels.includes("web"))) {
    const [appRows, webRows] = await Promise.all([
      channels.includes("push")
        ? listPushEndpointsDao(session, {
            channel: toAgentChannel("push"),
            contactIds,
            activeOnly: true,
          })
        : Promise.resolve([]),
      channels.includes("web")
        ? listPushEndpointsDao(session, {
            channel: toAgentChannel("web"),
            contactIds,
            activeOnly: true,
          })
        : Promise.resolve([]),
    ]);
    pushEndpoints = appRows.length;
    webEndpoints = webRows.length;
    if (channels.includes("push") && pushEndpoints === 0) {
      warnings.push(
        "No app-push device tokens for this audience yet. App push will skip until devices register.",
      );
    }
    if (channels.includes("web") && webEndpoints === 0) {
      warnings.push(
        "No web-push subscriptions for this audience yet. Web push will skip until browsers subscribe.",
      );
    }
  }

  if (!contactIds.length && channels.some((c) => c !== "ppc")) {
    warnings.push(
      "Audience is empty. Add contacts before expecting channel delivery.",
    );
  }

  return {
    warnings,
    config,
    audience: {
      count: insights.count,
      with_email: insights.quality.with_email,
      with_phone: insights.quality.with_phone,
      push_endpoints: pushEndpoints,
      web_endpoints: webEndpoints,
    },
  };
}
