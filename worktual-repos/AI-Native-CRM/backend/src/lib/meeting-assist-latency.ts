/** Live Assist latency trace (customer speech → Heard → suggested reply). */

export type LiveAssistLatencyMark = {
  stage: string;
  startedAt: string;
  endedAt?: string;
};

export type LiveAssistLatencyTrace = {
  segmentId?: string | null;
  completed?: boolean;
  /** `pcm` = live-caption path; `vexa_sync` = backup poll (coarse timing only). */
  source?: "pcm" | "vexa_sync" | null;
  marks: LiveAssistLatencyMark[];
  gapsMs?: Record<string, number>;
};

function parseMs(iso: string | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

function markEndMs(mark: LiveAssistLatencyMark): number | null {
  return parseMs(mark.endedAt || mark.startedAt);
}

function markStartMs(mark: LiveAssistLatencyMark): number | null {
  return parseMs(mark.startedAt);
}

function findMark(marks: LiveAssistLatencyMark[], stage: string): LiveAssistLatencyMark | undefined {
  const hits = marks.filter((m) => m.stage === stage);
  return hits.length ? hits[hits.length - 1] : undefined;
}

/** Compute gap labels (ms) for Assist UI. */
export function enrichLatencyGaps(trace: LiveAssistLatencyTrace): LiveAssistLatencyTrace {
  const marks = trace.marks || [];
  const gapsMs: Record<string, number> = {};
  const speechStart = findMark(marks, "speech_start");
  const speechEnd = findMark(marks, "speech_end");
  const whisper = findMark(marks, "whisper");
  const heard = findMark(marks, "heard_sse");
  const assistLlm = findMark(marks, "assist_llm");
  const crmIngest = findMark(marks, "crm_ingest");
  const vexaSync = findMark(marks, "vexa_sync");

  const s0 = speechStart ? markStartMs(speechStart) : null;
  const s1 = speechEnd ? markEndMs(speechEnd) : null;
  const w1 = whisper ? markEndMs(whisper) : null;
  const h0 = heard ? markStartMs(heard) : null;
  const a1 = assistLlm ? markEndMs(assistLlm) : null;
  const ingest0 = crmIngest ? markStartMs(crmIngest) : null;

  if (s0 != null && s1 != null) gapsMs.speechMs = Math.max(0, s1 - s0);
  if (s1 != null && w1 != null) gapsMs.silenceToWhisperEndMs = Math.max(0, w1 - s1);
  if (w1 != null && ingest0 != null) gapsMs.whisperToCrmIngestMs = Math.max(0, ingest0 - w1);
  if (s1 != null && h0 != null && vexaSync) {
    gapsMs.vexaEndToHeardMs = Math.max(0, h0 - s1);
  }
  if (ingest0 != null && h0 != null) gapsMs.crmIngestToHeardMs = Math.max(0, h0 - ingest0);
  if (h0 != null && a1 != null) gapsMs.heardToAssistEndMs = Math.max(0, a1 - h0);
  if (s0 != null && a1 != null) gapsMs.speechStartToAssistEndMs = Math.max(0, a1 - s0);

  return { ...trace, gapsMs };
}

export function appendLatencyMark(
  trace: LiveAssistLatencyTrace | null | undefined,
  mark: LiveAssistLatencyMark,
): LiveAssistLatencyTrace {
  const base: LiveAssistLatencyTrace = trace?.marks?.length
    ? { ...trace, marks: [...trace.marks] }
    : { marks: [], segmentId: trace?.segmentId, completed: trace?.completed };
  base.marks.push(mark);
  return enrichLatencyGaps(base);
}

export function normalizeLatencyTrace(raw: unknown): LiveAssistLatencyTrace | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const marksRaw = o.marks;
  if (!Array.isArray(marksRaw)) return null;
  const marks: LiveAssistLatencyMark[] = [];
  for (const m of marksRaw) {
    if (!m || typeof m !== "object") continue;
    const row = m as Record<string, unknown>;
    const stage = String(row.stage || "").trim();
    const startedAt = String(row.startedAt || row.started_at || "").trim();
    if (!stage || !startedAt) continue;
    const endedAtRaw = row.endedAt ?? row.ended_at;
    marks.push({
      stage,
      startedAt,
      endedAt:
        typeof endedAtRaw === "string" && endedAtRaw.trim()
          ? endedAtRaw.trim()
          : undefined,
    });
  }
  if (!marks.length) return null;
  const sourceRaw = o.source;
  const source =
    sourceRaw === "pcm" || sourceRaw === "vexa_sync" ? sourceRaw : undefined;
  return enrichLatencyGaps({
    segmentId:
      typeof o.segmentId === "string"
        ? o.segmentId
        : typeof o.segment_id === "string"
          ? o.segment_id
          : null,
    completed: typeof o.completed === "boolean" ? o.completed : undefined,
    source,
    marks,
  });
}

const GAP_LABELS: Record<string, string> = {
  speechMs: "Customer speech",
  silenceToWhisperEndMs: "Silence → Whisper done",
  whisperToCrmIngestMs: "Whisper → CRM ingest",
  vexaEndToHeardMs: "Vexa segment → Heard (sync)",
  crmIngestToHeardMs: "CRM → Heard (SSE)",
  heardToAssistEndMs: "Heard → Suggested reply",
  speechStartToAssistEndMs: "Total (speech → coach)",
};

const STAGE_LABELS: Record<string, string> = {
  speech_start: "Detect speech start",
  speech_end: "Detect speech end",
  whisper: "Whisper STT",
  segment_emit: "Emit caption",
  crm_push: "HTTP → CRM",
  crm_ingest: "CRM ingest",
  vexa_sync: "Vexa poll → Heard",
  heard_sse: "Heard (SSE)",
  assist_schedule: "Schedule coach",
  assist_llm: "Coach LLM",
};

/** One-line-per-stage summary for Meet add-on / panel. */
export function formatLatencySummary(trace: LiveAssistLatencyTrace | null | undefined): string {
  if (!trace?.gapsMs) return "";
  const lines: string[] = [];
  for (const [key, label] of Object.entries(GAP_LABELS)) {
    const ms = trace.gapsMs[key];
    if (ms == null || !Number.isFinite(ms)) continue;
    lines.push(`${label}: ${Math.round(ms)} ms`);
  }
  return lines.join("\n");
}

/** Per-stage start/end for debugging delay (customer speech → coach). */
export function formatLatencyStages(trace: LiveAssistLatencyTrace | null | undefined): string {
  if (!trace?.marks?.length) return "";
  const lines: string[] = [];
  for (const m of trace.marks) {
    const label = STAGE_LABELS[m.stage] || m.stage;
    const t0 = markStartMs(m);
    const t1 = markEndMs(m);
    if (t0 == null) continue;
    const dur =
      t1 != null && t1 >= t0 ? `${Math.round(t1 - t0)} ms` : "…";
    lines.push(`${label}: ${m.startedAt}${m.endedAt ? ` → ${m.endedAt}` : ""} (${dur})`);
  }
  return lines.join("\n");
}

function segmentTimeIso(sec: number | null | undefined): string | null {
  if (sec == null || !Number.isFinite(sec)) return null;
  // Vexa wall-clock epoch seconds (typical) vs bogus tiny offsets
  if (sec < 1_000_000_000) return null;
  return new Date(sec * 1000).toISOString();
}

/** Coarse trace when Heard comes from sync-live + Vexa segments (no PCM marks). */
export function buildVexaSyncLatencyTrace(input: {
  segmentId?: string | null;
  speechStartSec?: number | null;
  speechEndSec?: number | null;
  heardAt?: string;
}): LiveAssistLatencyTrace | null {
  const heardAt = input.heardAt || new Date().toISOString();
  const marks: LiveAssistLatencyMark[] = [];
  const startIso = segmentTimeIso(input.speechStartSec);
  const endIso = segmentTimeIso(input.speechEndSec ?? input.speechStartSec);
  if (startIso && endIso) {
    marks.push({ stage: "speech_start", startedAt: startIso, endedAt: endIso });
    marks.push({ stage: "speech_end", startedAt: endIso, endedAt: endIso });
    marks.push({
      stage: "vexa_sync",
      startedAt: endIso,
      endedAt: heardAt,
    });
  } else {
    marks.push({
      stage: "vexa_sync",
      startedAt: heardAt,
      endedAt: heardAt,
    });
  }
  marks.push({ stage: "heard_sse", startedAt: heardAt });
  return enrichLatencyGaps({
    segmentId: input.segmentId ?? null,
    source: "vexa_sync",
    marks,
  });
}

export function isPcmLatencyTrace(
  trace: LiveAssistLatencyTrace | null | undefined,
): boolean {
  if (!trace?.marks?.length) return false;
  if (trace.source === "vexa_sync") return false;
  if (trace.source === "pcm") return true;
  return trace.marks.some(
    (m) =>
      m.stage === "whisper" ||
      m.stage === "crm_ingest" ||
      m.stage === "crm_push" ||
      m.stage === "segment_emit",
  );
}

export function formatLatencyDetail(trace: LiveAssistLatencyTrace | null | undefined): string {
  if (!trace?.marks?.length) return "";
  const pcm = isPcmLatencyTrace(trace);
  const gaps = formatLatencySummary(trace);
  if (!pcm) {
    const lines = [
      "Path: Vexa poll backup (live PCM not active for this line).",
      "Fix: bot VEXA_LIVE_PCM_WS_BASE + rebuild bot image.",
    ];
    if (gaps) lines.push("", gaps);
    return lines.join("\n");
  }
  const stages = formatLatencyStages(trace);
  if (gaps && stages) return `${gaps}\n\n${stages}`;
  return gaps || stages;
}
