import { useEffect } from "react";

import { apiV1 } from "@/config/api-paths";
import { env } from "@/config/env";
import {
  endLiveSipSessionsOnPageExit,
  getSipCallStatus,
  startSipRegistration,
  stopSipRegistration,
} from "@/features/voice/sip-ua";
import { useAppSelector } from "@/hooks/redux";
import { readAuthFromStorage } from "@/services/http";

function notifyBrowserDisconnected(conversationId: string): void {
  const auth = readAuthFromStorage();
  if (!auth.token) return;
  const base = env.ccCoreUrl.replace(/\/$/, "");
  void fetch(`${base}${apiV1("/workspace/voice-call/browser-disconnected")}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${auth.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ conversationId }),
    keepalive: true,
  }).catch(() => undefined);
}

export function SipRegistrationHost() {
  const userId = useAppSelector((state) => state.auth.user?.id);
  const token = useAppSelector((state) => state.auth.user?.token);

  useEffect(() => {
    if (!userId || !token) {
      void stopSipRegistration();
      return;
    }
    void startSipRegistration();
    const handleBeforeUnload = () => {
      endLiveSipSessionsOnPageExit();
    };
    const handlePageHide = (event: PageTransitionEvent) => {
      if (event.persisted) return;
      endLiveSipSessionsOnPageExit();
      const call = getSipCallStatus();
      if (!call.conversationId) return;
      if (call.callState !== "active" && !call.awaitingDisposition) return;
      notifyBrowserDisconnected(call.conversationId);
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("pagehide", handlePageHide);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("pagehide", handlePageHide);
      void stopSipRegistration();
    };
  }, [userId, token]);

  return null;
}
