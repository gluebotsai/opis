/** Dedupe keys for live captions (duplicate PCM paths may reuse text with new segment ids). */

export function normalizeLiveCaptionText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 160);
}

export function liveUtteranceSyncKey(
  speaker: string | null | undefined,
  text: string,
): string {
  const who = (speaker || "Unknown").trim().toLowerCase();
  return `utt::${who}::${normalizeLiveCaptionText(text)}`;
}

/** Collapse consecutive duplicate `Speaker: text` lines (meeting-service segment dupes). */
export function dedupeSpeakerTextTranscript(body: string): string {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase().replace(/\s+/g, " ");
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(trimmed);
  }
  return lines.join("\n");
}
