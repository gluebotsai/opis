import { useEffect, useRef } from "react";

/**
 * Idle timeout before auto logout → login screen (non-admin shells).
 * AdminShell does not use idle logout.
 */
export const IDLE_SESSION_TIMEOUT_MS = 120 * 60 * 1000;

export const SESSION_EXPIRED_LOGIN_URL = "/?reason=session-expired";

const ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "touchstart", "scroll", "wheel"];

/**
 * Calls onIdle once after IDLE_SESSION_TIMEOUT_MS with no user interaction.
 * Interaction resets the timer.
 */
export function useSessionIdleLogout(onIdle) {
  const onIdleRef = useRef(onIdle);
  onIdleRef.current = onIdle;

  useEffect(() => {
    let timerId = null;
    let fired = false;
    let lastScheduleAt = 0;

    function schedule() {
      if (fired) {
        return;
      }
      if (timerId) {
        clearTimeout(timerId);
      }
      timerId = window.setTimeout(() => {
        if (fired) {
          return;
        }
        fired = true;
        void Promise.resolve(onIdleRef.current?.());
      }, IDLE_SESSION_TIMEOUT_MS);
    }

    function onActivity() {
      if (fired) {
        return;
      }
      const now = Date.now();
      // Throttle timer resets; mousemove is high-frequency.
      if (now - lastScheduleAt < 1000) {
        return;
      }
      lastScheduleAt = now;
      schedule();
    }

    function onVisibility() {
      if (document.visibilityState === "visible") {
        onActivity();
      }
    }

    schedule();
    for (const eventName of ACTIVITY_EVENTS) {
      window.addEventListener(eventName, onActivity, { passive: true });
    }
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      if (timerId) {
        clearTimeout(timerId);
      }
      for (const eventName of ACTIVITY_EVENTS) {
        window.removeEventListener(eventName, onActivity);
      }
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);
}

export function redirectToLoginAfterIdle() {
  window.location.assign(SESSION_EXPIRED_LOGIN_URL);
}
