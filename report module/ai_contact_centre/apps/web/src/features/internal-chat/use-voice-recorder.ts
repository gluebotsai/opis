import { useCallback, useEffect, useRef, useState } from "react";

export type VoiceRecordingResult = {
  blob: Blob;
  durationMs: number;
  mimeType: string;
};

function getSupportedMimeType(): string | undefined {
  const types = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  for (const type of types) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return undefined;
}

function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}

export function formatVoiceDuration(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function useVoiceRecorder() {
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef<number | null>(null);
  const totalPausedMsRef = useRef(0);
  const pausedAtRef = useRef<number | null>(null);

  const [active, setActive] = useState(false);
  const [paused, setPaused] = useState(false);
  const [recordingMs, setRecordingMs] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const getElapsedMs = useCallback(() => {
    const startedAt = startedAtRef.current;
    if (!startedAt) return 0;

    if (pausedAtRef.current) {
      return pausedAtRef.current - startedAt - totalPausedMsRef.current;
    }

    return Date.now() - startedAt - totalPausedMsRef.current;
  }, []);

  const resetSession = useCallback(() => {
    stopStream(streamRef.current);
    streamRef.current = null;
    mediaRecorderRef.current = null;
    chunksRef.current = [];
    startedAtRef.current = null;
    totalPausedMsRef.current = 0;
    pausedAtRef.current = null;
    setActive(false);
    setPaused(false);
    setRecordingMs(0);
  }, []);

  const start = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Voice recording is not supported in this browser.");
      return false;
    }

    setError(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = getSupportedMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);

      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };

      streamRef.current = stream;
      mediaRecorderRef.current = recorder;
      startedAtRef.current = Date.now();
      totalPausedMsRef.current = 0;
      pausedAtRef.current = null;
      setRecordingMs(0);
      recorder.start(200);
      setPaused(false);
      setActive(true);
      return true;
    } catch {
      resetSession();
      setError("Microphone access denied. Allow microphone permission to record voice messages.");
      return false;
    }
  }, [resetSession]);

  const pause = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state !== "recording" || pausedAtRef.current) return;

    recorder.pause();
    pausedAtRef.current = Date.now();
    setRecordingMs(getElapsedMs());
    setPaused(true);
  }, [getElapsedMs]);

  const resume = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state !== "paused" || !pausedAtRef.current) return;

    totalPausedMsRef.current += Date.now() - pausedAtRef.current;
    pausedAtRef.current = null;
    recorder.resume();
    setPaused(false);
  }, []);

  const cancel = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.onstop = () => resetSession();
      recorder.stop();
      return;
    }
    resetSession();
  }, [resetSession]);

  const stop = useCallback(() => {
    return new Promise<VoiceRecordingResult | null>((resolve) => {
      const recorder = mediaRecorderRef.current;
      const startedAt = startedAtRef.current;

      if (!recorder || !startedAt || recorder.state === "inactive") {
        resetSession();
        resolve(null);
        return;
      }

      const durationMs = getElapsedMs();

      recorder.onstop = () => {
        const mimeType = recorder.mimeType || chunksRef.current[0]?.type || "audio/webm";
        const blob = new Blob(chunksRef.current, { type: mimeType });
        resetSession();

        if (blob.size === 0 || durationMs < 500) {
          resolve(null);
          return;
        }

        resolve({ blob, durationMs, mimeType });
      };

      recorder.stop();
    });
  }, [getElapsedMs, resetSession]);

  useEffect(() => {
    if (!active || paused) return;

    const id = window.setInterval(() => {
      setRecordingMs(getElapsedMs());
    }, 200);

    return () => window.clearInterval(id);
  }, [active, paused, getElapsedMs]);

  useEffect(() => () => resetSession(), [resetSession]);

  return {
    active,
    paused,
    recordingMs,
    error,
    start,
    pause,
    resume,
    stop,
    cancel,
    clearError: () => setError(null),
  };
}
