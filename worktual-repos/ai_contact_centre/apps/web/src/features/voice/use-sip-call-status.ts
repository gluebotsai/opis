import { useSyncExternalStore } from "react";

import {
  getSipCallStatus,
  subscribeSipCallStatus,
  type SipCallStatus,
} from "@/features/voice/sip-ua";

export function useSipCallStatus(): SipCallStatus {
  return useSyncExternalStore(subscribeSipCallStatus, getSipCallStatus, getSipCallStatus);
}
