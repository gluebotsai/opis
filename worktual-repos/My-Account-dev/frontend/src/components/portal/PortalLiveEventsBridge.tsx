// @ts-nocheck
import { useEffect } from "react";

import { subscribeToAppEventsWithReconnect } from "../../lib/eventStream.js";
import {
  dispatchPortalLiveRefresh,
  shouldRefreshPortalForEvent,
} from "../../lib/portalLiveRefresh.js";

const PARTNER_CHANNELS = ["quotations", "payments", "commissions"];
const RESELLER_CHANNELS = ["quotations", "payments"];

export function PortalLiveEventsBridge({ mode = "partner" }) {
  useEffect(() => {
    const channels = mode === "reseller" ? RESELLER_CHANNELS : PARTNER_CHANNELS;

    return subscribeToAppEventsWithReconnect({
      channels,
      onEvent: (payload) => {
        const eventName = String(payload?.event || "");
        if (!shouldRefreshPortalForEvent(eventName)) {
          return;
        }
        dispatchPortalLiveRefresh(payload);
      },
    });
  }, [mode]);

  return null;
}
