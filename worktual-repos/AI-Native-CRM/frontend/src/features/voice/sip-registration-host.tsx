import { useEffect } from "react";
import { startSipRegistration, stopSipRegistration } from "@/features/voice/sip-ua";
import { useAppSelector } from "@/store";

/** Registers the signed-in agent with the audio gateway. Renders nothing. */
export function SipRegistrationHost() {
  const userId = useAppSelector((state) => state.auth.user?.id);

  useEffect(() => {
    if (!userId) {
      void stopSipRegistration();
      return;
    }
    void startSipRegistration();
    return () => {
      void stopSipRegistration();
    };
  }, [userId]);

  return null;
}
