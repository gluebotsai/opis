import { App } from "antd";
import { useEffect, useRef } from "react";

import { useSipCallStatus } from "@/features/voice/use-sip-call-status";

let lastConsultToastKey = "";

export function useVoiceConsultConnectedToast() {
  const sip = useSipCallStatus();
  const { message } = App.useApp();
  const previousConsultState = useRef(sip.consultState);

  useEffect(() => {
    if (sip.consultState === "active" && previousConsultState.current !== "active") {
      const key = `consult:${sip.conversationId ?? "none"}:${sip.consultExt ?? sip.consultName ?? "agent"}`;
      if (lastConsultToastKey !== key) {
        lastConsultToastKey = key;
        message.success(
          `Connected with ${sip.consultName ?? "the other agent"}. You can Transfer or Merge.`,
        );
      }
    }
    previousConsultState.current = sip.consultState;

    if (sip.inboundTransferOffer && sip.callState === "active") {
      const key = `transferee:${sip.conversationId ?? sip.acdSessionId ?? "active"}`;
      if (lastConsultToastKey !== key) {
        lastConsultToastKey = key;
        message.success("Connected with the transferring agent.");
      }
    }
  }, [
    message,
    sip.acdSessionId,
    sip.callState,
    sip.consultExt,
    sip.consultName,
    sip.consultState,
    sip.conversationId,
    sip.inboundTransferOffer,
  ]);
}
