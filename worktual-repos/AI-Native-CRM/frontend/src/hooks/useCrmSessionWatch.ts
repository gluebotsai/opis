import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  CRM_SESSION_REVOKED_EVENT,
  notifyCrmSessionRevoked,
} from "@/lib/crm-session-revoked";
import { clearCoworkerClientStorage } from "@/lib/coworker/coworker-client-storage";
import { clearNavReturnStorage } from "@/lib/nav-return";
import { clearAllListCaches } from "@/lib/list-cache";
import { logoutRequest } from "@/services/auth";
import { setUser, useAppDispatch, useAppSelector } from "@/store";

const HEALTHY_STREAM_POLL_MS = 30_000;
const STREAM_DOWN_POLL_MS = 3_000;
const MIN_VERIFY_GAP_MS = 2_000;

/**
 * Live sign-out when another browser force-signs into CRM (same product).
 */
export function useCrmSessionWatch() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const userId = useAppSelector((s) => s.auth.user?.id);
  const signingOutRef = useRef(false);

  useEffect(() => {
    const signOut = () => {
      if (signingOutRef.current) return;
      signingOutRef.current = true;
      clearCoworkerClientStorage();
      clearNavReturnStorage();
    clearAllListCaches();
      dispatch(setUser(null));
      navigate("/login?reason=signed-in-elsewhere", { replace: true });
      void logoutRequest().finally(() => {
        signingOutRef.current = false;
      });
    };

    window.addEventListener(CRM_SESSION_REVOKED_EVENT, signOut);
    return () => window.removeEventListener(CRM_SESSION_REVOKED_EVENT, signOut);
  }, [dispatch, navigate]);

  useEffect(() => {
    if (!userId) return;

    let cancelled = false;
    let streamOpen = false;
    let streamErrorHandled = false;
    let pollTimer: number | null = null;
    let lastVerifyAt = 0;
    let verifyInFlight: Promise<void> | null = null;

    const verifyStillSignedIn = (force = false): Promise<void> => {
      if (cancelled) return Promise.resolve();
      if (verifyInFlight) return verifyInFlight;
      const now = Date.now();
      if (!force && now - lastVerifyAt < MIN_VERIFY_GAP_MS) {
        return Promise.resolve();
      }
      lastVerifyAt = now;
      verifyInFlight = (async () => {
        try {
          const res = await fetch(`/api/auth/me?_=${Date.now()}`, {
            credentials: "include",
            cache: "no-store",
            headers: { Accept: "application/json" },
          });
          if (cancelled) return;
          let body: { ok?: boolean; statusCode?: number; code?: string } = {};
          try {
            body = (await res.json()) as typeof body;
          } catch {
            body = {};
          }
          // A backend restart or temporary proxy/database failure must not be
          // interpreted as "signed in elsewhere". Only an explicit auth
          // rejection is authoritative; all 5xx/network failures are retried.
          const revoked =
            res.status === 401 ||
            body.statusCode === 401 ||
            body.code === "session_revoked_elsewhere";
          if (revoked) notifyCrmSessionRevoked();
        } catch {
          /* network blip */
        } finally {
          verifyInFlight = null;
        }
      })();
      return verifyInFlight;
    };

    const schedulePoll = (delay: number) => {
      if (pollTimer != null) window.clearTimeout(pollTimer);
      pollTimer = window.setTimeout(async () => {
        await verifyStillSignedIn();
        if (!cancelled) {
          schedulePoll(
            streamOpen ? HEALTHY_STREAM_POLL_MS : STREAM_DOWN_POLL_MS,
          );
        }
      }, delay);
    };

    void verifyStillSignedIn();
    schedulePoll(STREAM_DOWN_POLL_MS);

    const es = new EventSource("/api/auth/session-events", {
      withCredentials: true,
    });
    es.onopen = () => {
      streamOpen = true;
      streamErrorHandled = false;
      schedulePoll(HEALTHY_STREAM_POLL_MS);
    };

    const onRevoked = () => {
      notifyCrmSessionRevoked();
    };

    es.addEventListener("revoked", onRevoked as EventListener);
    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(String(ev.data)) as { code?: string };
        if (data.code === "session_revoked_elsewhere") {
          notifyCrmSessionRevoked();
        }
      } catch {
        /* ping / ready */
      }
    };
    es.addEventListener("error", () => {
      streamOpen = false;
      if (streamErrorHandled) return;
      streamErrorHandled = true;
      void verifyStillSignedIn();
      schedulePoll(STREAM_DOWN_POLL_MS);
    });

    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void verifyStillSignedIn(true);
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      if (pollTimer != null) window.clearTimeout(pollTimer);
      document.removeEventListener("visibilitychange", onVisible);
      es.close();
    };
  }, [userId]);
}
