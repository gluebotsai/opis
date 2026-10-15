import { describe, expect, it } from "vitest";
import {
  buildVexaSyncLatencyTrace,
  enrichLatencyGaps,
  formatLatencyDetail,
  formatLatencySummary,
  normalizeLatencyTrace,
} from "./meeting-assist-latency";

describe("meeting-assist-latency", () => {
  it("normalizes snake_case marks and computes gaps", () => {
    const trace = normalizeLatencyTrace({
      segment_id: "seg-1",
      marks: [
        { stage: "speech_start", started_at: "2026-01-01T00:00:00.000Z" },
        {
          stage: "speech_end",
          started_at: "2026-01-01T00:00:00.000Z",
          ended_at: "2026-01-01T00:00:01.000Z",
        },
        {
          stage: "whisper",
          started_at: "2026-01-01T00:00:01.000Z",
          ended_at: "2026-01-01T00:00:01.400Z",
        },
        {
          stage: "crm_ingest",
          started_at: "2026-01-01T00:00:01.500Z",
          ended_at: "2026-01-01T00:00:01.520Z",
        },
        { stage: "heard_sse", started_at: "2026-01-01T00:00:01.530Z" },
        {
          stage: "assist_llm",
          started_at: "2026-01-01T00:00:01.540Z",
          ended_at: "2026-01-01T00:00:02.540Z",
        },
      ],
    });
    expect(trace?.segmentId).toBe("seg-1");
    const enriched = enrichLatencyGaps(trace!);
    expect(enriched.gapsMs?.speechMs).toBe(1000);
    expect(enriched.gapsMs?.silenceToWhisperEndMs).toBe(400);
    expect(enriched.gapsMs?.heardToAssistEndMs).toBe(1010);
    const summary = formatLatencySummary(enriched);
    expect(summary).toContain("Customer speech: 1000 ms");
    expect(summary).toContain("Heard → Suggested reply");
  });

  it("vexa sync trace uses stable heardAt and backup path label", () => {
    const heardAt = "2026-09-19T11:37:00.000Z";
    const trace = buildVexaSyncLatencyTrace({
      segmentId: "ch-0:1",
      speechStartSec: 1_769_800_610.264,
      speechEndSec: 1_769_800_614.36,
      heardAt,
    });
    expect(trace?.source).toBe("vexa_sync");
    expect(trace?.gapsMs?.vexaEndToHeardMs).toBeLessThan(50_000);
    const detail = formatLatencyDetail(trace!);
    expect(detail).toContain("Vexa poll backup");
    expect(detail).not.toContain("Detect speech start");
  });
});
