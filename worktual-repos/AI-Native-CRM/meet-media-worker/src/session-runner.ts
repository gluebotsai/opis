import { connectActiveConference } from "./meet-connect.js";
import { createMeetPeerSession } from "./webrtc-session.js";
import { transcribePcm16 } from "./stt.js";
import {
  customerSpeakerLabel,
  isSalesParticipant,
} from "./participant-filter.js";
import { ingestCustomerChunk, reportMediaStatusToCrm } from "./crm-ingest.js";
import type { MediaJobStatus, StartJobBody } from "./types.js";

const SAMPLE_RATE = 16_000;
const FLUSH_MS = 800;
const BYTES_PER_SAMPLE = 2;

export async function runMeetMediaSession(
  input: StartJobBody & {
    signal: AbortSignal;
    onStatus: (
      status: MediaJobStatus,
      patch?: { error?: string | null; traceId?: string | null },
    ) => void;
    onChunkSent: () => void;
  },
): Promise<void> {
  const crmBaseUrl = (
    input.crmBaseUrl ||
    process.env.CRM_API_BASE_URL ||
    "http://127.0.0.1:4000"
  ).replace(/\/$/, "");
  const secret =
    input.crmInternalSecret ||
    process.env.ENRICH_INTERNAL_SECRET ||
    process.env.MEET_MEDIA_WORKER_SECRET ||
    "";

  const salesNames = input.salesNames || [];
  const report = async (
    status: MediaJobStatus,
    patch?: { error?: string | null; traceId?: string | null },
  ) => {
    input.onStatus(status, patch);
    if (secret) {
      await reportMediaStatusToCrm({
        crmBaseUrl,
        secret,
        sessionId: input.sessionId,
        status,
        error: patch?.error,
        traceId: patch?.traceId,
      });
    }
  };

  let pcmChunks: Buffer[] = [];
  let pcmBytes = 0;
  let uploading = false;
  let lastText = "";
  let flushTimer: ReturnType<typeof setInterval> | null = null;

  const flush = async () => {
    if (uploading || pcmBytes < SAMPLE_RATE * BYTES_PER_SAMPLE * 0.6) {
      pcmChunks = [];
      pcmBytes = 0;
      return;
    }
    uploading = true;
    const pcm = Buffer.concat(pcmChunks, pcmBytes);
    pcmChunks = [];
    pcmBytes = 0;
    try {
      const transcribed = await transcribePcm16({
        pcm,
        sampleRate: SAMPLE_RATE,
      });
      if (!transcribed.ok) return;
      const text = transcribed.text.trim();
      if (!text || text.toLowerCase() === lastText.toLowerCase()) return;

      const speaker = customerSpeakerLabel({
        contactName: input.contactName,
      });
      if (isSalesParticipant(speaker, salesNames)) return;

      lastText = text;
      if (!secret) {
        console.warn("No CRM secret — skipping ingest:", text.slice(0, 80));
        return;
      }
      const ingested = await ingestCustomerChunk({
        crmBaseUrl,
        secret,
        meetingId: input.meetCode,
        activityId: input.activityId,
        text,
        speaker,
      });
      if (ingested.ok) input.onChunkSent();
      else console.warn("ingest failed", ingested.error);
    } finally {
      uploading = false;
    }
  };

  const livePeer = await createMeetPeerSession({
    onAudioPcm: (samples) => {
      if (input.signal.aborted) return;
      const buf = Buffer.from(
        samples.buffer,
        samples.byteOffset,
        samples.byteLength,
      );
      pcmChunks.push(Buffer.from(buf));
      pcmBytes += buf.length;
      const maxBytes = Math.floor(
        (SAMPLE_RATE * FLUSH_MS * BYTES_PER_SAMPLE) / 1000,
      );
      if (pcmBytes >= maxBytes) void flush();
    },
  });

  if (!livePeer.audioEnabled) {
    await report("error", {
      error:
        "Meet Media WebRTC runtime not available. Install `wrtc` in meet-media-worker and enroll Google Workspace Developer Preview for Meet Media API.",
    });
    livePeer.close();
    throw new Error(
      "Meet Media WebRTC runtime not available (install wrtc + Developer Preview).",
    );
  }

  try {
    const offer = await livePeer.createOfferSdp();
    const connected = await connectActiveConference({
      accessToken: input.accessToken,
      meetCode: input.meetCode,
      offerSdp: offer,
    });
    await livePeer.setRemoteAnswer(connected.answer);
    await report("listening", { traceId: connected.traceId || null });

    flushTimer = setInterval(() => {
      if (!input.signal.aborted) void flush();
    }, FLUSH_MS);

    await new Promise<void>((resolve) => {
      if (input.signal.aborted) {
        resolve();
        return;
      }
      input.signal.addEventListener("abort", () => resolve(), { once: true });
    });

    await flush();
  } finally {
    if (flushTimer) clearInterval(flushTimer);
    livePeer.close();
    await report("stopped");
  }
}
