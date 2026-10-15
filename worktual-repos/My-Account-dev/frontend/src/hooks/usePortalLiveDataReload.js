import { useEffect } from "react";

import {
  shouldRefreshPortalForEvent,
  subscribePortalLiveRefresh,
} from "../lib/portalLiveRefresh.js";

/** Debounced reload helper for partner/reseller pages. */
export function usePortalLiveDataReload(reloadFn, { leadId = null } = {}) {
  useEffect(() => {
    if (typeof reloadFn !== "function") {
      return undefined;
    }

    let reloadTimer = null;

    const unsubscribe = subscribePortalLiveRefresh((payload) => {
      const eventName = String(payload?.event || "");
      if (!shouldRefreshPortalForEvent(eventName)) {
        return;
      }
      if (leadId && payload.leadId && String(payload.leadId) !== String(leadId)) {
        return;
      }

      if (reloadTimer) {
        window.clearTimeout(reloadTimer);
      }
      reloadTimer = window.setTimeout(() => {
        reloadFn(payload);
      }, 500);
    });

    return () => {
      if (reloadTimer) {
        window.clearTimeout(reloadTimer);
      }
      unsubscribe();
    };
  }, [reloadFn, leadId]);
}
