/**
 * Disposition agent sweep. Reads one email, call, meeting, or message and
 * stores the outcome word on that activity. Does not change lead status.
 */
import { createHash } from "node:crypto";
import type { ActivityType } from "@prisma/client";
import { prisma } from "@/dao/db/prisma";
import { htmlToPlainText } from "@/lib/email-body";
import {
  AI_SERVICE_JOB_TIMEOUT_MS,
  callAiServiceAgent,
} from "@/service/ai/ai-service-client";

const TOUCH_TYPES: ActivityType[] = ["email", "call", "meeting", "sms"];
const BATCH = 4;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function plain(value: string | null | undefined): string {
  const raw = (value ?? "").trim();
  if (!raw || raw.startsWith("WT_NOTE_V1:")) return "";
  const text = raw.includes("<") ? htmlToPlainText(raw) : raw;
  return text.replace(/\s+/g, " ").trim();
}

function engagementText(row: {
  type: ActivityType;
  body: string | null;
  transcriptText: string | null;
}): string {
  const transcript = plain(row.transcriptText);
  const body = plain(row.body);
  if (row.type === "call" || row.type === "meeting") {
    return transcript || body;
  }
  return body || transcript;
}

function textHash(channel: string, text: string): string {
  return createHash("sha1").update(`${channel}\n${text}`).digest("hex");
}

async function contactSweepHeld(
  organizationId: string,
  contactId: string,
): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<Array<{ held: boolean }>>(
    `
    SELECT EXISTS (
      SELECT 1 FROM lead_nurture_jobs
      WHERE organization_id = $1::bigint
        AND contact_id = $2::text
        AND next_retry_at > NOW() + INTERVAL '1 year'
    ) AS held
    `,
    organizationId,
    contactId,
  );
  return rows[0]?.held === true;
}

export async function processDispositionSweep(): Promise<{
  checked: number;
  tagged: number;
  skipped: number;
}> {
  const since = new Date(Date.now() - WEEK_MS);
  const rows = await prisma.contactActivity.findMany({
    where: {
      folder: { not: "trash" },
      OR: [
        {
          type: { in: TOUCH_TYPES },
          dispositionTextHash: null,
          OR: [{ transcriptText: { not: null } }, { body: { not: null } }],
        },
        {
          type: { in: ["call", "meeting"] },
          transcriptText: { not: null },
          updatedAt: { gte: since },
        },
      ],
    },
    orderBy: { updatedAt: "desc" },
    take: 30,
    select: {
      id: true,
      type: true,
      subject: true,
      body: true,
      transcriptText: true,
      emailDirection: true,
      organizationId: true,
      contactId: true,
      dispositionTextHash: true,
    },
  });

  let checked = 0;
  let tagged = 0;
  let skipped = 0;

  for (const row of rows) {
    if (checked >= BATCH) break;
    const text = engagementText(row).slice(0, 6000);
    const hash = textHash(row.type, text);
    if (hash === row.dispositionTextHash) continue;
    if (
      row.contactId &&
      (await contactSweepHeld(row.organizationId, row.contactId))
    ) {
      await prisma.contactActivity.update({
        where: { id: row.id },
        data: { dispositionTextHash: hash },
      });
      skipped += 1;
      continue;
    }
    checked += 1;

    if (text.length < 24) {
      await prisma.contactActivity.update({
        where: { id: row.id },
        data: { disposition: null, dispositionTextHash: hash },
      });
      skipped += 1;
      continue;
    }

    const result = await callAiServiceAgent<{
      ok?: boolean;
      status?: string;
      tag?: string | null;
    }>(
      "disposition",
      {
        channel: row.type,
        text,
        subject: row.subject,
        direction: row.emailDirection,
        organizationId: row.organizationId.toString(),
      },
      { timeoutMs: AI_SERVICE_JOB_TIMEOUT_MS },
    );

    if (!result || result.status === "failed" || result.ok === false) {
      skipped += 1;
      continue;
    }

    const tag = typeof result.tag === "string" ? result.tag.trim() : "";
    await prisma.contactActivity.update({
      where: { id: row.id },
      data: {
        disposition: tag || null,
        dispositionTextHash: hash,
      },
    });
    if (tag) tagged += 1;
    else skipped += 1;
  }

  return { checked, tagged, skipped };
}
