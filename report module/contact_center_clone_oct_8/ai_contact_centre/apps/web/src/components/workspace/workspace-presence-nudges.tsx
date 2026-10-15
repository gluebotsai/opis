import { InfoCircleOutlined } from "@ant-design/icons";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import type { PresenceState } from "@/features/workspace/api";
import { workspaceApi } from "@/features/workspace/api";
import { PRESENCE_NUDGE } from "@/features/workspace/presence-nudge-config";
import { playPresenceNudgeSound } from "@/features/workspace/presence-nudge-sound";
import {
  clearNotReadyBannerSnooze,
  getNotReadyBannerStage,
  isNotReadyBannerSnoozed,
  isReadyPromptHandled,
  markReadyPromptHandled,
  setNotReadyBannerStage,
  snoozeNotReadyBanner,
  type NotReadyBannerStage,
} from "@/features/workspace/presence-session";

type WorkspacePresenceNudgesProps = {
  presenceState: PresenceState;
  setPresence: (state: PresenceState) => Promise<void>;
};

type BannerMode = "first" | "second" | null;
type ActiveBanner = "post-login" | BannerMode;

function formatCountdown(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function resolveBannerMode(
  presenceState: PresenceState,
  notReadyForMs: number,
  stage: NotReadyBannerStage,
): BannerMode {
  if (presenceState !== "not_ready") return null;
  if (stage === "completed") return null;
  if (notReadyForMs < PRESENCE_NUDGE.NOT_READY_BANNER_MS) return null;

  if (stage === "none") return "first";
  if (stage === "first-shown") return "first";
  if (stage === "snoozed") {
    return isNotReadyBannerSnoozed() ? null : "second";
  }
  if (stage === "second-shown") return "second";
  return null;
}

export function WorkspacePresenceNudges({
  presenceState,
  setPresence,
}: WorkspacePresenceNudgesProps) {
  const [postLoginBanner, setPostLoginBanner] = useState(false);
  const [bannerMode, setBannerMode] = useState<BannerMode>(null);
  const [submitting, setSubmitting] = useState(false);
  const presenceRef = useRef(presenceState);
  const previousPresenceRef = useRef(presenceState);
  const notReadySinceRef = useRef<number | null>(null);
  const bannerSoundKeyRef = useRef<string | null>(null);
  const bannerActionDeadlineRef = useRef<number | null>(null);
  const autoEscalatedRef = useRef(false);
  const previousActiveBannerRef = useRef<ActiveBanner | null>(null);
  const [actionSecondsLeft, setActionSecondsLeft] = useState<number | null>(null);

  useEffect(() => {
    const previous = previousPresenceRef.current;
    previousPresenceRef.current = presenceState;
    presenceRef.current = presenceState;

    if (presenceState === "not_ready") {
      if (previous !== "not_ready") {
        notReadySinceRef.current = Date.now();
        setNotReadyBannerStage("none");
        clearNotReadyBannerSnooze();
        setBannerMode(null);
        bannerSoundKeyRef.current = null;
      } else if (notReadySinceRef.current == null) {
        notReadySinceRef.current = Date.now();
      }
      return;
    }

    if (presenceState === "ready") {
      // The post-login prompt is only for an agent who never became Ready
      // after login. Returning to Not Ready later must use the regular banner.
      markReadyPromptHandled();
    }

    notReadySinceRef.current = null;
    setPostLoginBanner(false);
    setBannerMode(null);
    bannerSoundKeyRef.current = null;
    setNotReadyBannerStage("none");
    clearNotReadyBannerSnooze();
  }, [presenceState]);

  useEffect(() => {
    if (isReadyPromptHandled()) return;
    if (presenceState !== "not_ready") return;

    const timer = window.setTimeout(() => {
      if (isReadyPromptHandled()) return;
      if (presenceRef.current !== "not_ready") return;
      setPostLoginBanner(true);
    }, PRESENCE_NUDGE.POST_LOGIN_MS);

    return () => window.clearTimeout(timer);
  }, [presenceState]);

  useEffect(() => {
    if (presenceState !== "not_ready") return;

    const syncBanner = () => {
      if (presenceRef.current !== "not_ready") {
        setBannerMode(null);
        return;
      }
      if (postLoginBanner) {
        setBannerMode(null);
        return;
      }

      const notReadySince = notReadySinceRef.current ?? Date.now();
      const notReadyForMs = Date.now() - notReadySince;
      const stage = getNotReadyBannerStage();
      const nextMode = resolveBannerMode(presenceRef.current, notReadyForMs, stage);
      setBannerMode(nextMode);

      if (nextMode === "first" && stage === "none") {
        setNotReadyBannerStage("first-shown");
      }
      if (nextMode === "second" && stage === "snoozed") {
        clearNotReadyBannerSnooze();
        setNotReadyBannerStage("second-shown");
      }
    };

    syncBanner();
    const interval = window.setInterval(syncBanner, 15_000);
    return () => window.clearInterval(interval);
  }, [presenceState, postLoginBanner]);

  const activeBanner: ActiveBanner | null = postLoginBanner ? "post-login" : bannerMode;

  useEffect(() => {
    if (!activeBanner) {
      bannerSoundKeyRef.current = null;
      return;
    }
    if (bannerSoundKeyRef.current === activeBanner) return;
    bannerSoundKeyRef.current = activeBanner;
    void playPresenceNudgeSound(activeBanner);
  }, [activeBanner]);

  async function handleSetReady() {
    setSubmitting(true);
    try {
      await setPresence("ready");
      markReadyPromptHandled();
      setNotReadyBannerStage("completed");
      clearNotReadyBannerSnooze();
      setPostLoginBanner(false);
      setBannerMode(null);
    } finally {
      setSubmitting(false);
    }
  }

  function handlePostLoginDismiss() {
    markReadyPromptHandled();
    setPostLoginBanner(false);
  }

  function handleSnooze() {
    snoozeNotReadyBanner();
    setBannerMode(null);
    bannerSoundKeyRef.current = null;
    bannerActionDeadlineRef.current = null;
    setActionSecondsLeft(null);
    autoEscalatedRef.current = false;
    previousActiveBannerRef.current = null;
  }

  const escalateToSupervisor = useCallback(async () => {
    if (autoEscalatedRef.current) return;
    autoEscalatedRef.current = true;
    setSubmitting(true);
    try {
      await workspaceApi.escalateNotReadyPresence();
      setNotReadyBannerStage("completed");
      setBannerMode(null);
      bannerActionDeadlineRef.current = null;
      setActionSecondsLeft(null);
    } catch {
      // Keep the banner visible and retry instead of silently losing the
      // supervisor notification when the API is temporarily unavailable.
      autoEscalatedRef.current = false;
      bannerActionDeadlineRef.current = Date.now() + 10_000;
      setActionSecondsLeft(10);
    } finally {
      setSubmitting(false);
    }
  }, []);

  useEffect(() => {
    const needsTimer = activeBanner === "first" || activeBanner === "second";
    if (!needsTimer) {
      bannerActionDeadlineRef.current = null;
      setActionSecondsLeft(null);
      if (activeBanner !== previousActiveBannerRef.current) {
        autoEscalatedRef.current = false;
        previousActiveBannerRef.current = activeBanner;
      }
      return;
    }

    if (activeBanner !== previousActiveBannerRef.current) {
      bannerActionDeadlineRef.current = Date.now() + PRESENCE_NUDGE.NOT_READY_BANNER_ACTION_MS;
      autoEscalatedRef.current = false;
      previousActiveBannerRef.current = activeBanner;
    }

    const tick = () => {
      const deadline = bannerActionDeadlineRef.current;
      if (!deadline) return;
      const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setActionSecondsLeft(left);
      if (left === 0) {
        void escalateToSupervisor();
      }
    };

    tick();
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, [activeBanner, escalateToSupervisor]);

  if (!activeBanner) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-[61px] z-[55] flex justify-center px-3 sm:px-4">
      <div
        role="status"
        className="pointer-events-auto flex w-full max-w-3xl items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 shadow-md"
      >
        <InfoCircleOutlined className="shrink-0 text-sm text-amber-600" />
        <p className="min-w-0 flex-1 text-xs text-neutral-700">
          {activeBanner === "post-login" ? (
            <>
              You&apos;ve been logged in as{" "}
              <span className="font-medium text-neutral-900">Not Ready</span> for 60 seconds.
              Switch to Ready to receive customer conversations.
            </>
          ) : activeBanner === "second" ? (
            <>
              Still <span className="font-medium text-neutral-900">Not Ready</span>. Choose an action
              before the timer ends or your supervisor will be notified.
            </>
          ) : (
            <>
              You&apos;ve been <span className="font-medium text-neutral-900">Not Ready</span> for{" "}
              {PRESENCE_NUDGE.NOT_READY_BANNER_MS / 60_000} minutes. Choose an action before the
              timer ends or your supervisor will be notified.
            </>
          )}
        </p>
        {activeBanner !== "post-login" && actionSecondsLeft != null ? (
          <span
            className="shrink-0 rounded-md border border-amber-300 bg-white px-2 py-0.5 font-mono text-xs font-semibold tabular-nums text-amber-900"
            aria-label={`${actionSecondsLeft} seconds remaining`}
          >
            {formatCountdown(actionSecondsLeft)}
          </span>
        ) : null}
        <div className="flex shrink-0 items-center gap-1.5">
          {activeBanner === "first" ? (
            <button
              type="button"
              disabled={submitting}
              onClick={handleSnooze}
              className="rounded-md px-2 py-1 text-xs text-neutral-600 transition hover:bg-amber-100/80 hover:text-neutral-900"
            >
              Snooze {PRESENCE_NUDGE.NOT_READY_SNOOZE_MS / 60_000}m
            </button>
          ) : null}
          <button
            type="button"
            disabled={submitting}
            onClick={
              activeBanner === "post-login"
                ? handlePostLoginDismiss
                : () => void escalateToSupervisor()
            }
            className="rounded-md px-2 py-1 text-xs text-neutral-600 transition hover:bg-amber-100/80 hover:text-neutral-900"
          >
            Stay Not Ready
          </button>
          <Button
            variant="primary"
            disabled={submitting}
            className="h-7 px-2.5 text-xs"
            onClick={() => void handleSetReady()}
          >
            {submitting ? "Updating…" : "Go Ready"}
          </Button>
        </div>
      </div>
    </div>
  );
}
