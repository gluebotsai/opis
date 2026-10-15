// @ts-nocheck — worktual_bigint Prisma BigInt ids; runtime coerced to string in plugins/prisma.ts
import type { Prisma } from "@prisma/client";
import { prisma } from "../plugins/prisma.js";
import type { CampaignSessionUser } from "../types/auth.js";
import { AppError } from "../helpers/response-builders.js";
import { contactIdForCampaign } from "../helpers/id-schema.js";
import { toAgentChannel } from "../helpers/channel-ids.js";
import {
  isOnDemandLaunchPlan,
  isSendableLaunchChannel,
  ON_DEMAND_LAUNCH_FLAG,
  onDemandLaunchPlanPrismaFilter,
  readAudienceCdpLookupIds,
} from "../helpers/launch-send-plan.js";
import {
  findContactsByIdentityDao,
  listContactEmailsByIdsDao,
  listContactSummariesByIdsDao,
  ON_DEMAND_CONTACT_LOOKUP_OPTS,
  type ContactDbQueryOpts,
} from "./contact.js";
import {
  engagementRatesForChannel,
  loadCampaignMetricsMap,
  type CampaignMetricTotals,
} from "./campaign-metrics.js";
import {
  assertEmailSendPipelineReady,
  isEmailSendPipelineFailure,
} from "../helpers/email-send-pipeline-ready.js";
import { scheduleEmailCampaignBatchesDao } from "./email-launch.js";
import { schedulePushCampaignBatchesDao } from "./push-launch.js";
import { scheduleWhatsAppCampaignBatchesDao } from "./whatsapp-launch.js";
import { markCampaignSendPlannedDao } from "./launch-send.js";
import {
  prepareOnDemandViaAgents,
  type OnDemandPreparedTemplate,
} from "../services/on-demand-prepare.js";
import {
  pairCdpIdsWithRequestEmails,
  type EmailDestinationGateOpts,
} from "../helpers/on-demand-email-dest.js";
import { ensureRequestEmailsOnCdpContactsDao } from "./contact.js";

export { ON_DEMAND_LAUNCH_FLAG };

const DEFAULT_CHANNELS = ["email"] as const;

export type OnDemandSource = "agent" | "spoke" | "hub" | "internal";

export type OnDemandLaunchInput = {
  request_text: string;
  /** Contact emails to resolve in CDP. */
  emails?: string[];
  /** Optional phones for WhatsApp / lookup. */
  phones?: string[];
  /** CDP / customer ids (numeric, UUID, or CDP-* opaque). */
  contact_ids?: string[];
  /** Alias of contact_ids (hub / spoke payloads). */
  customer_ids?: string[];
  /** Channels to attach; defaults to email only (prefer_primary). */
  channels?: string[];
  /** prefer_primary (default) | staggered | broadcast */
  orchestration_mode?: "prefer_primary" | "staggered" | "broadcast" | string;
  /** Required when orchestration_mode=broadcast and multiple channels. */
  broadcast_confirmed?: boolean;
  subject?: string | null;
  body?: string | null;
  title?: string | null;
  name?: string | null;
  /** Who submitted the run (hub posts once and expects ack only). */
  source?: OnDemandSource;
};

export type OnDemandChannelMetricView = {
  channel: string;
  sent: number;
  delivered: number;
  opens: number;
  clicks: number;
  /** null when channel does not track opens (e.g. WhatsApp). */
  openRate: number | null;
  /** null when channel does not track clicks. */
  clickRate: number | null;
};

export type OnDemandRunView = {
  id: string;
  title: string;
  status: string;
  source: OnDemandSource;
  channels: string[];
  audienceCount: number;
  audienceHint: string;
  sent: number;
  failed: number;
  pending: number;
  opens: number;
  clicks: number;
  /** Aggregate open rate when any open-tracked channel has delivery; else null. */
  openRate: number | null;
  /** Aggregate click rate when any click-tracked channel has delivery; else null. */
  clickRate: number | null;
  channelMetrics: OnDemandChannelMetricView[];
  requestText: string;
  subject: string;
  bodyPreview: string;
  createdAt: string;
  updatedAt: string;
  scheduledAt: string | null;
  warnings: string[];
  checklist: Array<{
    id: string;
    label: string;
    detail?: string;
    status: "done" | "active" | "pending" | "failed" | "skipped";
    at: string | null;
  }>;
  agentThought: string[];
};

function normalizeChannels(raw: string[] | undefined): string[] {
  const list = (raw?.length ? raw : [...DEFAULT_CHANNELS])
    .map((c) => toAgentChannel(String(c || "")))
    .filter((c) => isSendableLaunchChannel(c));
  return [...new Set(list.length ? list : ["email"])];
}

function extractEmails(text: string): string[] {
  const matches = text.match(
    /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  );
  return matches ? [...new Set(matches.map((e) => e.toLowerCase()))] : [];
}

function extractPhones(text: string): string[] {
  const matches = text.match(/\+?\d[\d\s().-]{7,}\d/g);
  if (!matches) return [];
  return [
    ...new Set(
      matches
        .map((p) => p.replace(/[^\d+]/g, ""))
        .filter((p) => p.replace(/\D/g, "").length >= 8),
    ),
  ];
}

/** Customer / CDP ids from free text (e.g. "customer id is 1829…"). */
function extractCustomerIds(text: string): string[] {
  const out = new Set<string>();
  const raw = String(text || "");
  for (const m of raw.matchAll(
    /(?:customer|cdp|contact)\s*(?:id|ids)?\s*(?:is|=|:|-)?\s*([A-Za-z0-9._:-]{8,64})/gi,
  )) {
    const id = String(m[1] || "").trim();
    if (id && !id.includes("@")) out.add(id);
  }
  for (const m of raw.matchAll(/\b(\d{10,22})\b/g)) {
    out.add(m[1]);
  }
  for (const m of raw.matchAll(/\b(CDP-[A-Za-z0-9._:-]{4,160})\b/gi)) {
    out.add(m[1]);
  }
  return [...out];
}

function normalizeSource(raw: unknown): OnDemandSource {
  const s = String(raw || "")
    .trim()
    .toLowerCase();
  if (s === "spoke" || s === "hub" || s === "internal") return s;
  return "agent";
}

function sourceFromLaunchPlan(plan: Record<string, unknown>): OnDemandSource {
  const raw = plan.hub_source ?? plan.source;
  if (raw === "spoke" || raw === "hub" || raw === "internal" || raw === "agent") {
    return raw;
  }
  if (raw === "on_demand_api") return "agent";
  return "agent";
}

function fieldsForChannel(
  templates: OnDemandPreparedTemplate[],
  channel: string,
): Record<string, unknown> {
  const hit = templates.find(
    (t) => toAgentChannel(t.channel) === toAgentChannel(channel),
  );
  return hit?.fields && typeof hit.fields === "object" ? hit.fields : {};
}

function emailBodyPreview(fields: Record<string, unknown>): string {
  const paragraphs = Array.isArray(fields.paragraphs)
    ? fields.paragraphs.map((p) => String(p)).filter(Boolean)
    : [];
  if (paragraphs.length) return paragraphs.join("\n\n");
  const sections = Array.isArray(fields.sections) ? fields.sections : [];
  return sections
    .flatMap((raw) => {
      if (!raw || typeof raw !== "object") return [];
      const section = raw as Record<string, unknown>;
      const content = String(section.content || "").trim();
      const items = Array.isArray(section.items)
        ? section.items.map((item) => String(item)).filter(Boolean)
        : [];
      const label = String(section.label || "").trim();
      return [content, ...items, label].filter(Boolean);
    })
    .join("\n\n");
}

function collectLaunchIdentities(
  input: OnDemandLaunchInput,
  requestText: string,
  analysis?: {
    emails?: string[];
    phones?: string[];
    customer_ids?: string[];
  } | null,
): { emails: string[]; phones: string[]; customerIds: string[] } {
  const emails = [
    ...new Set(
      [
        ...(input.emails || []).map((e) => e.trim().toLowerCase()),
        ...((analysis?.emails || []).map((e) => String(e).trim().toLowerCase())),
        ...extractEmails(requestText),
      ].filter(Boolean),
    ),
  ];
  const phones = [
    ...new Set(
      [
        ...(input.phones || []).map((p) => p.trim()),
        ...((analysis?.phones || []).map((p) => String(p).trim())),
        ...extractPhones(requestText),
      ].filter(Boolean),
    ),
  ];
  const customerIds = [
    ...new Set(
      [
        ...(input.contact_ids || []).map((id) => String(id).trim()),
        ...(input.customer_ids || []).map((id) => String(id).trim()),
        ...((analysis?.customer_ids || []).map((id) => String(id).trim())),
        ...extractCustomerIds(requestText),
      ].filter(Boolean),
    ),
  ];
  return { emails, phones, customerIds };
}

function isAccountStatementTimeout(err: unknown): boolean {
  return (
    err instanceof Error &&
    /statement timeout|canceling statement/i.test(err.message)
  );
}

function rethrowAccountDbError(err: unknown, context: string): never {
  if (isAccountStatementTimeout(err)) {
    throw new AppError(
      `${context} timed out loading contacts from the accounts database (over 2 minutes). `
        + "Retry shortly; if this persists, check CDP indexes for org or contact the platform team.",
      503,
    );
  }
  throw err;
}

type OnDemandResolvedAudience = {
  contactIds: string[];
  resolvedHints: string[];
  emailsOnFile: string[];
};

function identitiesAddedByAnalysis(
  before: { emails: string[]; phones: string[]; customerIds: string[] },
  after: { emails: string[]; phones: string[]; customerIds: string[] },
): boolean {
  const inBefore = (val: string, list: string[]) =>
    list.some((x) => x.toLowerCase() === val.toLowerCase());
  for (const e of after.emails) {
    if (!inBefore(e, before.emails)) return true;
  }
  for (const p of after.phones) {
    if (!before.phones.includes(p)) return true;
  }
  for (const id of after.customerIds) {
    if (!before.customerIds.includes(id)) return true;
  }
  return false;
}

export async function resolveOnDemandContacts(
  session: CampaignSessionUser,
  identities: {
    emails: string[];
    phones: string[];
    customerIds: string[];
  },
  lookupOpts: ContactDbQueryOpts = ON_DEMAND_CONTACT_LOOKUP_OPTS,
): Promise<{ contactIds: string[]; cdpIds: string[]; resolvedHints: string[] }> {
  const { emails, phones, customerIds } = identities;
  if (!emails.length && !phones.length && !customerIds.length) {
    throw new AppError(
      "Provide at least one contact email, phone, or customer id in the request. "
        + "On-demand plan aborted — nothing was sent.",
      400,
    );
  }

  const contactIdSet = new Set<string>();
  const cdpIdSet = new Set<string>();
  const resolvedHints: string[] = [];

  const trackContact = (cdpId: string, hint?: string | null) => {
    const id = String(cdpId || "").trim();
    if (!id) return;
    cdpIdSet.add(id);
    contactIdSet.add(contactIdForCampaign(id));
    if (hint) resolvedHints.push(String(hint));
  };

  try {
    // Hub payloads include email — resolve by email first (indexed) before CDP id scans.
    for (const email of emails) {
      const rows = await findContactsByIdentityDao(
        session,
        { email },
        lookupOpts,
      );
      for (const row of rows) {
        trackContact(String(row.id), row.email || email);
      }
    }
    for (const phone of phones) {
      const rows = await findContactsByIdentityDao(
        session,
        { phone },
        lookupOpts,
      );
      for (const row of rows) {
        trackContact(
          String(row.id),
          row.phone || row.email || phone,
        );
      }
    }
    if (customerIds.length) {
      const byId = await listContactSummariesByIdsDao(
        session,
        customerIds,
        { ...lookupOpts, skipOpaqueFallback: false },
      );
      for (const row of byId) {
        trackContact(
          String(row.contactId),
          row.email || row.phone || row.name || row.contactId,
        );
      }
    }
  } catch (err) {
    rethrowAccountDbError(err, "On-demand audience lookup");
  }

  const contactIds = [...contactIdSet];
  if (!contactIds.length) {
    throw new AppError(
      "No matching contacts found for the given email/phone/customer id in this organization. "
        + "On-demand plan aborted before templates — nothing was sent.",
      400,
    );
  }
  return {
    contactIds,
    cdpIds: [...cdpIdSet],
    resolvedHints,
  };
}

function emailLookupOpts(
  lookupOpts: ContactDbQueryOpts,
): ContactDbQueryOpts {
  return {
    ...lookupOpts,
    skipOpaqueFallback: false,
  };
}

function emailDestinationGateOpts(
  input: OnDemandLaunchInput,
  resolved: { cdpIds: string[] },
  identities: { emails: string[] },
): EmailDestinationGateOpts | undefined {
  const source = normalizeSource(input.source);
  const hubLike =
    source === "hub" || source === "spoke" || source === "internal";
  const requestEmails = identities.emails || [];
  const cdpLookupIds = (resolved.cdpIds || []).filter(Boolean);
  if (!requestEmails.length && !cdpLookupIds.length) return undefined;
  const trustRequestEmails =
    hubLike || (cdpLookupIds.length > 0 && requestEmails.length > 0);
  if (!trustRequestEmails) return undefined;
  return {
    cdpLookupIds,
    requestEmails,
    trustRequestEmails: true,
  };
}

/** When email is in the send set, contacts must have an email on file. */
export async function requireEmailDestinations(
  session: CampaignSessionUser,
  contactIds: string[],
  channels: string[],
  resolvedHints: string[],
  lookupOpts: ContactDbQueryOpts = ON_DEMAND_CONTACT_LOOKUP_OPTS,
  cached?: Pick<OnDemandResolvedAudience, "emailsOnFile" | "contactIds">,
  gateOpts?: EmailDestinationGateOpts,
): Promise<OnDemandResolvedAudience> {
  const wantsEmail = channels.some((c) => toAgentChannel(c) === "email");
  if (!wantsEmail) {
    return { contactIds, resolvedHints, emailsOnFile: [] };
  }

  if (
    cached?.emailsOnFile?.length &&
    cached.contactIds.length === contactIds.length &&
    cached.contactIds.every((id, i) => id === contactIds[i])
  ) {
    return {
      contactIds: cached.contactIds,
      resolvedHints,
      emailsOnFile: cached.emailsOnFile,
    };
  }

  const cdpLookupIds = (gateOpts?.cdpLookupIds || []).filter(Boolean);
  const requestEmails = gateOpts?.requestEmails || [];
  if (gateOpts?.trustRequestEmails && cdpLookupIds.length && requestEmails.length) {
    const pairs = pairCdpIdsWithRequestEmails(cdpLookupIds, requestEmails);
    if (pairs.length) {
      await ensureRequestEmailsOnCdpContactsDao(session, pairs);
    }
  }

  const lookupIds = cdpLookupIds.length ? cdpLookupIds : contactIds;
  let withEmail: Awaited<ReturnType<typeof listContactEmailsByIdsDao>>;
  try {
    withEmail = await listContactEmailsByIdsDao(
      session,
      lookupIds,
      {
        ...emailLookupOpts(lookupOpts),
        // Full cdp_id in lookupIds → exact match; avoid scanning the whole org.
        skipOpaqueFallback: cdpLookupIds.length > 0,
      },
    );
  } catch (err) {
    rethrowAccountDbError(err, "On-demand email destination lookup");
  }
  let emailsOnFile = [
    ...new Set(
      withEmail
        .map((r) => String(r.email || "").trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
  if (!emailsOnFile.length && gateOpts?.trustRequestEmails && requestEmails.length) {
    const summaries = cdpLookupIds.length
      ? await listContactSummariesByIdsDao(
          session,
          cdpLookupIds,
          lookupOpts,
        )
      : [];
    if (summaries.length) {
      emailsOnFile = [
        ...new Set(
          requestEmails
            .map((e) => String(e || "").trim().toLowerCase())
            .filter(Boolean),
        ),
      ];
      return {
        contactIds: contactIds.length
          ? contactIds
          : summaries.map((s) =>
              contactIdForCampaign(String(s.contactId)),
            ),
        resolvedHints: [
          ...emailsOnFile,
          ...resolvedHints.filter(
            (h) => !emailsOnFile.includes(h.toLowerCase()),
          ),
        ],
        emailsOnFile,
      };
    }
  }
  if (!emailsOnFile.length) {
    throw new AppError(
      "Resolved contact(s) have no email on file. "
        + "Cannot send the email channel — on-demand plan aborted before templates. "
        + "Sync the contact email in CDP or pass a verified email with cdpId in the Hub request.",
      400,
    );
  }

  // Prefer email addresses in the audience hint for the summary UI.
  const hint = [
    ...emailsOnFile,
    ...resolvedHints.filter((h) => !emailsOnFile.includes(h.toLowerCase())),
  ];
  return {
    contactIds: withEmail.map((r) => contactIdForCampaign(String(r.contactId))),
    resolvedHints: hint,
    emailsOnFile,
  };
}

/**
 * Create a live campaign tagged on_demand, with agent-analysed templates + audience,
 * then plan email / push / WhatsApp batches via Phase 1 schedulers.
 */
export async function createOnDemandLaunchDao(
  session: CampaignSessionUser,
  input: OnDemandLaunchInput,
) {
  const requestText = String(input.request_text || "").trim();
  if (!requestText) throw new AppError("Request text is required.");

  const earlyChannels = normalizeChannels(input.channels);

  // Resolve Hub/operator audience BEFORE template generation. Missing or
  // unknown contacts abort the plan — no Finished run with empty send.
  const earlyIdentities = collectLaunchIdentities(input, requestText, null);
  let resolved = await resolveOnDemandContacts(session, earlyIdentities);
  let audienceCdpIds = [...(resolved.cdpIds || [])];
  const earlyGateOpts = emailDestinationGateOpts(
    input,
    resolved,
    earlyIdentities,
  );
  let emailGate = await requireEmailDestinations(
    session,
    resolved.contactIds,
    earlyChannels,
    resolved.resolvedHints,
    ON_DEMAND_CONTACT_LOOKUP_OPTS,
    undefined,
    earlyGateOpts,
  );
  let contactIds = emailGate.contactIds;
  let resolvedHints = emailGate.resolvedHints;
  let emailsOnFile = emailGate.emailsOnFile;
  let audienceCache: OnDemandResolvedAudience = {
    contactIds: [...contactIds],
    resolvedHints: [...resolvedHints],
    emailsOnFile: [...emailsOnFile],
  };

  if (earlyChannels.some((c) => toAgentChannel(c) === "email")) {
    await assertEmailSendPipelineReady(session);
  }

  const prepare = await prepareOnDemandViaAgents({
    request_text: requestText,
    channels: input.channels,
    name: input.name,
    emails: earlyIdentities.emails.length
      ? earlyIdentities.emails
      : emailsOnFile,
    phones: earlyIdentities.phones,
    contact_ids: earlyIdentities.customerIds,
    customer_ids: earlyIdentities.customerIds,
    organization_id: String(session.organizationId || ""),
  });

  if (!prepare.ok) {
    throw new AppError(
      prepare.error ||
        "On-demand template creation failed. Start the agents service on :8005 and retry.",
      prepare.error_code === "missing_contact_identity" ||
        String(prepare.error || "").includes("No contact email") ||
        String(prepare.error || "").includes("no email on file")
        ? 400
        : 502,
    );
  }

  const analysis = prepare.analysis || {};
  const mergedIdentities = collectLaunchIdentities(input, requestText, analysis);
  if (identitiesAddedByAnalysis(earlyIdentities, mergedIdentities)) {
    resolved = await resolveOnDemandContacts(session, mergedIdentities);
    audienceCdpIds = [...(resolved.cdpIds || [])];
    emailGate = await requireEmailDestinations(
      session,
      resolved.contactIds,
      earlyChannels,
      resolved.resolvedHints,
      ON_DEMAND_CONTACT_LOOKUP_OPTS,
      undefined,
      emailDestinationGateOpts(input, resolved, mergedIdentities),
    );
    contactIds = emailGate.contactIds;
    resolvedHints = emailGate.resolvedHints;
    emailsOnFile = emailGate.emailsOnFile;
    audienceCache = {
      contactIds: [...contactIds],
      resolvedHints: [...resolvedHints],
      emailsOnFile: [...emailsOnFile],
    };
  } else {
    contactIds = audienceCache.contactIds;
    resolvedHints = audienceCache.resolvedHints;
    emailsOnFile = audienceCache.emailsOnFile;
  }

  const preparedChannels = normalizeChannels(
    prepare.channels?.length
      ? prepare.channels
      : input.channels?.length
        ? input.channels
        : analysis.channels,
  );

  emailGate = await requireEmailDestinations(
    session,
    contactIds,
    preparedChannels,
    resolvedHints,
    ON_DEMAND_CONTACT_LOOKUP_OPTS,
    audienceCache,
    emailDestinationGateOpts(input, resolved, mergedIdentities),
  );
  contactIds = emailGate.contactIds;
  resolvedHints = emailGate.resolvedHints;
  emailsOnFile = emailGate.emailsOnFile;
  audienceCache = {
    contactIds: [...contactIds],
    resolvedHints: [...resolvedHints],
    emailsOnFile: [...emailsOnFile],
  };

  // Respect default: at T0 send on one channel (email preferred) unless hub
  // explicitly lists a single channel or opts into multi via orchestration.
  const orchMode = String(input.orchestration_mode || "prefer_primary")
    .trim()
    .toLowerCase();
  const broadcastOk =
    orchMode === "broadcast" && Boolean(input.broadcast_confirmed);
  let channelsForSend = preparedChannels;
  if (!broadcastOk && preparedChannels.length > 1) {
    const priority = ["email", "whatsapp", "push", "web"];
    const primary =
      priority.find((c) => preparedChannels.includes(c)) ||
      preparedChannels[0];
    channelsForSend = [primary];
  }

  const templates: OnDemandPreparedTemplate[] = Array.isArray(prepare.templates)
    ? prepare.templates.filter((t) => t && !t.fallback && t.fields)
    : [];

  const emailTpl = templates.find(
    (t) => toAgentChannel(t.channel) === "email",
  );
  const emailSubject = String(emailTpl?.fields?.subject || "").trim();
  if (
    !emailTpl ||
    !emailSubject ||
    emailSubject.startsWith("Still exploring?")
  ) {
    throw new AppError(
      "Creation agent did not return a usable email template. " +
        "Ensure agents (:8005) is running and retry — stub copy will not be sent.",
      502,
    );
  }

  const missingChannels = preparedChannels.filter(
    (ch) =>
      !templates.some((t) => toAgentChannel(t.channel) === toAgentChannel(ch)),
  );
  // Require email; other channels optional if Meta/push agents fail
  const templated = preparedChannels.filter(
    (ch) =>
      ch === "email" ||
      templates.some((t) => toAgentChannel(t.channel) === toAgentChannel(ch)),
  );
  if (missingChannels.length) {
    // keep going with channels we have templates for (email required above)
  }
  // T0 send list respects prefer_primary (channelsForSend), intersected with templates.
  let channels = channelsForSend.filter((ch) => templated.includes(ch));
  if (!channels.length && templated.includes("email")) {
    channels = ["email"];
  }

  // Final gate against prefer_primary email set.
  emailGate = await requireEmailDestinations(
    session,
    contactIds,
    channels,
    resolvedHints,
    ON_DEMAND_CONTACT_LOOKUP_OPTS,
    audienceCache,
    emailDestinationGateOpts(input, resolved, mergedIdentities),
  );
  contactIds = emailGate.contactIds;
  resolvedHints = emailGate.resolvedHints;
  emailsOnFile = emailGate.emailsOnFile;

  const emails = [
    ...new Set([...(mergedIdentities.emails || []), ...emailsOnFile]),
  ];
  const phones = mergedIdentities.phones;
  const customerIds = mergedIdentities.customerIds;
  const hubSource = normalizeSource(input.source);

  if (!channels.length) {
    throw new AppError(
      "No channels with creation-agent templates. Restart agents (:8005) and retry.",
      502,
    );
  }

  const emailFields = fieldsForChannel(templates, "email");
  const pushFields =
    fieldsForChannel(templates, "push") ||
    fieldsForChannel(templates, "web");
  const subject = String(emailFields.subject || "").trim();
  const bodyPreview =
    emailBodyPreview(emailFields) ||
    String(pushFields.body || "").trim() ||
    "Follow-up message";
  const name =
    String(
      input.name ||
        prepare.campaign?.name ||
        analysis.campaign_name ||
        "",
    ).trim() ||
    `On-demand — ${resolvedHints[0] || `${contactIds.length} contacts`}`;

  const agentThought = [
    ...(Array.isArray(analysis.thoughts)
      ? analysis.thoughts.map((t) => String(t))
      : []),
    `Insight: ${analysis.insight || "re-engage contact"}`,
    emailsOnFile.length
      ? `Email destinations on file: ${emailsOnFile.slice(0, 5).join(", ")}`
      : "Email destinations on file: none",
    `Templates from creation agent: ${templates.map((t) => t.channel).join(", ")}`,
    missingChannels.length
      ? `Skipped channels without templates: ${missingChannels.join(", ")}`
      : "All requested channels received creation-agent templates",
    "Operator request stored for audit — not used as recipient copy",
  ];

  const now = new Date();
  const launchPlan: Record<string, unknown> = {
    [ON_DEMAND_LAUNCH_FLAG]: true,
    request_text: requestText,
    source: "on_demand_api",
    hub_source: hubSource,
    insight: analysis.insight || null,
    analysis_source: analysis.analysis_source || "agents",
    template_source: "creation_agent",
    prepare_error: null,
    contact_ids: customerIds,
    audience_cdp_ids: audienceCdpIds,
    orchestration_mode: broadcastOk ? "broadcast" : orchMode || "prefer_primary",
    broadcast_confirmed: broadcastOk,
    primary_channel: channels[0] || "email",
    launch_channels: [...channels],
    prepared_channels: preparedChannels,
    send_strategy: {
      mode: broadcastOk ? "broadcast" : "prefer_primary",
      t0_channel_cap: 1,
      t0_channels: [...channels],
      primary_channel: channels[0] || "email",
      narrative: [
        broadcastOk
          ? "Send strategy: Broadcast (all at once)"
          : "Send strategy: Primary only",
        `Fires at T0: ${channels.join(", ") || "email"}`,
      ],
    },
  };

  const created = await prisma.$transaction(async (tx) => {
    const agentSession = await tx.campaignAgentSession.create({
      data: {
        organizationId: session.organizationId,
        branchId: session.branchId,
        createdByUserId: session.id,
        module: "on_demand",
        stage: "launched",
        payload: {
          request_text: requestText,
          analysis,
          channels,
          emails,
          phones,
          agent_thought: agentThought,
        } as Prisma.InputJsonValue,
      },
    });

    const templateIds: Record<string, string> = {};
    for (const channel of channels) {
      const prepared = templates.find(
        (t) => toAgentChannel(t.channel) === toAgentChannel(channel),
      );
      if (!prepared?.fields || !Object.keys(prepared.fields).length) {
        throw new AppError(
          `Missing creation-agent template for channel ${channel}.`,
          502,
        );
      }

      const tmpl = await tx.campaignChannelTemplate.create({
        data: {
          sessionId: agentSession.id,
          organizationId: session.organizationId,
          branchId: session.branchId,
          channel,
          howItWorks:
            prepared.how_it_works ||
            `On-demand ${channel} (creation agent)`,
          fields: prepared.fields as Prisma.InputJsonValue,
        },
      });
      templateIds[channel] = String(tmpl.id);
    }

    const campaign = await tx.campaign.create({
      data: {
        organizationId: session.organizationId,
        branchId: session.branchId,
        sessionId: agentSession.id,
        name,
        description: String(analysis.insight || requestText).slice(0, 500),
        goal: String(prepare.campaign?.goal || analysis.goal || "On-demand send"),
        objective: String(
          prepare.campaign?.objective ||
            analysis.objective ||
            analysis.insight ||
            "Triggered send via On-demand API",
        ),
        status: "live",
        startsAt: now,
        sourceChannel: "standalone_campaign",
        createdByUserId: session.id,
        audienceSummary: resolvedHints.slice(0, 8).join(", ") || null,
        audienceCount: contactIds.length,
        launchPlan: launchPlan as Prisma.InputJsonValue,
        timezone: "Asia/Kolkata",
      },
    });

    await tx.campaignChannel.createMany({
      data: channels.map((channel) => ({
        campaignId: campaign.id,
        organizationId: session.organizationId,
        channel,
        templateId: templateIds[channel] || null,
        howItWorks: "On-demand send (analysed templates)",
        status: "ready",
      })),
    });

    await tx.campaignAudience.createMany({
      data: contactIds.map((contactId) => ({
        campaignId: campaign.id,
        contactId,
      })),
      skipDuplicates: true,
    });

    return {
      campaignId: String(campaign.id),
      sessionId: String(agentSession.id),
      templateIds,
      channels,
      audienceCount: contactIds.length,
      audienceHint: resolvedHints.slice(0, 5).join(", "),
      subject,
      body: bodyPreview,
      name,
      requestText,
      createdAt: now.toISOString(),
      agentThought,
    };
  });

  const warnings: string[] = [];
  let email_send_plan: unknown = null;
  let push_send_plan: unknown = null;
  let whatsapp_send_plan: unknown = null;
  let emailDestinationsFailed = false;

  try {
    email_send_plan = await scheduleEmailCampaignBatchesDao(
      session,
      created.campaignId,
    );
    const planObj =
      email_send_plan && typeof email_send_plan === "object"
        ? (email_send_plan as { scheduled?: boolean; reason?: string; skipped?: number })
        : null;
    if (
      channels.includes("email") &&
      planObj &&
      planObj.scheduled === false &&
      planObj.reason === "no_destinations"
    ) {
      emailDestinationsFailed = true;
      warnings.push(
        "No email destinations on file for the audience — nothing was queued to send.",
      );
    }
  } catch (err) {
    if (isEmailSendPipelineFailure(err)) throw err;
    const msg = err instanceof Error ? err.message : "Failed to plan email batches";
    warnings.push(msg);
    if (
      channels.includes("email") &&
      /suppression filter/i.test(msg)
    ) {
      emailDestinationsFailed = true;
    }
  }

  try {
    push_send_plan = await schedulePushCampaignBatchesDao(
      session,
      created.campaignId,
    );
  } catch (err) {
    warnings.push(
      err instanceof Error ? err.message : "Failed to plan push batches",
    );
  }

  try {
    whatsapp_send_plan = await scheduleWhatsAppCampaignBatchesDao(
      session,
      created.campaignId,
    );
  } catch (err) {
    warnings.push(
      err instanceof Error ? err.message : "Failed to plan WhatsApp batches",
    );
  }

  if (emailDestinationsFailed) {
    await prisma.campaign
      .update({
        where: { id: created.campaignId },
        data: { status: "cancelled" },
      })
      .catch(() => undefined);
    throw new AppError(
      "Resolved contact(s) have no email on file. "
        + "Email channel could not be queued — on-demand run marked failed; nothing was sent.",
      400,
    );
  }

  await markCampaignSendPlannedDao(created.campaignId).catch(() => undefined);

  const run = await getOnDemandRunDao(session, created.campaignId);
  if (run) {
    run.agentThought = created.agentThought;
    run.warnings = warnings;
    run.checklist = buildChecklist({
      createdAt: created.createdAt,
      audienceCount: created.audienceCount,
      audienceHint: created.audienceHint,
      channels: created.channels,
      sent: run.sent,
      failed: run.failed,
      pending: run.pending,
      status: run.status,
      warnings,
      analysed: true,
      templatesReady: true,
      emailsOnFile: emailsOnFile.length > 0,
    });
  }
  return {
    run,
    email_send_plan,
    push_send_plan,
    whatsapp_send_plan,
    warnings,
    analysis,
  };
}

function buildChecklist(args: {
  createdAt: string;
  audienceCount: number;
  audienceHint: string;
  channels: string[];
  sent: number;
  failed: number;
  pending: number;
  status: string;
  warnings: string[];
  analysed?: boolean;
  templatesReady?: boolean;
  emailsOnFile?: boolean;
}): OnDemandRunView["checklist"] {
  const at = args.createdAt;
  const wantsEmail = args.channels.some((c) => toAgentChannel(c) === "email");
  const contactsFailed = wantsEmail && args.emailsOnFile === false;
  const sendDone =
    args.status === "completed" ||
    (args.pending === 0 && args.sent + args.failed > 0);
  const sendFailed =
    args.status === "cancelled" ||
    contactsFailed ||
    (args.failed > 0 && sendDone && args.sent === 0) ||
    (wantsEmail && sendDone && args.sent === 0);
  return [
    {
      id: "request",
      label: "Request received",
      detail: "Operator instruction (not recipient copy)",
      status: "done",
      at,
    },
    {
      id: "analyze",
      label: "Request analysed",
      detail: args.analysed
        ? `Intent + channels: ${args.channels.join(", ")}`
        : "Pending analysis",
      status: args.analysed ? "done" : "active",
      at: args.analysed ? at : null,
    },
    {
      id: "contacts",
      label: "Contacts resolved",
      detail: contactsFailed
        ? `${args.audienceCount} · no email on file (email channel blocked)`
        : `${args.audienceCount} · ${args.audienceHint || "audience"}`,
      status: contactsFailed ? "failed" : "done",
      at,
    },
    {
      id: "content",
      label: "Templates created",
      detail: args.templatesReady
        ? "Recipient-facing copy per channel (LLM / fallback)"
        : "Waiting for template generation",
      status: contactsFailed
        ? "skipped"
        : args.templatesReady
          ? "done"
          : "active",
      at: args.templatesReady && !contactsFailed ? at : null,
    },
    {
      id: "plan",
      label: "Run planned",
      detail: contactsFailed
        ? "Aborted — no email destinations"
        : "Phase 1 batch planners",
      status: contactsFailed ? "failed" : "done",
      at: contactsFailed ? at : at,
    },
    {
      id: "create",
      label: "Campaign & batches created",
      detail: args.warnings.length
        ? args.warnings[0]
        : "Queued via email / push / WhatsApp workers",
      status: contactsFailed
        ? "failed"
        : args.warnings.length && !sendDone
          ? "active"
          : "done",
      at,
    },
    {
      id: "send",
      label: "Sending",
      detail: `${args.sent} sent · ${args.failed} failed · ${args.pending} pending`,
      status: sendFailed
        ? "failed"
        : sendDone
          ? "done"
          : "active",
      at: sendDone || sendFailed ? at : null,
    },
    {
      id: "done",
      label: "Finished",
      detail: sendFailed
        ? "failed — Hub audience not emailed"
        : args.status,
      status: sendFailed
        ? "failed"
        : sendDone
          ? "done"
          : "pending",
      at: sendDone || sendFailed ? at : null,
    },
  ];
}

function onDemandListAudienceHint(
  row: { audienceSummary: string | null },
  plan: Record<string, unknown>,
): string {
  const summary = String(row.audienceSummary || "").trim();
  if (summary) return summary;
  const request = String(plan.request_text || "").trim();
  const emailMatch = request.match(
    /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/,
  );
  return emailMatch ? emailMatch[0].toLowerCase() : "";
}

function minimalOnDemandListView(
  row: {
    id: bigint | string;
    name: string;
    status: string;
    description: string | null;
    audienceSummary: string | null;
    audienceCount: number;
    launchPlan: unknown;
    startsAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    channels: Array<{ channel: string }>;
  },
  metrics?: CampaignMetricTotals | null,
): OnDemandRunView {
  const plan =
    row.launchPlan && typeof row.launchPlan === "object"
      ? (row.launchPlan as Record<string, unknown>)
      : {};
  const channels = row.channels.map((c) => toAgentChannel(c.channel));
  const sent = metrics?.sent ?? 0;
  const failed = metrics?.failed ?? 0;
  const pending = Math.max(0, row.audienceCount - sent - failed);
  const audienceHint = onDemandListAudienceHint(row, plan);
  const requestText =
    typeof plan.request_text === "string"
      ? plan.request_text
      : row.description || "";
  return {
    id: String(row.id),
    title: row.name,
    status: row.status,
    source: sourceFromLaunchPlan(plan),
    channels,
    audienceCount: row.audienceCount,
    audienceHint,
    sent,
    failed,
    pending,
    opens: metrics?.opens ?? 0,
    clicks: metrics?.clicks ?? 0,
    openRate: metrics?.openRate ?? null,
    clickRate: metrics?.clickRate ?? null,
    channelMetrics: (metrics?.channels || []).map((ch) => {
      const rates = engagementRatesForChannel(ch.channel, {
        delivered: ch.delivered,
        opens: ch.opens,
        clicks: ch.clicks,
      });
      return {
        channel: ch.channel,
        sent: ch.sent,
        delivered: ch.delivered,
        opens: ch.opens,
        clicks: ch.clicks,
        openRate: rates.openRate,
        clickRate: rates.clickRate,
      };
    }),
    requestText,
    subject: row.name,
    bodyPreview: requestText.slice(0, 240),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    scheduledAt: row.startsAt ? row.startsAt.toISOString() : null,
    warnings: [],
    checklist: [],
    agentThought: [],
  };
}

async function toOnDemandView(
  session: CampaignSessionUser,
  row: {
    id: bigint | string;
    name: string;
    status: string;
    description: string | null;
    audienceSummary: string | null;
    audienceCount: number;
    launchPlan: unknown;
    startsAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    channels: Array<{ channel: string; templateId: bigint | string | null }>;
  },
  metrics?: CampaignMetricTotals | null,
  mode: "list" | "detail" = "detail",
): Promise<OnDemandRunView> {
  if (mode === "list") {
    return minimalOnDemandListView(row, metrics);
  }
  const id = String(row.id);
  const channels = row.channels.map((c) => toAgentChannel(c.channel));
  const plan =
    row.launchPlan && typeof row.launchPlan === "object"
      ? (row.launchPlan as Record<string, unknown>)
      : {};
  const requestText =
    typeof plan.request_text === "string"
      ? plan.request_text
      : row.description || "";

  let subject = "On-demand message";
  let bodyPreview = requestText;
  const emailCh = row.channels.find(
    (c) => toAgentChannel(c.channel) === "email" && c.templateId,
  );
  if (emailCh?.templateId) {
    const tmpl = await prisma.campaignChannelTemplate.findFirst({
      where: {
        id: emailCh.templateId,
        organizationId: session.organizationId,
      },
    });
    if (tmpl?.fields && typeof tmpl.fields === "object") {
      const fields = tmpl.fields as Record<string, unknown>;
      subject = String(fields.subject || subject);
      bodyPreview = emailBodyPreview(fields) || bodyPreview;
    }
  }

  const sent = metrics?.sent ?? 0;
  const failed = metrics?.failed ?? 0;
  const pending = Math.max(0, row.audienceCount - sent - failed);
  const channelMetrics: OnDemandChannelMetricView[] = (
    metrics?.channels || []
  ).map((ch) => {
    const rates = engagementRatesForChannel(ch.channel, {
      delivered: ch.delivered,
      opens: ch.opens,
      clicks: ch.clicks,
    });
    return {
      channel: ch.channel,
      sent: ch.sent,
      delivered: ch.delivered,
      opens: ch.opens,
      clicks: ch.clicks,
      openRate: rates.openRate,
      clickRate: rates.clickRate,
    };
  });

  const wantsEmail = channels.some((c) => c === "email");
  let emailsOnFile = !wantsEmail;
  let audienceHint = row.audienceSummary || "";
  if (wantsEmail) {
    const audienceRows = await prisma.campaignAudience.findMany({
      where: { campaignId: row.id },
      select: { contactId: true },
      take: 200,
    });
    const ids = audienceRows.map((a) => String(a.contactId));
    const cdpLookupIds = readAudienceCdpLookupIds(plan);
    const lookupIds = cdpLookupIds.length
      ? [...new Set([...cdpLookupIds, ...ids])]
      : ids;
    const withEmail = lookupIds.length
      ? await listContactEmailsByIdsDao(session, lookupIds, {
          skipOpaqueFallback: cdpLookupIds.length > 0,
        })
      : [];
    const emailList = [
      ...new Set(
        withEmail
          .map((r) => String(r.email || "").trim().toLowerCase())
          .filter(Boolean),
      ),
    ];
    emailsOnFile = emailList.length > 0;
    if (emailList.length) {
      audienceHint = emailList.slice(0, 8).join(", ");
    } else if (!audienceHint.includes("@")) {
      audienceHint = audienceHint
        ? `${audienceHint} · email missing on contact`
        : "email missing on contact";
    }
  }

  const viewStatus =
    wantsEmail && !emailsOnFile && sent === 0
      ? "cancelled"
      : row.status;

  return {
    id,
    title: row.name,
    status: viewStatus,
    source: sourceFromLaunchPlan(plan),
    channels,
    audienceCount: row.audienceCount,
    audienceHint,
    sent,
    failed,
    pending,
    opens: metrics?.opens ?? 0,
    clicks: metrics?.clicks ?? 0,
    openRate: metrics?.openRate ?? null,
    clickRate: metrics?.clickRate ?? null,
    channelMetrics,
    requestText,
    subject,
    bodyPreview,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    scheduledAt: row.startsAt ? row.startsAt.toISOString() : null,
    warnings:
      wantsEmail && !emailsOnFile
        ? [
            "Resolved contact(s) have no email on file — email channel could not send.",
          ]
        : [],
    checklist: buildChecklist({
      createdAt: row.createdAt.toISOString(),
      audienceCount: row.audienceCount,
      audienceHint,
      channels,
      sent,
      failed,
      pending,
      status: viewStatus,
      warnings:
        wantsEmail && !emailsOnFile
          ? [
              "Resolved contact(s) have no email on file — email channel could not send.",
            ]
          : [],
      analysed: true,
      templatesReady: true,
      emailsOnFile,
    }),
    agentThought: [
      `Audience: ${audienceHint || `${row.audienceCount} contacts`}`,
      wantsEmail
        ? emailsOnFile
          ? "Email on file: yes"
          : "Email on file: no — cannot deliver email channel"
        : "Email channel not selected",
      `Channels linked: ${channels.join(", ") || "none"}`,
      typeof plan.insight === "string" && plan.insight
        ? `Insight: ${plan.insight}`
        : "Insight stored on launch",
      "Recipient copy from analysed templates — not the operator request text",
    ],
  };
}

async function metricsForCampaigns(
  rows: Array<{
    id: bigint | string;
    launchPlan: unknown;
    audienceCount: number;
    channels: Array<{ channel: string }>;
  }>,
): Promise<Map<string, CampaignMetricTotals>> {
  return loadCampaignMetricsMap(
    rows.map((r) => ({
      id: String(r.id),
      launchPlan: r.launchPlan,
      audienceCount: r.audienceCount,
      channels: r.channels,
    })),
  );
}

export async function listOnDemandRunsDao(session: CampaignSessionUser) {
  const rows = await prisma.campaign.findMany({
    where: {
      organizationId: session.organizationId,
      branchId: session.branchId,
      ...onDemandLaunchPlanPrismaFilter,
    },
    include: {
      channels: { select: { channel: true, templateId: true } },
    },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });

  const metricsMap = await metricsForCampaigns(rows);
  const views: OnDemandRunView[] = [];
  for (const row of rows) {
    try {
      views.push(
        await toOnDemandView(
          session,
          row,
          metricsMap.get(String(row.id)) || null,
          "list",
        ),
      );
    } catch (err) {
      console.error(
        "[on-demand-list] row",
        String(row.id),
        err instanceof Error ? err.message : err,
      );
      views.push(
        minimalOnDemandListView(row, metricsMap.get(String(row.id)) || null),
      );
    }
  }
  return views;
}

export async function getOnDemandRunDao(
  session: CampaignSessionUser,
  campaignId: string,
) {
  const row = await prisma.campaign.findFirst({
    where: {
      id: campaignId,
      organizationId: session.organizationId,
      branchId: session.branchId,
    },
    include: {
      channels: { select: { channel: true, templateId: true } },
    },
  });
  if (!row || !isOnDemandLaunchPlan(row.launchPlan)) {
    throw new AppError("On-demand send not found.", 404);
  }
  const metricsMap = await metricsForCampaigns([row]);
  return toOnDemandView(session, row, metricsMap.get(String(row.id)) || null);
}

/**
 * Hub / spoke fire-and-forget: create the on-demand run, return ack only.
 * Caller does not wait for send completion — workers finish async.
 */
export async function acceptOnDemandFromHubDao(
  session: CampaignSessionUser,
  input: OnDemandLaunchInput,
) {
  const result = await createOnDemandLaunchDao(session, {
    ...input,
    source: input.source === "agent" ? "hub" : input.source || "hub",
    request_text:
      input.request_text?.trim() ||
      `Hub on-demand send for ${(input.customer_ids || input.contact_ids || []).join(", ") || "contacts"}`,
  });
  return {
    accepted: true as const,
    received: true as const,
    run_id: result.run?.id || null,
    message: "Request received",
    warnings: result.warnings || [],
  };
}
