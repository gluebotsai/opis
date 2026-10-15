import { useCallback, useEffect, useState } from "react";

import { loadCustomerPortalData } from "../lib/customerPortal.js";

export function useCustomerDashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async ({ silent = false } = {}) => {
    if (!silent) {
      setLoading(true);
    }
    setError("");

    try {
      const next = await loadCustomerPortalData();
      setData(next);
    } catch (loadError) {
      // Keep last-good dashboard on SSE/silent refresh failures so Active products
      // do not flash empty when quotation.approved races a brief API blip.
      if (!silent) {
        setData(null);
      }
      setError(loadError instanceof Error ? loadError.message : "Could not load account data.");
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, []);

  // testing for github

  useEffect(() => {
    refresh();
  }, [refresh]);

  return {
    entitlements: data?.entitlements || null,
    lead: data?.lead || null,
    dashboard: data?.dashboard || null,
    usageBySubscriptionId: data?.usageBySubscriptionId || {},
    loading,
    error,
    refresh,
  };
}
