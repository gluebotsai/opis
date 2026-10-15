/**
 * Panel delivery snapshot for a Meet code (CRM session, chunks, lastSuggestions).
 * Run: npx tsx scripts/debug-meet-assist-panel.ts <meet-code-fragment>
 */
import "./load-repo-env.js";
import { prisma } from "../src/dao/db/prisma.js";
import { parseMeetingLinkFromBody } from "../src/lib/meeting-body.js";
import { readCaptureBotMeta } from "../src/service/transcripts/meeting-capture.js";
import { getLatestHeardForAssistSession } from "../src/service/ai/meeting-assist.js";
import { getContact } from "../src/dao/contacts/contact-service.js";

const needle = process.argv[2] || "ibw-dgfh-utw";

async function main() {
  const acts = await prisma.contactActivity.findMany({
    where: { type: "meeting", body: { contains: needle } },
    orderBy: { updatedAt: "desc" },
    take: 3,
    select: { id: true, subject: true, body: true },
  });
  if (!acts.length) {
    console.log("No meeting activity for:", needle);
    return;
  }
  for (const a of acts) {
    const session = await prisma.meetingAssistSession.findUnique({
      where: { activityId: a.id },
      select: {
        id: true,
        contactId: true,
        status: true,
        joinUrl: true,
        lastAssistAt: true,
        lastSuggestions: true,
        meta: true,
      },
    });
    console.log("\n---");
    console.log("activity", a.id, parseMeetingLinkFromBody(a.body));
    if (!session) {
      console.log("assist session: MISSING");
      continue;
    }
    const cap = readCaptureBotMeta(session.meta);
    const contact = session.contactId
      ? await getContact(session.contactId).catch(() => null)
      : null;
    const crmContactName =
      contact?.displayName?.trim() ||
      [contact?.person?.firstName, contact?.person?.lastName]
        .filter(Boolean)
        .join(" ")
        .trim() ||
      null;
    const chunks = await prisma.meetingTranscriptChunk.findMany({
      where: { sessionId: session.id },
      orderBy: { seq: "asc" },
      select: { seq: true, speaker: true, text: true, source: true },
    });
    const lastHeard = await getLatestHeardForAssistSession(session.id);
    const sug = session.lastSuggestions as Record<string, unknown> | null;
    const talk =
      typeof sug?.talkTrack === "string" ? sug.talkTrack.trim() : "";
    const chunkSpeakers = [
      ...new Set(chunks.map((c) => (c.speaker || "").trim()).filter(Boolean)),
    ];
    console.log({
      sessionId: session.id,
      contactId: session.contactId,
      crmContactName,
      crmContactEmail: contact?.person?.email ?? null,
      chunkSpeakers,
      contactNameMatchesSpeaker:
        crmContactName && chunkSpeakers.length
          ? chunkSpeakers.some((sp) => {
              const a = crmContactName.toLowerCase();
              const b = sp.toLowerCase();
              return a === b || a.includes(b) || b.includes(a);
            })
          : null,
      status: session.status,
      captureBot: cap,
      chunkCount: chunks.length,
      lastHeard,
      lastAssistAt: session.lastAssistAt?.toISOString() ?? null,
      hasTalkTrack: Boolean(talk),
      talkPreview: talk.slice(0, 100) || null,
    });
    if (chunks.length) {
      console.log(
        "chunks:",
        chunks.map((c) => `[${c.seq}] ${c.speaker}: ${c.text.slice(0, 60)}`),
      );
    }
  }
  console.log(
    "\nPanel log tail: backend/logs/meet-assist-panel-" +
      new Date().toISOString().slice(0, 10) +
      ".log",
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
