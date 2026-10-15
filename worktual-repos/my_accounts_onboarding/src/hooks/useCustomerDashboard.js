import { useCallback, useEffect, useState } from "react";

import { loadCustomerPortalData } from "../lib/customerPortal.js";

export function useCustomerDashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const next = await loadCustomerPortalData();
      setData(next);
    } catch (loadError) {
      setData(null);
      setError(loadError instanceof Error ? loadError.message : "Could not load account data.");
    } finally {
      setLoading(false);
    }
  }, []);

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
