import type { MediaJobSnapshot, MediaJobStatus, StartJobBody } from "./types.js";
import { runMeetMediaSession } from "./session-runner.js";

type Running = {
  snapshot: MediaJobSnapshot;
  abort: AbortController;
};

const jobs = new Map<string, Running>();

function setStatus(
  sessionId: string,
  status: MediaJobStatus,
  patch?: Partial<MediaJobSnapshot>,
) {
  const running = jobs.get(sessionId);
  if (!running) return;
  running.snapshot = {
    ...running.snapshot,
    ...patch,
    status,
  };
}

export function getMediaJob(sessionId: string): MediaJobSnapshot | null {
  return jobs.get(sessionId.trim())?.snapshot ?? null;
}

export async function stopMediaJob(sessionId: string) {
  const key = sessionId.trim();
  const running = jobs.get(key);
  if (!running) return { ok: false as const, error: "Job not found" };
  running.abort.abort();
  setStatus(key, "stopped");
  jobs.delete(key);
  return { ok: true as const, job: running.snapshot };
}

export async function startMediaJob(body: StartJobBody) {
  const sessionId = body.sessionId?.trim();
  const meetCode = body.meetCode?.trim().toLowerCase();
  const accessToken = body.accessToken?.trim();
  if (!sessionId) return { ok: false as const, error: "sessionId required" };
  if (!meetCode) return { ok: false as const, error: "meetCode required" };
  if (!accessToken) return { ok: false as const, error: "accessToken required" };

  const existing = jobs.get(sessionId);
  if (existing && existing.snapshot.status !== "stopped") {
    existing.abort.abort();
    jobs.delete(sessionId);
  }

  const abort = new AbortController();
  const snapshot: MediaJobSnapshot = {
    sessionId,
    meetCode,
    status: "starting",
    startedAt: new Date().toISOString(),
    chunksSent: 0,
  };
  jobs.set(sessionId, { snapshot, abort });

  void (async () => {
    try {
      setStatus(sessionId, "connecting");
      await runMeetMediaSession({
        ...body,
        sessionId,
        meetCode,
        accessToken,
        signal: abort.signal,
        onStatus: (status, patch) => setStatus(sessionId, status, patch),
        onChunkSent: () => {
          const job = jobs.get(sessionId);
          if (!job) return;
          job.snapshot.chunksSent += 1;
          job.snapshot.lastChunkAt = new Date().toISOString();
        },
      });
      if (!abort.signal.aborted) setStatus(sessionId, "stopped");
    } catch (err) {
      if (abort.signal.aborted) {
        setStatus(sessionId, "stopped");
        return;
      }
      setStatus(sessionId, "error", {
        error: err instanceof Error ? err.message : "Meet Media session failed",
      });
    } finally {
      // Keep last snapshot for status polling; drop abort handle
      const job = jobs.get(sessionId);
      if (job) job.abort = new AbortController();
    }
  })();

  return { ok: true as const, job: snapshot };
}
