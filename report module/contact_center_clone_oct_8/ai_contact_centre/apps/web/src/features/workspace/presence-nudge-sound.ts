import type { PresenceNudgeBanner } from "@/features/workspace/presence-nudge-config";
import { PRESENCE_NUDGE_AUDIO } from "@/features/workspace/presence-nudge-config";

const audioCache = new Map<PresenceNudgeBanner, HTMLAudioElement>();

function getAudioElement(banner: PresenceNudgeBanner): HTMLAudioElement {
  const cached = audioCache.get(banner);
  if (cached) return cached;

  const audio = new Audio(PRESENCE_NUDGE_AUDIO[banner]);
  audio.preload = "auto";
  audioCache.set(banner, audio);
  return audio;
}

export async function playPresenceNudgeSound(banner: PresenceNudgeBanner): Promise<void> {
  try {
    const audio = getAudioElement(banner);
    audio.currentTime = 0;
    await audio.play();
  } catch {
    // Audio may be blocked until the user interacts with the page.
  }
}
