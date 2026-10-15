/**
 * Plain transcript mirror for Meet Assist (one file per session).
 * Content is only captured dialogue — `Speaker: utterance` lines, no JSON/metadata.
 *
 *   backend/logs/meet-assist-transcripts/<sessionId>.transcript.log
 *
 * Sync pulls rewrite the whole file from meeting-service; live PCM appends
 * completed lines only.
 */
import fs from "node:fs";
import path from "node:path";

import { dedupeSpeakerTextTranscript } from "@/lib/meeting-assist-transcript-dedupe";

const TRANSCRIPT_DIR = path.join(process.cwd(), "logs", "meet-assist-transcripts");

function enabled(): boolean {
  const raw = (process.env.MEET_ASSIST_TRANSCRIPT_LOG || "true").trim().toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "off";
}

function safeSessionId(sessionId: string): string {
  return sessionId.trim().replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "unknown";
}

function transcriptPath(sessionId: string): string {
  return path.join(TRANSCRIPT_DIR, `${safeSessionId(sessionId)}.transcript.log`);
}

function ensureDir(): void {
  if (!fs.existsSync(TRANSCRIPT_DIR)) {
    fs.mkdirSync(TRANSCRIPT_DIR, { recursive: true });
  }
}

function formatLine(speaker: string | null | undefined, text: string): string {
  const who = (speaker || "Unknown").trim();
  return `${who}: ${text.trim()}\n`;
}

/** Replace file with the full captured transcript (meeting-service pull). */
export function writeMeetAssistTranscriptFile(input: {
  sessionId: string;
  text: string;
}): void {
  if (!enabled()) return;
  const body = dedupeSpeakerTextTranscript(input.text.trim());
  if (!body) return;
  try {
    ensureDir();
    fs.writeFileSync(transcriptPath(input.sessionId), `${body}\n`, "utf8");
  } catch {
    /* optional */
  }
}

/** Append one completed utterance (live PCM path). Skips drafts/partials. */
export function appendMeetAssistTranscriptLine(input: {
  sessionId: string;
  speaker?: string | null;
  text: string;
  completed?: boolean;
}): void {
  if (!enabled()) return;
  if (input.completed === false) return;
  const text = input.text.trim();
  if (!text) return;
  try {
    ensureDir();
    fs.appendFileSync(
      transcriptPath(input.sessionId),
      formatLine(input.speaker, text),
      "utf8",
    );
  } catch {
    /* optional */
  }
}

/** @deprecated use writeMeetAssistTranscriptFile — kept for call sites during sync. */
export function writeMeetAssistTranscriptSnapshot(input: {
  sessionId: string;
  text: string;
  activityId?: string | null;
  meetingId?: string | null;
  segmentCount?: number;
  partialCount?: number;
}): void {
  writeMeetAssistTranscriptFile({ sessionId: input.sessionId, text: input.text });
}

/** Debug/diagnostics live in meet-assist-panel JSONL — not in transcript files. */
export function logMeetAssistTranscriptEvent(
  _event: string,
  _fields: Record<string, unknown> = {},
): void {
  /* no-op: transcript logs are transcript-only */
}
