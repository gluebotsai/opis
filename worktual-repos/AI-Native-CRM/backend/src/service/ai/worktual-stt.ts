/**
 * Worktual OpenAI-compatible speech-to-text (Whisper-style transcriptions API).
 *
 * Env:
 *   WORKTUAL_STT_BASE_URL  e.g. http://173.234.75.165:7789/v1
 *   WORKTUAL_STT_API_KEY   often "EMPTY" for internal gateways
 *   WORKTUAL_STT_MODEL     default worktual-large-v3
 */

export type WorktualSttResult =
  | { ok: true; text: string }
  | { ok: false; error: string };

function sttConfig() {
  const baseUrl = (
    process.env.WORKTUAL_STT_BASE_URL ||
    process.env.STT_BASE_URL ||
    ""
  )
    .trim()
    .replace(/\/$/, "");
  const apiKey = (
    process.env.WORKTUAL_STT_API_KEY ||
    process.env.STT_API_KEY ||
    "EMPTY"
  ).trim();
  const model = (
    process.env.WORKTUAL_STT_MODEL ||
    process.env.STT_MODEL ||
    "worktual-large-v3"
  ).trim();
  return { baseUrl, apiKey, model };
}

export function isWorktualSttConfigured(): boolean {
  return Boolean(sttConfig().baseUrl);
}

function extensionForMime(mime: string): string {
  if (mime.includes("wav")) return "wav";
  if (mime.includes("mpeg") || mime.includes("mp3")) return "mp3";
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("mp4") || mime.includes("m4a")) return "m4a";
  return "webm";
}

/** Wrap 16-bit little-endian mono PCM as a WAV file buffer. */
export function encodePcm16MonoWav(
  pcm: Buffer,
  sampleRate = 16_000,
): Buffer {
  const dataSize = pcm.length;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  pcm.copy(buffer, 44);
  return buffer;
}

/**
 * Transcribe a raw audio buffer via the Worktual /audio/transcriptions API.
 */
export async function transcribeWithWorktualStt(input: {
  bytes: Buffer;
  mimeType?: string | null;
  filename?: string | null;
}): Promise<WorktualSttResult> {
  const { baseUrl, apiKey, model } = sttConfig();
  if (!baseUrl) {
    return {
      ok: false,
      error: "Worktual STT is not configured (set WORKTUAL_STT_BASE_URL).",
    };
  }
  if (!input.bytes?.length) {
    return { ok: false, error: "Empty audio." };
  }

  const mime =
    (input.mimeType || "audio/wav").split(";")[0].trim() || "audio/wav";
  const filename =
    input.filename?.trim() || `chunk.${extensionForMime(mime)}`;

  const form = new FormData();
  const fileBytes = new Uint8Array(input.bytes);
  const filePart =
    typeof File !== "undefined"
      ? new File([fileBytes], filename, { type: mime })
      : new Blob([fileBytes], { type: mime });
  form.append("file", filePart, filename);
  form.append("model", model);
  form.append("response_format", "json");
  form.append("temperature", "0");

  try {
    const res = await fetch(`${baseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: form,
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error("Worktual STT failed", res.status, body.slice(0, 400));
      let detail = `STT error ${res.status}`;
      try {
        const parsed = JSON.parse(body) as {
          error?: { message?: string } | string;
        };
        if (typeof parsed.error === "string") detail = parsed.error;
        else if (parsed.error?.message) detail = parsed.error.message;
      } catch {
        /* keep detail */
      }
      return { ok: false, error: detail };
    }
    const data = (await res.json()) as { text?: string };
    const text = (data.text || "").trim();
    if (!text) return { ok: false, error: "STT returned empty text." };
    return { ok: true, text };
  } catch (err) {
    console.error("Worktual STT request error", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "STT request failed",
    };
  }
}
