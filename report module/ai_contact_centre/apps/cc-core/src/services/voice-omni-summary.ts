import type { PrismaClient } from "@ai-contact-center/db-cc";

import { serializeEntityId } from "../lib/id-schema.js";
import type { DbClient } from "../lib/rls.js";
import { withOrganizationContext } from "../lib/rls.js";
import { linkConversationToContact } from "./contact-identity.js";
import { resolveCanonicalContactId } from "./contact-merge.js";
import { findCdpIdByMatchingPhone } from "./cdp-customer-profile.js";
import {
  getContactOmniChannelSummary,
  refreshOmniChannelSummary,
} from "./omni-channel-summary.js";
import {
  extractCallSessionKey,
  matchCallSessionIds,
} from "./umn-call-transcript.js";

const SESSION_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class VoiceOmniSummaryError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type VoiceCallRow = {
  id: string;
  contact_id: string | null;
  visitor_id: string | null;
  external_thread_id: string | null;
  provider_thread_id: string | null;
};

export function voiceSessionUuid(sessionId: string): string {
  const key = extractCallSessionKey(sessionId);
  return SESSION_UUID.test(key) ? key : "";
}

const PHONE_MATCH_MIN_DIGITS = 10;
const COUNTRY_CODE_MAX_DIGITS = 3;

/** Digits, a leading 00 removed, plus the national form when a trunk 0 is present. */
export function subscriberPhoneForms(value: string | null | undefined): string[] {
  let digits = String(value ?? "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (!digits) return [];
  const forms = [digits];
  if (digits.startsWith("0") && digits.length > 1) forms.push(digits.slice(1));
  return forms;
}

/** Same subscriber when either number has or lacks a 1–3 digit country code, +, 00, or a trunk 0. */
export function subscriberPhonesMatch(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  const leftForms = subscriberPhoneForms(left);
  const rightForms = subscriberPhoneForms(right);
  for (const first of leftForms) {
    for (const second of rightForms) {
      if (first === second) return true;
      const [shorter, longer] = first.length <= second.length ? [first, second] : [second, first];
      if (shorter.length < PHONE_MATCH_MIN_DIGITS || !longer.endsWith(shorter)) continue;
      const prefixLength = longer.length - shorter.length;
      if (prefixLength >= 1 && prefixLength <= COUNTRY_CODE_MAX_DIGITS) return true;
    }
  }
  return false;
}

/** An empty caller id can be linked. A stored caller id must be the same subscriber. */
export function voiceCallMatchesMobile(
  visitorId: string | null | undefined,
  mobile: string,
): boolean {
  const visitor = visitorId?.trim() ?? "";
  if (!visitor) return true;
  return subscriberPhonesMatch(visitor, mobile);
}

async function findContactIdByMobile(
  db: DbClient,
  organizationId: string,
  mobile: string,
): Promise<string | null> {
  const matched = await findCdpIdByMatchingPhone(db, organizationId, mobile);
  if (matched) return matched;

  const rows = await db.$queryRaw<Array<{ cdp_id: string }>>`
    SELECT ik.cdp_id
    FROM cdp.identity_keys ik
    LEFT JOIN cdp.customer_profile cp
      ON cp.cdp_id = ik.cdp_id
     AND cp.organization_id = ik.organization_id
    WHERE ik.organization_id = ${organizationId}::bigint
      AND ik.key_type IN ('phone', 'phone_secondary', 'whatsapp_phone')
      AND cdp.identity_phone_matches(ik.key_value, ${mobile})
    ORDER BY
      CASE
        WHEN NULLIF(btrim(COALESCE(cp.first_name, '')), '') IS NOT NULL THEN 0
        ELSE 1
      END,
      cp.updated_at DESC NULLS LAST
    LIMIT 1
  `;
  return rows[0]?.cdp_id ?? null;
}

export function selectVoiceConversation<T extends VoiceCallRow>(
  rows: T[],
  sessionId: string,
): T | null {
  const trimmed = sessionId.trim();
  return (
    rows.find(
      (row) =>
        row.external_thread_id === trimmed ||
        row.provider_thread_id === trimmed ||
        matchCallSessionIds(trimmed, row.external_thread_id || "") ||
        matchCallSessionIds(trimmed, row.provider_thread_id || ""),
    ) ?? null
  );
}

async function findVoiceCall(
  db: DbClient,
  organizationId: string,
  sessionId: string,
): Promise<VoiceCallRow | null> {
  const uuid = voiceSessionUuid(sessionId);
  const rows = await db.$queryRaw<VoiceCallRow[]>`
    SELECT
      id::text AS id,
      contact_id,
      visitor_id,
      external_thread_id,
      provider_thread_id
    FROM ccass.conversations
    WHERE organization_id = ${organizationId}::bigint
      AND channel IN ('call', 'voice', 'phone')
      AND created_at >= NOW() - INTERVAL '24 hours'
      AND (
        external_thread_id = ${sessionId}
        OR provider_thread_id = ${sessionId}
        OR (
          ${uuid} <> ''
          AND (
            external_thread_id LIKE ${`%${uuid}`}
            OR provider_thread_id LIKE ${`%${uuid}`}
          )
        )
      )
    ORDER BY updated_at DESC
    LIMIT 5
  `;
  return selectVoiceConversation(rows, sessionId);
}

export async function refreshVoicebotOmniChannelSummary(
  prisma: PrismaClient,
  input: { organizationId: string; mobile: string; sessionId: string },
): Promise<{
  contactId: string;
  conversationId: string;
  omniChannelSummary: string | null;
  updatedAt: string | null;
}> {
  const organizationId = input.organizationId.trim();
  const mobile = input.mobile.trim();
  const sessionId = input.sessionId.trim();

  const linked = await withOrganizationContext(prisma, organizationId, async (db) => {
    const foundContactId = await findContactIdByMobile(db, organizationId, mobile);
    if (!foundContactId) {
      throw new VoiceOmniSummaryError(404, "Contact not found");
    }
    const contactId = await resolveCanonicalContactId(db, organizationId, foundContactId);
    const call = await findVoiceCall(db, organizationId, sessionId);
    if (!call) {
      throw new VoiceOmniSummaryError(404, "Call not found");
    }
    if (!voiceCallMatchesMobile(call.visitor_id, mobile)) {
      throw new VoiceOmniSummaryError(409, "Call number does not match this mobile");
    }
    const existingContactId = call.contact_id?.trim() || "";
    if (existingContactId) {
      const canonicalExisting = await resolveCanonicalContactId(
        db,
        organizationId,
        existingContactId,
      );
      if (canonicalExisting !== contactId) {
        throw new VoiceOmniSummaryError(409, "Call is already linked to another contact");
      }
    } else {
      await linkConversationToContact(db, organizationId, call.id, contactId);
    }
    return {
      contactId,
      conversationId: serializeEntityId(call.id),
    };
  });

  try {
    await refreshOmniChannelSummary(organizationId, linked.contactId);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new VoiceOmniSummaryError(502, detail);
  }

  const stored = await withOrganizationContext(prisma, organizationId, (db) =>
    getContactOmniChannelSummary(db, organizationId, linked.contactId),
  );
  return {
    contactId: linked.contactId,
    conversationId: linked.conversationId,
    omniChannelSummary: stored.omniChannelSummary,
    updatedAt: stored.updatedAt,
  };
}
