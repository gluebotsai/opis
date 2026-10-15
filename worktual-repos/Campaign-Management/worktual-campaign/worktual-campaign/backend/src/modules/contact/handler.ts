import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { requireSession } from "../../middlewares/authendication.js";
import {
  createContactDao,
  deleteContactDao,
  filterContactsDao,
  listFilterableFieldsDao,
  findContactsByIdentityDao,
  getContactByIdDao,
  importContactsDao,
  audienceInsightsDao,
  audienceSegmentationSummaryDao,
  listContactsDao,
  listContactFirstNamesByIdsDao,
  updateContactDao,
  setContactPreferencesDao,
  refreshContactPreferencesFromEngagementDao,
  type ContactFilterInput,
  type ContactRow,
} from "../../dao/contact.js";
import { getEngagementMap } from "../../dao/campaign-contact-engagement.js";
import { getContactCampaignActivityDao } from "../../dao/contact-campaign-activity.js";
import {
  listContactPushChannelsBatchDao,
  registerAppPushDeviceDao,
  registerWebPushSubscriptionDao,
} from "../../dao/push-endpoints.js";
import { AppError, sendSuccess } from "../../helpers/response-builders.js";
import type { CampaignSessionUser } from "../../types/auth.js";
import { RESPONSE } from "../../helpers/constants.js";
import { normalizePreferencesJson } from "../../helpers/contact-preferences.js";
import { env } from "../../config/env.js";
import { zContactId } from "../../helpers/id-schema.js";
import { extractCustomFields } from "../../helpers/contact-custom-fields.js";
import { learnPackFieldsDao } from "../../dao/industry-pack.js";
import {
  personalizeEmailContent,
  personalizePushContent,
  replaceMergeTags,
} from "../../helpers/email-render.js";
import {
  buildMergeMapsForContacts,
  getPersonalizationAdapterName,
  listFixtureRecipients,
} from "../../services/personalization/index.js";
import {
  contactBodySchema,
  contactFilterBodySchema,
  personalizationPreviewBodySchema,
} from "./schema.js";

const idParam = z.object({ id: z.string().trim().min(1) });
const lookupBody = z.object({
  email: z.string().trim().optional().nullable(),
  phone: z.string().trim().optional().nullable(),
  fullName: z.string().trim().optional().nullable(),
});

type ContactPushInput = {
  appPushToken?: string | null;
  appPushPlatform?: string | null;
  webPushEndpoint?: string | null;
  webPushP256dh?: string | null;
  webPushAuth?: string | null;
};

function parseContactBody(body: unknown) {
  const parsed = contactBodySchema.safeParse(body);
  if (!parsed.success) {
    throw new AppError(
      parsed.error.issues[0]?.message ?? RESPONSE.bad_request,
    );
  }
  const customFields = extractCustomFields(body, parsed.data.customFields ?? null);
  return {
    firstName: parsed.data.firstName,
    lastName: parsed.data.lastName ?? null,
    email: (parsed.data.email || "").trim() || null,
    phone: (parsed.data.phone || "").trim() || null,
    companyName: parsed.data.companyName ?? null,
    city: parsed.data.city ?? null,
    customFields,
    appPushToken: (parsed.data.appPushToken || "").trim() || null,
    appPushPlatform: (parsed.data.appPushPlatform || "").trim() || null,
    webPushEndpoint: (parsed.data.webPushEndpoint || "").trim() || null,
    webPushP256dh: (parsed.data.webPushP256dh || "").trim() || null,
    webPushAuth: (parsed.data.webPushAuth || "").trim() || null,
  };
}

async function withCampaignEngagement(
  organizationId: string,
  contacts: ContactRow[],
) {
  try {
    const map = await getEngagementMap(
      organizationId,
      contacts.map((c) => c.id),
    );
    return contacts.map((c) => ({
      ...c,
      campaign_engagement: map.get(c.id) ?? null,
    }));
  } catch {
    return contacts.map((c) => ({ ...c, campaign_engagement: null }));
  }
}

async function withPushChannels(
  session: CampaignSessionUser,
  contacts: Array<ContactRow & { campaign_engagement?: unknown }>,
) {
  if (!contacts.length) return [];
  try {
    const pushByContact = await listContactPushChannelsBatchDao(
      session,
      contacts.map((c) => c.id),
    );
    return contacts.map((c) => {
      const push = pushByContact.get(c.id) ?? { app_push: [], web_push: [] };
      return { ...c, ...push };
    });
  } catch {
    return contacts.map((c) => ({ ...c, app_push: [], web_push: [] }));
  }
}

async function registerContactPushIfProvided(
  session: CampaignSessionUser,
  contact: ContactRow,
  input: ContactPushInput,
) {
  if (input.appPushToken) {
    try {
      await registerAppPushDeviceDao(session, {
        endpoint: input.appPushToken,
        contactId: contact.id,
        email: contact.email,
        phone: contact.phone,
        firstName: contact.first_name,
        lastName: contact.last_name,
        platform: input.appPushPlatform || "android",
        label: "contact_form",
      });
    } catch {
      /* token register is optional — do not fail contact save */
    }
  }
  if (input.webPushEndpoint && input.webPushP256dh && input.webPushAuth) {
    try {
      await registerWebPushSubscriptionDao(session, {
        endpoint: input.webPushEndpoint,
        keys: { p256dh: input.webPushP256dh, auth: input.webPushAuth },
        contactId: contact.id,
        email: contact.email,
        phone: contact.phone,
        firstName: contact.first_name,
        lastName: contact.last_name,
        platform: "browser",
        label: "contact_form",
      });
    } catch {
      /* subscription register is optional */
    }
  }
}

const listContactsQuery = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  search: z.string().trim().optional(),
});

export async function listContactsHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const parsed = listContactsQuery.safeParse(request.query);
  if (!parsed.success) {
    throw new AppError(
      parsed.error.issues[0]?.message ?? RESPONSE.bad_request,
    );
  }
  let result: Awaited<ReturnType<typeof listContactsDao>>;
  try {
    result = await listContactsDao(session, parsed.data);
  } catch (err) {
    request.log.error({ err }, "listContactsDao failed");
    const msg =
      err instanceof Error && /statement timeout|canceling statement/i.test(err.message)
        ? "Loading contacts timed out (contacts database query too slow). Try again or contact support."
        : "Unable to load audience (contacts database unavailable).";
    throw new AppError(msg, 503);
  }
  const { items, total, withChannel, page, limit } = result;
  const totalPages = total > 0 ? Math.ceil(total / limit) : 1;
  if (!items.length) {
    return sendSuccess(reply, RESPONSE.noContactFound, {
      getContactDetails: [],
      total,
      withChannel,
      page,
      limit,
      totalPages,
    });
  }
  // Audience summary panel only needs identity fields; engagement + push load on GET /:id.
  return sendSuccess(reply, RESPONSE.getContactSuccess, {
    getContactDetails: items,
    total,
    withChannel,
    page,
    limit,
    totalPages,
  });
}

export async function getContactHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const params = idParam.safeParse(request.params);
  if (!params.success) {
    throw new AppError(params.error.issues[0]?.message ?? RESPONSE.bad_request);
  }
  let contact: ContactRow | null;
  try {
    contact = await getContactByIdDao(session, params.data.id);
  } catch (err) {
    request.log.error({ err }, "getContactByIdDao failed");
    throw new AppError(
      "Unable to load contact (contacts database unavailable).",
      503,
    );
  }
  if (!contact) throw new AppError(RESPONSE.contactNotFound, 404);
  const [engaged] = await withCampaignEngagement(session.organizationId, [contact]);
  const [enriched] = await withPushChannels(session, [engaged]);
  return sendSuccess(reply, RESPONSE.getContactByIdSuccess, {
    contact: enriched,
  });
}

export async function lookupContactsHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const body = lookupBody.safeParse(request.body ?? {});
  if (!body.success) {
    throw new AppError(body.error.issues[0]?.message ?? RESPONSE.bad_request);
  }
  if (!body.data.email && !body.data.phone && !body.data.fullName) {
    throw new AppError("Provide email, phone, or fullName to look up.", 400);
  }
  const matches = await findContactsByIdentityDao(session, body.data);
  const engaged = await withCampaignEngagement(session.organizationId, matches);
  const enriched = await withPushChannels(session, engaged);
  return sendSuccess(reply, RESPONSE.contactLookupSuccess, {
    count: enriched.length,
    contacts: enriched,
  });
}

const importBody = z.object({
  dryRun: z.boolean().optional(),
  upsert: z.boolean().optional(),
  consentSource: z.string().trim().max(120).optional().nullable(),
  complianceAcknowledged: z.boolean().optional(),
  sourceLabel: z.string().trim().max(80).optional().nullable(),
  rows: z
    .array(
      z
        .object({
          firstName: z.string().optional().nullable(),
          lastName: z.string().optional().nullable(),
          email: z.string().optional().nullable(),
          phone: z.string().optional().nullable(),
          companyName: z.string().optional().nullable(),
          city: z.string().optional().nullable(),
          name: z.string().optional().nullable(),
          customFields: z.record(z.unknown()).optional().nullable(),
        })
        .passthrough(),
    )
    .min(1)
    .max(2000),
});

/** CCUIA bulk CSV/JSON ingest. */
export async function importContactsHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const parsed = importBody.safeParse(request.body ?? {});
  if (!parsed.success) {
    throw new AppError(
      parsed.error.issues[0]?.message ?? "Invalid import payload.",
    );
  }
  const result = await importContactsDao(session, parsed.data.rows, {
    dryRun: parsed.data.dryRun,
    upsert: parsed.data.upsert,
    consentSource: parsed.data.consentSource,
    complianceAcknowledged: parsed.data.complianceAcknowledged,
    sourceLabel: parsed.data.sourceLabel,
  });
  const message =
    result.status === "held_for_review"
      ? RESPONSE.contactImportHeld
      : RESPONSE.contactImportSuccess;
  return sendSuccess(reply, message, { import: result });
}

export async function listFilterableFieldsHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const fields = await listFilterableFieldsDao(session);
  return sendSuccess(reply, RESPONSE.filterableFieldsSuccess, { fields });
}

export async function audienceSegmentationSummaryHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const summary = await audienceSegmentationSummaryDao(session);
  return sendSuccess(reply, RESPONSE.audienceSummarySuccess, { summary });
}

export async function filterContactsHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const parsed = contactFilterBodySchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    throw new AppError(
      parsed.error.issues[0]?.message ?? RESPONSE.bad_request,
    );
  }
  const filters = (parsed.data.filters ?? {}) as ContactFilterInput;
  const result = await filterContactsDao(session, filters);
  return sendSuccess(reply, RESPONSE.filterContactSuccess, {
    count: result.count,
    contact_ids: result.contact_ids,
    sample: result.sample,
    filters,
    emails_requested: result.emails_requested,
    emails_matched: result.emails_matched,
    emails_missing: result.emails_missing,
    phones_requested: result.phones_requested,
    phones_matched: result.phones_matched,
    phones_missing: result.phones_missing,
    consent: result.consent,
    quality: result.quality,
  });
}

const insightsBody = z.object({
  contact_ids: z.array(zContactId).max(5000),
});

/** Soft CPMA + ASA insights for frozen audience IDs (never blocks). */
export async function audienceInsightsHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const parsed = insightsBody.safeParse(request.body ?? {});
  if (!parsed.success) {
    throw new AppError(
      parsed.error.issues[0]?.message ?? RESPONSE.bad_request,
    );
  }
  const result = await audienceInsightsDao(session, parsed.data.contact_ids);
  return sendSuccess(reply, "Audience insights", {
    count: result.count,
    consent: result.consent,
    quality: result.quality,
    sample: result.sample,
  });
}

/**
 * Sample per-recipient merge maps (+ optional rendered template) for the
 * create-campaign dynamic send agent. Uses PERSONALIZATION_ADAPTER.
 */
export async function personalizationPreviewHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const parsed = personalizationPreviewBodySchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    throw new AppError(
      parsed.error.issues[0]?.message ?? RESPONSE.bad_request,
    );
  }

  const sampleSize = parsed.data.sample_size ?? 5;
  const dynamicOffer = parsed.data.dynamic_offer !== false;
  const defaultCampaignUrl =
    parsed.data.default_campaign_url?.trim() || env.appUrl;
  const adapterName = getPersonalizationAdapterName();

  let contactIds = (parsed.data.contact_ids || [])
    .map((id) => String(id || "").trim())
    .filter(Boolean)
    .slice(0, sampleSize);

  // No ids → sample fixture catalog (agent demos without a live audience).
  if (!contactIds.length) {
    contactIds = listFixtureRecipients()
      .map((r) => r.contact_id)
      .slice(0, sampleSize);
  }

  const identityById = new Map<
    string,
    {
      email?: string;
      phone?: string;
      firstName?: string;
      lastName?: string;
      company?: string;
      city?: string;
    }
  >();

  // Prefer CRM identity when ids look like UUIDs / exist in tenant.
  try {
    const rows = await listContactFirstNamesByIdsDao(session, contactIds);
    for (const row of rows) {
      identityById.set(row.contactId, {
        firstName: row.firstName || "",
        company: row.company || "",
        city: row.city || "",
      });
    }
  } catch {
    // Fixture-only ids are fine without CRM.
  }

  // Enrich fixture identity when CRM miss.
  for (const fix of listFixtureRecipients()) {
    if (!contactIds.includes(fix.contact_id)) continue;
    if (identityById.has(fix.contact_id)) continue;
    identityById.set(fix.contact_id, {
      email: fix.identity.email,
      phone: fix.identity.phone,
      firstName: fix.identity.first_name,
      lastName: fix.identity.last_name,
      company: fix.identity.company,
      city: fix.identity.city,
    });
  }

  const mergeMaps = await buildMergeMapsForContacts(contactIds, identityById, {
    dynamicOffer,
    defaultCampaignUrl,
  });

  const tpl = parsed.data.template || {};
  const samples = contactIds.map((contactId) => {
    const merge_map = mergeMaps.get(contactId) || {
      first_name: "there",
      campaign_url: defaultCampaignUrl,
    };
    const rendered: Record<string, string> = {};
    if (tpl.subject || tpl.html || tpl.text) {
      const email = personalizeEmailContent(
        {
          subject: String(tpl.subject || ""),
          html: String(tpl.html || ""),
          text: String(tpl.text || ""),
        },
        merge_map,
      );
      rendered.subject = email.subject;
      rendered.html = email.html;
      rendered.text = email.text;
    }
    if (tpl.title || tpl.body) {
      const push = personalizePushContent(
        {
          title: String(tpl.title || ""),
          body: String(tpl.body || ""),
        },
        merge_map,
      );
      rendered.title = push.title;
      rendered.body = push.body;
    }
    // Single-string body preview (WhatsApp / SMS style).
    if (tpl.body && !rendered.body) {
      rendered.body = replaceMergeTags(String(tpl.body), merge_map);
    }
    return {
      contact_id: contactId,
      identity: identityById.get(contactId) || null,
      merge_map,
      product_name: merge_map.product_name || null,
      product_url: merge_map.product_url || null,
      product_id: merge_map.product_id || null,
      campaign_url: merge_map.campaign_url || null,
      rendered: Object.keys(rendered).length ? rendered : null,
    };
  });

  // Distinct products across sample — useful for agent chat summaries.
  const distinctProducts = [
    ...new Set(
      samples
        .map((s) => s.product_name)
        .filter((n): n is string => Boolean(n && n.trim())),
    ),
  ];

  return sendSuccess(reply, RESPONSE.personalizationPreviewSuccess, {
    adapter: adapterName,
    dynamic_offer: dynamicOffer,
    sample_count: samples.length,
    distinct_product_count: distinctProducts.length,
    distinct_products: distinctProducts,
    samples,
    available_tags: [
      "first_name",
      "company",
      "city",
      "job_title",
      "campaign_url",
      "product_name",
      "product_url",
      "product_image",
      "product_price",
      "product_id",
    ],
  });
}

export async function createContactHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const input = parseContactBody(request.body);
  const {
    appPushToken,
    appPushPlatform,
    webPushEndpoint,
    webPushP256dh,
    webPushAuth,
    ...identity
  } = input;
  const contact = await createContactDao(session, identity);
  // Soft-learn volunteered extras into company pack as *suggested* (confirm later).
  if (identity.customFields && typeof identity.customFields === "object") {
    try {
      await learnPackFieldsDao(
        session,
        identity.customFields as Record<string, unknown>,
      );
    } catch {
      /* best-effort — never block create */
    }
  }
  await registerContactPushIfProvided(session, contact, {
    appPushToken,
    appPushPlatform,
    webPushEndpoint,
    webPushP256dh,
    webPushAuth,
  });
  const [enriched] = await withPushChannels(session, [
    { ...contact, campaign_engagement: null },
  ]);
  return sendSuccess(reply, RESPONSE.insertContact, {
    contact: enriched,
  });
}

export async function updateContactHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const params = idParam.safeParse(request.params);
  if (!params.success) {
    throw new AppError(params.error.issues[0]?.message ?? RESPONSE.bad_request);
  }
  const input = parseContactBody(request.body);
  const {
    appPushToken,
    appPushPlatform,
    webPushEndpoint,
    webPushP256dh,
    webPushAuth,
    ...identity
  } = input;
  const contact = await updateContactDao(session, params.data.id, identity);
  await registerContactPushIfProvided(session, contact, {
    appPushToken,
    appPushPlatform,
    webPushEndpoint,
    webPushP256dh,
    webPushAuth,
  });
  const [engaged] = await withCampaignEngagement(session.organizationId, [contact]);
  const [enriched] = await withPushChannels(session, [engaged]);
  return sendSuccess(reply, RESPONSE.updateContact, { contact: enriched });
}

export async function updateContactPreferencesHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const params = idParam.safeParse(request.params);
  if (!params.success) {
    throw new AppError(params.error.issues[0]?.message ?? RESPONSE.bad_request);
  }
  const body = (request.body || {}) as Record<string, unknown>;
  const raw =
    body.preferences_json ??
    body.preferencesJson ??
    body.preferences ??
    body;
  const prefs = normalizePreferencesJson(raw);
  const contact = await setContactPreferencesDao(
    session,
    params.data.id,
    prefs,
  );
  const [engaged] = await withCampaignEngagement(session.organizationId, [
    contact,
  ]);
  const [enriched] = await withPushChannels(session, [engaged]);
  return sendSuccess(reply, RESPONSE.updateContactPreferences, {
    contact: enriched,
  });
}

export async function refreshContactPreferencesHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const params = idParam.safeParse(request.params);
  if (!params.success) {
    throw new AppError(params.error.issues[0]?.message ?? RESPONSE.bad_request);
  }
  const contact = await refreshContactPreferencesFromEngagementDao(
    session,
    params.data.id,
  );
  const [engaged] = await withCampaignEngagement(session.organizationId, [
    contact,
  ]);
  const [enriched] = await withPushChannels(session, [engaged]);
  return sendSuccess(reply, RESPONSE.refreshContactPreferences, {
    contact: enriched,
  });
}

export async function getContactCampaignActivityHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const params = idParam.safeParse(request.params);
  if (!params.success) {
    throw new AppError(params.error.issues[0]?.message ?? RESPONSE.bad_request);
  }
  const query = (request.query || {}) as Record<string, unknown>;
  const pastPage = Number(query.past_page ?? query.pastPage ?? 1);
  const pastLimit = Number(query.past_limit ?? query.pastLimit ?? 20);
  const activity = await getContactCampaignActivityDao(
    session,
    params.data.id,
    {
      pastPage: Number.isFinite(pastPage) ? pastPage : 1,
      pastLimit: Number.isFinite(pastLimit) ? pastLimit : 20,
    },
  );
  return sendSuccess(reply, RESPONSE.contactCampaignActivitySuccess, {
    campaign_activity: activity,
  });
}

export async function deleteContactHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const params = idParam.safeParse(request.params);
  if (!params.success) {
    throw new AppError(params.error.issues[0]?.message ?? RESPONSE.bad_request);
  }
  await deleteContactDao(session, params.data.id);
  return sendSuccess(reply, RESPONSE.deleteContact, { id: params.data.id });
}
