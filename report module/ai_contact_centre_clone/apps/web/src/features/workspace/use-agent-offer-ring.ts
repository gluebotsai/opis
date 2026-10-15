import { useEffect, useRef } from "react";

function playRingPulse(audioContext: AudioContext, startAt: number) {
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(440, startAt);
  oscillator.frequency.setValueAtTime(480, startAt + 0.2);
  oscillator.frequency.setValueAtTime(440, startAt + 0.4);
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(0.18, startAt + 0.05);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.9);
  oscillator.connect(gain);
  gain.connect(audioContext.destination);
  oscillator.start(startAt);
  oscillator.stop(startAt + 0.95);
}

export function useAgentOfferRing(active: boolean): void {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    if (!active) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      void audioContextRef.current?.close();
      audioContextRef.current = null;
      return;
    }

    const audioContext = new AudioContext();
    audioContextRef.current = audioContext;

    const ring = () => {
      if (audioContext.state === "suspended") {
        void audioContext.resume();
      }
      const now = audioContext.currentTime;
      playRingPulse(audioContext, now);
      playRingPulse(audioContext, now + 1);
    };

    ring();
    intervalRef.current = setInterval(ring, 3000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      void audioContext.close();
      audioContextRef.current = null;
    };
  }, [active]);
}
