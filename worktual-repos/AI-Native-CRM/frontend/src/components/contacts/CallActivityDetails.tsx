import { useEffect, useState } from "react";
import { Phone, Sparkles, Volume2 } from "lucide-react";
import {
  fetchCallActivityTranscript,
  type CallActivityAssist,
  type CallTranscriptChunk,
} from "@/services/callAssist";
import { sanitizeActivityDisplayText } from "@/lib/activity-display";
import { DispositionTag } from "@/components/contacts/DispositionTag";

type TranscriptLine = {
  id: string;
  speaker: string | null;
  text: string;
};

function phoneTail(value: string | null | undefined): string {
  const digits = String(value ?? "").replace(/\D+/g, "");
  if (!digits) return "";
  return digits.length <= 10 ? digits : digits.slice(-10);
}

function displaySpeaker(
  raw: string | null | undefined,
  isBot: boolean,
  contactName: string,
  agentName: string,
  remoteDigits: string,
): string | null {
  if (isBot) return "Bot";
  const speaker = raw?.trim() || "";
  if (!speaker) return agentName || "Agent";
  const speakerTail = phoneTail(speaker);
  const remote = phoneTail(remoteDigits);
  if (speakerTail && remote && speakerTail === remote) {
    return contactName || "Customer";
  }
  if (!/^\+?\d[\d\s\-().]*$/.test(speaker)) {
    if (/^agent$/i.test(speaker)) return agentName || "Agent";
    if (/^(customer|contact)$/i.test(speaker)) return contactName || "Customer";
    return speaker;
  }
  return agentName || "Agent";
}

function parseRolledUpTranscript(
  text: string,
  contactName: string,
  agentName: string,
  remoteDigits: string,
): TranscriptLine[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const colon = line.indexOf(": ");
      if (colon > 0 && colon < 80) {
        return {
          id: `text-${index}`,
          speaker: displaySpeaker(
            line.slice(0, colon).trim(),
            false,
            contactName,
            agentName,
            remoteDigits,
          ),
          text: line.slice(colon + 2).trim(),
        };
      }
      return { id: `text-${index}`, speaker: null, text: line };
    });
}

function chunksToLines(
  chunks: CallTranscriptChunk[],
  contactName: string,
  agentName: string,
  remoteDigits: string,
): TranscriptLine[] {
  return chunks
    .filter((chunk) => chunk.text.trim())
    .map((chunk) => ({
      id: `seq-${chunk.seq}`,
      speaker: displaySpeaker(
        chunk.speaker,
        chunk.isBot,
        contactName,
        agentName,
        remoteDigits,
      ),
      text: chunk.text.trim(),
    }));
}

function directionLabel(body: string | null, sessionDirection?: string | null) {
  const blob = `${body || ""} ${sessionDirection || ""}`.toLowerCase();
  if (blob.includes("inbound")) return "Inbound call";
  if (blob.includes("outbound")) return "Outbound call";
  return "Call";
}

function isNurtureCall(subject: string, body: string | null) {
  const blob = `${subject}\n${body || ""}`.toLowerCase();
  return blob.includes("nurture voice bot") || blob.includes("cc-core");
}

function emptyTranscriptMessage(input: {
  subject: string;
  body: string | null;
  hasSession: boolean;
  chunkCount: number;
  source: string | null;
}) {
  if (input.source === "ccass") {
    return "The nurture voice bot was triggered, but CCaaS has no transcript lines for this session yet.";
  }
  if (isNurtureCall(input.subject, input.body)) {
    return "This nurture voice-bot call has no stored CCaaS session, so there is no transcript to show.";
  }
  if (input.hasSession && input.chunkCount === 0) {
    return "Call Assist started for this CRM SIP call, but no speech lines arrived from the audio gateway — so there is nothing to show.";
  }
  if (input.source === "audio_cc") {
    return "This CRM call ended without captured speech lines.";
  }
  return "No conversation transcript was captured for this call. Transcripts appear for connected CRM SIP inbound/outbound calls when the audio gateway streams lines.";
}

/**
 * A finished call's transcript never changes, so it is kept for the session.
 * Timeline rows unmount whenever the user switches tab, and without this each
 * return to the call showed the loader and refetched what was already known.
 */
type ResolvedCall = {
  lines: TranscriptLine[];
  source: string | null;
  direction: string;
  assist: CallActivityAssist | null;
  hasSession: boolean;
  chunkCount: number;
  recordingUrl: string | null;
};

const transcriptCache = new Map<string, ResolvedCall>();

export function CallActivityDetails({
  activityId,
  subject,
  body,
  transcriptText: transcriptProp = null,
  transcriptSource: sourceProp = null,
  contactDisplayName = "",
  disposition = null,
}: {
  activityId?: string;
  subject: string;
  body: string | null;
  transcriptText?: string | null;
  transcriptSource?: string | null;
  contactDisplayName?: string;
  disposition?: string | null;
}) {
  const fallbackContact = contactDisplayName.trim() || "Customer";
  const cached = activityId ? transcriptCache.get(activityId) : undefined;
  const [lines, setLines] = useState<TranscriptLine[]>(() => {
    if (cached) return cached.lines;
    return transcriptProp?.trim()
      ? parseRolledUpTranscript(transcriptProp, fallbackContact, "Agent", "")
      : [];
  });
  const [source, setSource] = useState<string | null>(cached?.source ?? sourceProp);
  const [direction, setDirection] = useState(
    () => cached?.direction ?? directionLabel(body),
  );
  const [assist, setAssist] = useState<CallActivityAssist | null>(
    cached?.assist ?? null,
  );
  const [hasSession, setHasSession] = useState(cached?.hasSession ?? false);
  const [chunkCount, setChunkCount] = useState(cached?.chunkCount ?? 0);
  const [recordingUrl, setRecordingUrl] = useState<string | null>(
    cached?.recordingUrl ?? null,
  );
  const [loading, setLoading] = useState(Boolean(activityId) && !cached);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!activityId) {
      setLoading(false);
      return;
    }
    const apply = (resolved: ResolvedCall) => {
      setDirection(resolved.direction);
      setSource(resolved.source);
      setHasSession(resolved.hasSession);
      setChunkCount(resolved.chunkCount);
      setAssist(resolved.assist);
      setRecordingUrl(resolved.recordingUrl);
      setLines(resolved.lines);
      setError(null);
      setLoading(false);
    };
    const known = transcriptCache.get(activityId);
    if (known) {
      apply(known);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void fetchCallActivityTranscript(activityId)
      .then((data) => {
        if (cancelled) return;
        const assistPayload = data.callAssist as
          | { assist?: CallActivityAssist | null }
          | CallActivityAssist
          | null;
        let nextAssist: CallActivityAssist | null = null;
        if (assistPayload && "assist" in assistPayload) {
          nextAssist = assistPayload.assist ?? null;
        } else if (
          assistPayload &&
          typeof assistPayload === "object" &&
          ("talkTrack" in assistPayload || "suggestions" in assistPayload)
        ) {
          nextAssist = assistPayload as CallActivityAssist;
        }
        const contactName =
          data.contactName?.trim() ||
          data.session?.contactName?.trim() ||
          fallbackContact;
        const agentName =
          data.agentName?.trim() ||
          data.session?.agentName?.trim() ||
          "Agent";
        const remoteDigits = data.session?.remoteDigits || "";
        const fromChunks = chunksToLines(
          data.chunks,
          contactName,
          agentName,
          remoteDigits,
        );
        let nextLines: TranscriptLine[] = [];
        if (fromChunks.length > 0) {
          nextLines = fromChunks;
        } else if (data.transcriptText?.trim()) {
          nextLines = parseRolledUpTranscript(
            data.transcriptText,
            contactName,
            agentName,
            remoteDigits,
          );
        } else if (transcriptProp?.trim()) {
          nextLines = parseRolledUpTranscript(
            transcriptProp,
            contactName,
            agentName,
            remoteDigits,
          );
        }
        const resolved: ResolvedCall = {
          lines: nextLines,
          source: data.transcriptSource || sourceProp,
          direction: directionLabel(data.body ?? body, data.session?.direction),
          assist: nextAssist,
          hasSession: Boolean(data.session),
          chunkCount: data.session?.chunkCount ?? data.chunks.length,
          recordingUrl: data.recordingUrl?.trim() || null,
        };
        // Keep a finished transcript, and keep a call that has no assist
        // session at all — nothing will ever stream for that one. A session
        // still waiting on its lines stays uncached so a later visit refetches.
        // A bot call's recording lands shortly after the call ends, so leave
        // those refetchable until it does. Agent calls have no gateway
        // recording and cache as before.
        const recordingSettled =
          Boolean(resolved.recordingUrl) || resolved.source !== "ccass";
        if (
          (resolved.lines.length > 0 || !resolved.hasSession) &&
          recordingSettled
        ) {
          transcriptCache.set(activityId, resolved);
        }
        apply(resolved);
      })
      .catch(() => {
        if (cancelled) return;
        if (transcriptProp?.trim()) {
          setLines(
            parseRolledUpTranscript(
              transcriptProp,
              fallbackContact,
              "Agent",
              "",
            ),
          );
          setError(null);
        } else {
          setError("Could not load call transcript.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activityId, body, fallbackContact, sourceProp, transcriptProp]);

  const title =
    sanitizeActivityDisplayText(subject).replace(/^Call with\s+/i, "").trim() ||
    subject;
  const nurture = isNurtureCall(subject, body);
  const assistBits = [
    assist?.talkTrack?.trim(),
    ...(assist?.suggestions ?? []).map((item) => item.text?.trim()).filter(Boolean),
    ...(assist?.nextQuestions ?? []).map((q) => q.trim()).filter(Boolean),
    assist?.nextBestAction?.trim(),
    assist?.sentimentCoachHint?.trim(),
  ].filter(Boolean) as string[];

  return (
    <div className="mt-2 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-semibold text-text-primary">
          {nurture ? subject : `Call with ${title}`}
        </p>
        <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800">
          {nurture ? "Nurture voice bot" : direction}
        </span>
        {lines.length > 0 ? (
          <span className="rounded-md bg-violet-50 px-2 py-0.5 text-xs font-medium text-brand">
            Transcript: available
            {source ? ` · ${source}` : ""}
          </span>
        ) : !loading ? (
          <span className="rounded-md bg-subtle px-2 py-0.5 text-xs font-medium text-text-secondary">
            Transcript: none
          </span>
        ) : null}
        {assistBits.length > 0 ? (
          <span className="rounded-md bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900">
            Assist saved
          </span>
        ) : null}
      </div>

      {recordingUrl ? (
        <div className="rounded-lg border border-border-default bg-surface p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-text-caption">
              <Volume2 className="size-3.5" strokeWidth={1.75} aria-hidden />
              Call recording
            </p>
            <a
              href={recordingUrl}
              target="_blank"
              rel="noreferrer"
              className="text-xs font-medium text-text-secondary underline-offset-2 hover:text-text-primary hover:underline"
            >
              Open
            </a>
          </div>
          {/* Streamed from the gateway host, which serves range requests. */}
          <audio
            controls
            preload="none"
            src={recordingUrl}
            className="mt-2 h-9 w-full"
          >
            <a href={recordingUrl}>Download the recording</a>
          </audio>
        </div>
      ) : null}

      {body && !nurture ? (
        <p className="text-sm text-text-secondary">
          {sanitizeActivityDisplayText(body)}
        </p>
      ) : null}

      {loading ? (
        <p className="text-xs text-text-caption">Loading transcript…</p>
      ) : error ? (
        <p className="text-xs text-red-700">{error}</p>
      ) : lines.length > 0 ? (
        <div className="max-h-80 space-y-2 overflow-y-auto rounded-lg border border-border-default bg-surface p-3 text-sm">
          <div className="mb-1 flex flex-wrap items-center gap-1.5 text-[11px] font-medium tracking-wide text-text-caption uppercase">
            <Phone className="size-3.5" strokeWidth={1.75} />
            Conversation
            <DispositionTag label={disposition} />
          </div>
          {lines.map((line) => (
            <p key={line.id} className="leading-snug text-text-secondary">
              {line.speaker ? (
                <span className="font-semibold text-text-primary">
                  {line.speaker}:{" "}
                </span>
              ) : null}
              {line.text}
            </p>
          ))}
        </div>
      ) : (
        <p className="text-xs text-text-caption">
          {emptyTranscriptMessage({
            subject,
            body,
            hasSession,
            chunkCount,
            source,
          })}
        </p>
      )}

      {!loading && assistBits.length > 0 ? (
        <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50/60 p-3 text-sm">
          <div className="flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-amber-900 uppercase">
            <Sparkles className="size-3.5" strokeWidth={1.75} />
            Call assist
          </div>
          {assist?.talkTrack?.trim() ? (
            <p className="text-text-primary">{assist.talkTrack.trim()}</p>
          ) : null}
          {(assist?.suggestions ?? [])
            .filter((item) => item.text?.trim())
            .map((item, index) => (
              <p key={`s-${index}`} className="text-text-secondary">
                <span className="font-medium text-text-primary">
                  {item.title?.trim() || "Suggestion"}:
                </span>{" "}
                {item.text.trim()}
              </p>
            ))}
          {(assist?.nextQuestions ?? []).filter(Boolean).length > 0 ? (
            <ul className="list-disc space-y-1 pl-5 text-text-secondary">
              {(assist?.nextQuestions ?? [])
                .map((q) => q.trim())
                .filter(Boolean)
                .map((q) => (
                  <li key={q}>{q}</li>
                ))}
            </ul>
          ) : null}
          {assist?.nextBestAction?.trim() ? (
            <p className="text-text-secondary">
              <span className="font-medium text-text-primary">Next:</span>{" "}
              {assist.nextBestAction.trim()}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
