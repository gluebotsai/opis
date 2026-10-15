/** PCM16 mono → WAV → Worktual OpenAI-compatible transcriptions. */

function encodeWav(pcm: Buffer, sampleRate: number): Buffer {
  const dataSize = pcm.length;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  pcm.copy(buffer, 44);
  return buffer;
}

export async function transcribePcm16(input: {
  pcm: Buffer;
  sampleRate?: number;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
}): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const baseUrl = (
    input.baseUrl ||
    process.env.WORKTUAL_STT_BASE_URL ||
    ""
  )
    .trim()
    .replace(/\/$/, "");
  if (!baseUrl) {
    return { ok: false, error: "WORKTUAL_STT_BASE_URL not set" };
  }
  const apiKey = (input.apiKey || process.env.WORKTUAL_STT_API_KEY || "EMPTY").trim();
  const model = (
    input.model ||
    process.env.WORKTUAL_STT_MODEL ||
    "worktual-large-v3"
  ).trim();
  const sampleRate = input.sampleRate || 16_000;
  const wav = encodeWav(input.pcm, sampleRate);

  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(wav)], { type: "audio/wav" }),
    "customer.wav",
  );
  form.append("model", model);
  form.append("response_format", "json");
  form.append("temperature", "0");

  try {
    const res = await fetch(`${baseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `STT ${res.status}: ${body.slice(0, 200)}` };
    }
    const data = (await res.json()) as { text?: string };
    const text = (data.text || "").trim();
    if (!text) return { ok: false, error: "Empty transcript" };
    return { ok: true, text };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "STT failed",
    };
  }
}
