import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TTS_URL = "http://173.234.75.165:7024/tts";
const SAMPLE_RATE = 24_000;
const CHANNELS = 1;
const BITS_PER_SAMPLE = 16;

const REMINDERS = [
  {
    file: "post-login.wav",
    sessionId: "presence-nudge-post-login",
    text: "You've been logged in as Not Ready for sixty seconds. Switch to Ready to receive customer conversations.",
  },
  {
    file: "not-ready-10min.wav",
    sessionId: "presence-nudge-not-ready-10min",
    text: "You have been Not Ready for ten minutes. Go Ready now or your supervisor will be notified.",
  },
  {
    file: "not-ready-snooze.wav",
    sessionId: "presence-nudge-not-ready-snooze",
    text: "Still Not Ready. Go Ready now or your supervisor will be notified.",
  },
];

function pcmToWav(pcm) {
  const byteRate = (SAMPLE_RATE * CHANNELS * BITS_PER_SAMPLE) / 8;
  const blockAlign = (CHANNELS * BITS_PER_SAMPLE) / 8;
  const header = Buffer.alloc(44);

  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(CHANNELS, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(BITS_PER_SAMPLE, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);

  return Buffer.concat([header, pcm]);
}

async function synthesizeReminder({ file, sessionId, text }) {
  const response = await fetch(TTS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, session_id: sessionId }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`TTS failed for ${file}: HTTP ${response.status} ${body}`);
  }

  const pcm = Buffer.from(await response.arrayBuffer());
  if (pcm.length === 0) {
    throw new Error(`TTS returned empty audio for ${file}`);
  }

  return pcmToWav(pcm);
}

async function main() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const outputDir = path.resolve(scriptDir, "../public/audio/presence-nudges");
  await mkdir(outputDir, { recursive: true });

  for (const reminder of REMINDERS) {
    const wav = await synthesizeReminder(reminder);
    const outputPath = path.join(outputDir, reminder.file);
    await writeFile(outputPath, wav);
    console.log(`Wrote ${outputPath} (${wav.length} bytes)`);
  }
}

await main();
