import { Prisma } from "@ai-contact-center/db-cc";

import type { DbClient } from "../lib/rls.js";

export type VoiceRecording = {
  id: string;
  startedAt: string;
  direction: "inbound" | "outbound";
  customerName: string;
  customerNumber: string;
  agentName: string | null;
  agentExt: string | null;
  queueName: string | null;
  recordingDurationMs: number;
  recordingUrl: string;
};

type VoiceRecordingRow = {
  id: bigint | number | string;
  session_start_time: bigint | number | string | null;
  created_at: Date | string;
  is_inbound: number | boolean | null;
  customer_number: string | null;
  agent_ext: string | null;
  agent_name: string | null;
  queue_name: string | null;
  customer_name: string | null;
  recording_duration: bigint | number | string | null;
  recording_url: string | null;
};

function asText(value: bigint | number | string | null | undefined): string {
  if (value == null) return "";
  return String(value).trim();
}

function asMs(value: bigint | number | string | null | undefined): number {
  const n = Number(asText(value) || 0);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

/** A recording row is listable only when UMN stored an http(s) file URL. */
export function isPlayableRecordingUrl(url: string | null | undefined): boolean {
  const trimmed = url?.trim() ?? "";
  return trimmed.startsWith("https://") || trimmed.startsWith("http://");
}

function startedAtIso(epochMs: bigint | number | string | null, createdAt: Date | string): string {
  const n = asMs(epochMs);
  if (n > 1_000_000_000_000) return new Date(n).toISOString();
  const created = createdAt instanceof Date ? createdAt : new Date(createdAt);
  return Number.isNaN(created.getTime()) ? new Date(0).toISOString() : created.toISOString();
}

function displayName(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

/** Inbound customer is the caller. Outbound uses the dialed phone, unless that value is the agent extension. */
export function recordingCustomerNumber(
  isInbound: number | boolean | null | undefined,
  customerNumber: string | null | undefined,
  calledNumber: string | null | undefined,
  agentExt?: string | null,
): string {
  const inbound = isInbound === true || Number(isInbound) === 1;
  const caller = customerNumber?.trim() ?? "";
  if (inbound) return caller;
  const calledDigits = (calledNumber ?? "").replace(/\D/g, "");
  const extDigits = (agentExt ?? "").replace(/\D/g, "");
  const calledIsExtension =
    calledDigits.length === 0 ||
    calledDigits === "0" ||
    calledDigits.length <= 6 ||
    (extDigits !== "" && extDigits !== "0" && calledDigits === extDigits);
  return calledIsExtension ? caller : calledNumber?.trim() ?? "";
}

export function mapVoiceRecordingRow(row: VoiceRecordingRow): VoiceRecording | null {
  if (!isPlayableRecordingUrl(row.recording_url)) return null;
  const customerNumber = asText(row.customer_number);
  const agentExt = asText(row.agent_ext);
  const handledExt = agentExt && agentExt !== "0" ? agentExt : null;
  return {
    id: asText(row.id),
    startedAt: startedAtIso(row.session_start_time, row.created_at),
    direction: Number(row.is_inbound) === 1 ? "inbound" : "outbound",
    customerName: displayName(row.customer_name) ?? customerNumber,
    customerNumber,
    agentName: displayName(row.agent_name),
    agentExt: handledExt,
    queueName: displayName(row.queue_name),
    recordingDurationMs: asMs(row.recording_duration),
    recordingUrl: row.recording_url!.trim(),
  };
}

export const VOICE_RECORDING_PAGE_SIZE = 10;
const VOICE_RECORDING_PAGE_MAX = 50;

export type VoiceRecordingListQuery = {
  limit?: number;
  offset?: number;
  search?: string;
  direction?: string;
  queue?: string;
  agent?: string;
  from?: string;
  to?: string;
};

export function voiceRecordingPage(limit?: number, offset?: number): {
  limit: number;
  offset: number;
} {
  const size = Number.isFinite(limit) ? Math.trunc(limit as number) : VOICE_RECORDING_PAGE_SIZE;
  const start = Number.isFinite(offset) ? Math.trunc(offset as number) : 0;
  return {
    limit: Math.min(VOICE_RECORDING_PAGE_MAX, Math.max(1, size)),
    offset: Math.max(0, start),
  };
}

function parseRecordingInstant(value: string | undefined): Date | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return null;
  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function normalizeRecordingListQuery(input?: VoiceRecordingListQuery): {
  limit: number;
  offset: number;
  search: string;
  direction: "all" | "inbound" | "outbound";
  queue: string;
  agent: string;
  from: Date | null;
  to: Date | null;
} {
  const page = voiceRecordingPage(input?.limit, input?.offset);
  const direction =
    input?.direction === "inbound" || input?.direction === "outbound" ? input.direction : "all";
  return {
    ...page,
    search: input?.search?.trim() ?? "",
    direction,
    queue: input?.queue?.trim() || "all",
    agent: input?.agent?.trim() || "all",
    from: parseRecordingInstant(input?.from),
    to: parseRecordingInstant(input?.to),
  };
}

function likePattern(search: string): string | null {
  const cleaned = search.replace(/[%_\\]/g, "").trim();
  return cleaned ? `%${cleaned}%` : null;
}

function recordingStartedAtSql(): Prisma.Sql {
  return Prisma.sql`COALESCE(
    CASE
      WHEN c.session_start_time > 1000000000000
        THEN to_timestamp((c.session_start_time::double precision) / 1000.0)
      ELSE NULL
    END,
    c.created_at
  )`;
}

function recordingFilterSql(query: ReturnType<typeof normalizeRecordingListQuery>): Prisma.Sql {
  const parts: Prisma.Sql[] = [];
  const pattern = likePattern(query.search);
  if (pattern) {
    parts.push(Prisma.sql`AND (
      COALESCE(party.customer_number, '') ILIKE ${pattern}
      OR COALESCE(queue_match.name, '') ILIKE ${pattern}
      OR COALESCE(concat_ws(' ', su.first_name, su.last_name), '') ILIKE ${pattern}
      OR COALESCE(concat_ws(' ', customer_match.first_name, customer_match.last_name), '') ILIKE ${pattern}
    )`);
  }
  if (query.direction === "inbound") {
    parts.push(Prisma.sql`AND c.is_inbound = 1`);
  } else if (query.direction === "outbound") {
    parts.push(Prisma.sql`AND COALESCE(c.is_inbound, 0) = 0`);
  }
  if (query.queue !== "all") {
    parts.push(Prisma.sql`AND queue_match.name = ${query.queue}`);
  }
  if (query.agent !== "all") {
    parts.push(Prisma.sql`AND NULLIF(btrim(concat_ws(' ', su.first_name, su.last_name)), '') = ${query.agent}`);
  }
  if (query.from) {
    parts.push(Prisma.sql`AND ${recordingStartedAtSql()} >= ${query.from}`);
  }
  if (query.to) {
    parts.push(Prisma.sql`AND ${recordingStartedAtSql()} <= ${query.to}`);
  }
  return parts.length > 0 ? Prisma.join(parts, " ") : Prisma.empty;
}

export async function findVoiceRecordingUrl(
  db: DbClient,
  organizationId: string,
  recordingId: string,
): Promise<string | null> {
  if (!/^\d+$/.test(recordingId)) return null;
  const rows = await db.$queryRaw<{ recording_url: string | null }[]>`
    SELECT c.recording_url
    FROM ccass.call_cdr c
    WHERE c.domain_id = ${organizationId}::bigint
      AND c.id = ${recordingId}::bigint
    LIMIT 1
  `;
  const url = rows[0]?.recording_url?.trim() ?? "";
  return isPlayableRecordingUrl(url) ? url : null;
}

export async function listVoiceRecordings(
  db: DbClient,
  organizationId: string,
  pageInput?: VoiceRecordingListQuery,
): Promise<{ recordings: VoiceRecording[]; hasMore: boolean; queues: string[]; agents: string[] }> {
  const page = normalizeRecordingListQuery(pageInput);
  const filters = recordingFilterSql(page);
  const rows = await db.$queryRaw<VoiceRecordingRow[]>`
    SELECT
      c.id,
      c.session_start_time,
      c.created_at,
      c.is_inbound,
      party.customer_number,
      c.agent_ext,
      NULLIF(btrim(concat_ws(' ', su.first_name, su.last_name)), '') AS agent_name,
      queue_match.name AS queue_name,
      c.recording_duration,
      c.recording_url,
      NULLIF(btrim(concat_ws(' ', customer_match.first_name, customer_match.last_name)), '') AS customer_name
    FROM ccass.call_cdr c
    LEFT JOIN accounts.setup_users su
      ON su.organization_id = c.domain_id
     AND c.agent_ext ~ '^[1-9][0-9]*$'
     AND su.ext = c.agent_ext::integer
    LEFT JOIN LATERAL (
      SELECT q.name
      FROM ccass.queues q
      WHERE q.organization_id = c.domain_id
        AND c.queue_id IS NOT NULL
        AND (q.id = c.queue_id OR q.setup_queue_id = c.queue_id)
      ORDER BY CASE WHEN q.id = c.queue_id THEN 0 ELSE 1 END
      LIMIT 1
    ) queue_match ON TRUE
    LEFT JOIN LATERAL (
      SELECT CASE
        WHEN COALESCE(c.is_inbound, 0) = 1 THEN NULLIF(btrim(c.customer_number), '')
        WHEN length(regexp_replace(COALESCE(c.called_number, ''), '\\D', '', 'g')) >= 7
          AND regexp_replace(COALESCE(c.called_number, ''), '\\D', '', 'g')
            IS DISTINCT FROM NULLIF(regexp_replace(COALESCE(c.agent_ext, ''), '\\D', '', 'g'), '0')
          THEN NULLIF(btrim(c.called_number), '')
        ELSE NULLIF(btrim(c.customer_number), '')
      END AS customer_number
    ) party ON TRUE
    LEFT JOIN LATERAL (
      SELECT cp.first_name, cp.last_name
      FROM cdp.identity_keys ik
      JOIN cdp.customer_profile cp
        ON cp.cdp_id = ik.cdp_id
       AND cp.organization_id = ik.organization_id
      WHERE ik.organization_id = c.domain_id
        AND ik.key_type IN ('phone', 'phone_secondary', 'whatsapp_phone')
        AND regexp_replace(COALESCE(party.customer_number, ''), '\\D', '', 'g') <> ''
        AND regexp_replace(ik.key_value, '\\D', '', 'g') <> ''
        AND (
          regexp_replace(ik.key_value, '\\D', '', 'g')
            = regexp_replace(party.customer_number, '\\D', '', 'g')
          OR (
            length(regexp_replace(party.customer_number, '\\D', '', 'g')) >= 10
            AND length(regexp_replace(ik.key_value, '\\D', '', 'g')) >= 10
            AND (
              regexp_replace(ik.key_value, '\\D', '', 'g')
                LIKE '%' || regexp_replace(party.customer_number, '\\D', '', 'g')
              OR regexp_replace(party.customer_number, '\\D', '', 'g')
                LIKE '%' || regexp_replace(ik.key_value, '\\D', '', 'g')
            )
          )
        )
      ORDER BY
        CASE
          WHEN NULLIF(btrim(COALESCE(cp.first_name, '')), '') IS NOT NULL THEN 0
          ELSE 1
        END,
        length(regexp_replace(ik.key_value, '\\D', '', 'g')) DESC
      LIMIT 1
    ) customer_match ON TRUE
    WHERE c.domain_id = ${organizationId}::bigint
      AND c.recording_url IS NOT NULL
      AND btrim(c.recording_url) <> ''
      AND c.recording_url ILIKE 'http%'
      ${filters}
    ORDER BY c.session_start_time DESC NULLS LAST, c.created_at DESC
    LIMIT ${page.limit + 1}
    OFFSET ${page.offset}
  `;

  const recordings = rows.flatMap((row) => {
    const mapped = mapVoiceRecordingRow(row);
    return mapped ? [mapped] : [];
  });
  const facets = await db.$queryRaw<{ queue_name: string | null; agent_name: string | null }[]>`
    SELECT DISTINCT
      NULLIF(btrim(queue_match.name), '') AS queue_name,
      NULLIF(btrim(concat_ws(' ', su.first_name, su.last_name)), '') AS agent_name
    FROM ccass.call_cdr c
    LEFT JOIN accounts.setup_users su
      ON su.organization_id = c.domain_id
     AND c.agent_ext ~ '^[1-9][0-9]*$'
     AND su.ext = c.agent_ext::integer
    LEFT JOIN LATERAL (
      SELECT q.name
      FROM ccass.queues q
      WHERE q.organization_id = c.domain_id
        AND c.queue_id IS NOT NULL
        AND (q.id = c.queue_id OR q.setup_queue_id = c.queue_id)
      ORDER BY CASE WHEN q.id = c.queue_id THEN 0 ELSE 1 END
      LIMIT 1
    ) queue_match ON TRUE
    WHERE c.domain_id = ${organizationId}::bigint
      AND c.recording_url IS NOT NULL
      AND btrim(c.recording_url) <> ''
      AND c.recording_url ILIKE 'http%'
  `;
  const queues = [...new Set(facets.flatMap((row) => (row.queue_name ? [row.queue_name] : [])))].sort(
    (left, right) => left.localeCompare(right),
  );
  const agents = [...new Set(facets.flatMap((row) => (row.agent_name ? [row.agent_name] : [])))].sort(
    (left, right) => left.localeCompare(right),
  );
  return {
    recordings: recordings.slice(0, page.limit),
    hasMore: recordings.length > page.limit,
    queues,
    agents,
  };
}
