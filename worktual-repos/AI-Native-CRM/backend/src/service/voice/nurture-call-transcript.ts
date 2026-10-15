/**
 * Nurture voice calls: CRM stores the cc-core session id.
 * Spoken lines are read from ccass.conversations / conversation_messages.
 */

import { prisma } from "@/dao/db/prisma";

export type NurtureTranscriptChunk = {
  seq: number;
  speaker: string | null;
  text: string;
  isBot: boolean;
};

export type NurtureCallTranscript = {
  sessionId: string;
  contactName: string;
  direction: string;
  status: string;
  triggeredAt: string;
  transcriptText: string | null;
  chunks: NurtureTranscriptChunk[];
  /** Voice bot audio, recorded by the audio gateway against the same session. */
  recordingUrl: string | null;
};

/**
 * The gateway writes the recording against the cc-core session id, so the
 * nurture link row is enough to find it. Missing rows are normal while a call
 * is still in progress.
 */
async function loadSessionRecordingUrl(
  sessionId: string,
): Promise<string | null> {
  try {
    const rows = await prisma.$queryRaw<Array<{ recording_url: string | null }>>`
      SELECT recording_url
      FROM ccass.call_cdr
      WHERE session_id = ${sessionId}
        AND nullif(btrim(recording_url), '') IS NOT NULL
      ORDER BY session_start_time DESC NULLS LAST
      LIMIT 1
    `;
    return rows[0]?.recording_url?.trim() || null;
  } catch (error) {
    console.warn(
      "[nurture-voice] recording lookup failed",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

function cleanSpokenText(body: string): string {
  return body
    .replace(/\s*\(System key:[^)]*\)\s*/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function speakerForMessage(
  senderType: string,
  rawSpeaker: string | null,
  contactName: string,
): { speaker: string; isBot: boolean } {
  const sender = senderType.trim().toLowerCase();
  if (sender === "bot" || rawSpeaker?.trim().toLowerCase() === "bot") {
    return { speaker: "Bot", isBot: true };
  }
  if (sender === "customer") {
    return { speaker: contactName.trim() || "Customer", isBot: false };
  }
  const named = rawSpeaker?.trim() || "";
  if (named && !/^\+?\d[\d\s\-().]*$/.test(named) && named.toLowerCase() !== "bot") {
    return { speaker: named, isBot: false };
  }
  return { speaker: "Agent", isBot: false };
}

export async function recordNurtureVoiceCall(input: {
  organizationId: string;
  contactId: string;
  activityId: string;
  sessionId: string;
  triggeredAt: Date;
}): Promise<void> {
  const sessionId = input.sessionId.trim();
  const contactId = input.contactId.trim();
  const activityId = input.activityId.trim();
  const organizationId = input.organizationId.trim();
  if (!sessionId || !contactId || !activityId || !organizationId) return;

  await prisma.$executeRaw`
    INSERT INTO crm.nurture_voice_calls (
      id,
      organization_id,
      contact_id,
      activity_id,
      session_id,
      triggered_at
    )
    VALUES (
      ${`nvc_${sessionId}`},
      ${BigInt(organizationId)},
      ${contactId},
      ${activityId},
      ${sessionId},
      ${input.triggeredAt}
    )
    ON CONFLICT (session_id) DO UPDATE SET
      activity_id = EXCLUDED.activity_id,
      contact_id = EXCLUDED.contact_id,
      organization_id = EXCLUDED.organization_id,
      triggered_at = EXCLUDED.triggered_at,
      updated_at = now()
  `;
}

/** True when the customer has a spoken line on this nurture session. Null when the lookup fails. */
export async function nurtureVoiceCustomerSpoke(input: {
  organizationId: string;
  contactId: string;
  sessionId: string;
}): Promise<boolean | null> {
  const sessionId = input.sessionId.trim();
  const contactId = input.contactId.trim();
  const organizationId = input.organizationId.trim();
  if (!sessionId || !contactId || !organizationId) return false;
  try {
    const rows = await prisma.$queryRaw<Array<{ spoken: boolean }>>`
      SELECT EXISTS (
        SELECT 1
        FROM ccass.conversation_messages m
        INNER JOIN ccass.conversations c ON c.id = m.conversation_id
        WHERE c.organization_id = ${BigInt(organizationId)}
          AND c.external_thread_id = ${sessionId}
          AND c.contact_id = ${contactId}
          AND lower(coalesce(m.sender_type, '')) = 'customer'
          AND nullif(btrim(m.body), '') IS NOT NULL
      ) AS spoken
    `;
    return Boolean(rows[0]?.spoken);
  } catch (error) {
    console.warn(
      "[nurture-voice] answer lookup failed",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

export async function loadNurtureCallTranscript(input: {
  activityId: string;
  organizationId: string;
  contactId: string;
  contactName: string;
}): Promise<NurtureCallTranscript | null> {
  const activityId = input.activityId.trim();
  if (!activityId) return null;

  const links = await prisma.$queryRaw<
    Array<{
      session_id: string;
      contact_id: string;
      triggered_at: Date;
    }>
  >`
    SELECT session_id, contact_id, triggered_at
    FROM crm.nurture_voice_calls
    WHERE activity_id = ${activityId}
    LIMIT 1
  `;
  const link = links[0];
  if (!link?.session_id) return null;

  const contactName = input.contactName.trim() || "Customer";
  const organizationId = input.organizationId.trim();
  const contactId = link.contact_id || input.contactId;

  const conversations = await prisma.$queryRaw<
    Array<{ id: bigint; direction: string | null; status: string | null }>
  >`
    SELECT id, direction, status
    FROM ccass.conversations
    WHERE organization_id = ${BigInt(organizationId)}
      AND external_thread_id = ${link.session_id}
      AND contact_id = ${contactId}
    ORDER BY created_at DESC
    LIMIT 1
  `;
  const conversation = conversations[0];

  const messages = conversation
    ? await prisma.$queryRaw<
        Array<{
          sender_type: string | null;
          body: string | null;
          speaker: string | null;
        }>
      >`
        SELECT
          sender_type,
          body,
          model_metadata->>'speaker' AS speaker
        FROM ccass.conversation_messages
        WHERE conversation_id = ${conversation.id}
          AND organization_id = ${BigInt(organizationId)}
          AND visibility = 'customer'
        ORDER BY COALESCE(sent_at, created_at), id
      `
    : [];

  const chunks: NurtureTranscriptChunk[] = [];
  for (const message of messages) {
    const text = cleanSpokenText(message.body || "");
    if (!text) continue;
    const labeled = speakerForMessage(
      message.sender_type || "",
      message.speaker,
      contactName,
    );
    chunks.push({
      seq: chunks.length + 1,
      speaker: labeled.speaker,
      text,
      isBot: labeled.isBot,
    });
  }

  const transcriptText =
    chunks.length > 0
      ? chunks.map((chunk) => `${chunk.speaker}: ${chunk.text}`).join("\n")
      : null;

  return {
    sessionId: link.session_id,
    contactName,
    direction: "outbound",
    status: conversation?.status?.trim() || "ended",
    triggeredAt: new Date(link.triggered_at).toISOString(),
    transcriptText,
    chunks,
    recordingUrl: await loadSessionRecordingUrl(link.session_id),
  };
}
