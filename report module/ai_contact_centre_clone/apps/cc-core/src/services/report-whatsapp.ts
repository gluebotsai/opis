import { createHmac, timingSafeEqual } from "node:crypto";

import type { PrismaClient } from "@ai-contact-center/db-cc";

import { serializeEntityId, serializeEntityIdOptional, toDbId } from "../lib/id-schema.js";
import type { DbClient } from "../lib/rls.js";
import { withOrganizationContext } from "../lib/rls.js";
import { normalizePhone } from "./contact-identity.js";

export const SCHEDULED_REPORT_PDF_TEMPLATE = "scheduled_report_pdf_v1";
export const REPORT_PDF_TOKEN_TTL_SECONDS = 2 * 60 * 60;

const SOCIAL_SERVICE_URL = process.env.SOCIAL_SERVICE_URL ?? "http://localhost:3004";
const INTERNAL_SERVICE_KEY = process.env.INTERNAL_SERVICE_KEY;
const SOCIAL_FETCH_TIMEOUT_MS = Number(process.env.SOCIAL_FETCH_TIMEOUT_MS ?? 8_000);

export type ScheduledReportWhatsAppResult =
  | { sent: true; to: string }
  | { sent: false; reason: string };

export type SendScheduledReportWhatsAppInput = {
  organizationId: string;
  createdByUserId: string;
  runId: string;
  scheduleName: string;
  periodLabel: string;
  fileName?: string;
};

export function isApprovedWhatsAppTemplateStatus(status: string | null | undefined): boolean {
  return status?.trim().toLowerCase() === "approved";
}

export function toWhatsAppRecipient(phone: string | null | undefined): string | null {
  const digits = normalizePhone(phone);
  if (!digits) return null;
  if (digits.length === 10) return `91${digits}`;
  return digits;
}

export function isMetaFetchableHttpsUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    if (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1" ||
      host.endsWith(".local") ||
      host.endsWith(".internal")
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function reportPdfTokenSecret(): string | null {
  return process.env.JWT_SECRET?.trim() || process.env.INTERNAL_SERVICE_KEY?.trim() || null;
}

export function reportPdfPublicBaseUrl(
  override = process.env.CC_CORE_PUBLIC_URL,
): string | null {
  const origin = override?.trim().replace(/\/$/, "");
  return origin || null;
}

export function buildScheduledReportPdfPublicUrl(
  runId: string,
  token: string,
  publicBase = process.env.CC_CORE_PUBLIC_URL,
): string | null {
  const origin = reportPdfPublicBaseUrl(publicBase);
  if (!origin) return null;
  const apiRoot = origin.endsWith("/api/v1") ? origin : `${origin}/api/v1`;
  return `${apiRoot}/public/reports/runs/${encodeURIComponent(runId)}/pdf?token=${encodeURIComponent(token)}`;
}

export function signReportPdfToken(
  input: { organizationId: string; runId: string },
  secret: string,
  nowMs = Date.now(),
): string {
  const exp = Math.floor(nowMs / 1000) + REPORT_PDF_TOKEN_TTL_SECONDS;
  const payload = `${input.organizationId}.${input.runId}.${exp}`;
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${input.organizationId}.${exp}.${signature}`;
}

export function verifyReportPdfToken(
  token: string,
  input: { runId: string },
  secret: string,
  nowMs = Date.now(),
): { organizationId: string } | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [organizationId, expRaw, signature] = parts as [string, string, string];
  if (!organizationId || !expRaw || !signature) return null;
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp < Math.floor(nowMs / 1000)) return null;

  const expected = createHmac("sha256", secret)
    .update(`${organizationId}.${input.runId}.${exp}`)
    .digest("base64url");
  const actualBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expected);
  if (actualBuf.length !== expectedBuf.length || !timingSafeEqual(actualBuf, expectedBuf)) {
    return null;
  }
  return { organizationId };
}

export function buildReportWhatsAppTemplateComponents(
  pdfUrl: string,
  scheduleName: string,
  periodLabel: string,
): Array<{
  type: "header" | "body";
  parameters: Array<
    | { type: "document"; document: { link: string } }
    | { type: "text"; text: string }
  >;
}> {
  return [
    {
      type: "header",
      parameters: [{ type: "document", document: { link: pdfUrl } }],
    },
    {
      type: "body",
      parameters: [
        { type: "text", text: scheduleName.trim() || "Scheduled report" },
        { type: "text", text: periodLabel.trim() || "this period" },
      ],
    },
  ];
}

async function resolveWhatsAppChannelConfigId(
  db: DbClient,
  organizationId: string,
): Promise<string | null> {
  const rows = await db.$queryRaw<{ channel_config_id: string | bigint }[]>`
    SELECT sc.channel_config_id
    FROM accounts.setup_social_configs sc
    JOIN accounts.setup_channel_configs cc ON cc.id = sc.channel_config_id
    WHERE cc.organization_id = ${organizationId}::bigint
      AND sc.provider = 'whatsapp'
      AND cc.status = 'active'
    ORDER BY sc.updated_at DESC
    LIMIT 1
  `;
  return serializeEntityIdOptional(rows[0]?.channel_config_id) ?? null;
}

async function findApprovedReportPdfTemplate(
  db: DbClient,
  channelConfigId: string,
): Promise<{ templateName: string; language: string } | null> {
  const rows = await db.$queryRaw<
    Array<{ template_name: string; language: string; status: string }>
  >`
    SELECT template_name, language, status
    FROM accounts.whatsapp_template_submissions
    WHERE channel_config_id = ${channelConfigId}::bigint
      AND template_name = ${SCHEDULED_REPORT_PDF_TEMPLATE}
    ORDER BY updated_at DESC
    LIMIT 1
  `;
  const row = rows[0];
  if (!row || !isApprovedWhatsAppTemplateStatus(row.status)) return null;
  return {
    templateName: row.template_name,
    language: row.language?.trim() || "en",
  };
}

async function resolveAdminRecipientPhone(
  db: DbClient,
  organizationId: string,
  userId: string,
): Promise<string | null> {
  const user = await db.setup_users.findFirst({
    where: { id: toDbId(userId), organization_id: toDbId(organizationId) },
    select: { mobile_number: true },
  });
  const fromUser = toWhatsAppRecipient(user?.mobile_number);
  if (fromUser) return fromUser;

  const org = await db.organizations.findFirst({
    where: { id: toDbId(organizationId) },
    select: { mobile_country_code: true, mobile_number: true },
  });
  const combined = [org?.mobile_country_code, org?.mobile_number].filter(Boolean).join("");
  return toWhatsAppRecipient(combined);
}

type PreparedWhatsAppSend = {
  channelConfigId: string;
  to: string;
  languageCode: string;
  pdfUrl: string;
};

async function prepareScheduledReportWhatsApp(
  db: DbClient,
  input: SendScheduledReportWhatsAppInput,
  options: {
    nowMs: number;
    publicBaseUrl: string | null;
    tokenSecret: string | null;
  },
): Promise<{ ok: true; prepared: PreparedWhatsAppSend } | { ok: false; reason: string }> {
  const channelConfigId = await resolveWhatsAppChannelConfigId(db, input.organizationId);
  if (!channelConfigId) {
    return { ok: false, reason: "whatsapp_channel_missing" };
  }

  let template: { templateName: string; language: string } | null;
  try {
    template = await findApprovedReportPdfTemplate(db, channelConfigId);
  } catch {
    return { ok: false, reason: "template_lookup_failed" };
  }
  if (!template) {
    return { ok: false, reason: "template_not_approved" };
  }

  const to = await resolveAdminRecipientPhone(db, input.organizationId, input.createdByUserId);
  if (!to) {
    return { ok: false, reason: "no_recipient_phone" };
  }

  if (!options.tokenSecret) {
    return { ok: false, reason: "pdf_token_secret_missing" };
  }
  const token = signReportPdfToken(
    { organizationId: input.organizationId, runId: input.runId },
    options.tokenSecret,
    options.nowMs,
  );
  const pdfUrl = buildScheduledReportPdfPublicUrl(input.runId, token, options.publicBaseUrl ?? undefined);
  if (!pdfUrl || !isMetaFetchableHttpsUrl(pdfUrl)) {
    return { ok: false, reason: "pdf_url_not_public_https" };
  }

  return {
    ok: true,
    prepared: {
      channelConfigId,
      to,
      languageCode: template.language,
      pdfUrl,
    },
  };
}

async function postWhatsAppTemplate(input: {
  organizationId: string;
  channelConfigId: string;
  to: string;
  languageCode: string;
  scheduleName: string;
  periodLabel: string;
  pdfUrl: string;
}): Promise<ScheduledReportWhatsAppResult> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "x-tenant-id": input.organizationId,
  };
  if (INTERNAL_SERVICE_KEY) {
    headers["x-internal-service-key"] = INTERNAL_SERVICE_KEY;
  }

  const response = await fetch(`${SOCIAL_SERVICE_URL}/internal/v1/whatsapp/templates`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      channelConfigId: input.channelConfigId,
      to: input.to,
      templateName: SCHEDULED_REPORT_PDF_TEMPLATE,
      languageCode: input.languageCode,
      components: buildReportWhatsAppTemplateComponents(
        input.pdfUrl,
        input.scheduleName,
        input.periodLabel,
      ),
    }),
    signal: AbortSignal.timeout(SOCIAL_FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    return { sent: false, reason: `whatsapp_send_failed_${response.status}` };
  }
  return { sent: true, to: input.to };
}

export async function sendScheduledReportWhatsApp(
  prisma: PrismaClient,
  input: SendScheduledReportWhatsAppInput,
): Promise<ScheduledReportWhatsAppResult> {
  let prepared: Awaited<ReturnType<typeof prepareScheduledReportWhatsApp>>;
  try {
    prepared = await withOrganizationContext(prisma, input.organizationId, async (db) =>
      prepareScheduledReportWhatsApp(db, input, {
        nowMs: Date.now(),
        publicBaseUrl: process.env.CC_CORE_PUBLIC_URL ?? null,
        tokenSecret: reportPdfTokenSecret(),
      }),
    );
  } catch {
    return { sent: false, reason: "whatsapp_prepare_failed" };
  }

  if (!prepared.ok) {
    return { sent: false, reason: prepared.reason };
  }

  try {
    return await postWhatsAppTemplate({
      organizationId: serializeEntityId(input.organizationId),
      channelConfigId: prepared.prepared.channelConfigId,
      to: prepared.prepared.to,
      languageCode: prepared.prepared.languageCode,
      scheduleName: input.scheduleName,
      periodLabel: input.periodLabel,
      pdfUrl: prepared.prepared.pdfUrl,
    });
  } catch {
    return { sent: false, reason: "whatsapp_send_failed" };
  }
}
