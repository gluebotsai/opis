import { useEffect, useState } from "react";

import { workspaceApi } from "@/features/workspace/api";

export function useOmniChannelSummary(contactId?: string | null) {
  const [summary, setSummary] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!contactId) {
      setSummary(null);
      setUpdatedAt(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setSummary(null);
    setUpdatedAt(null);
    setLoading(true);
    void workspaceApi
      .getContactOmniChannelSummary(contactId)
      .then((result) => {
        if (cancelled) return;
        setSummary(result.omniChannelSummary);
        setUpdatedAt(result.updatedAt);
      })
      .catch(() => {
        if (cancelled) return;
        setSummary(null);
        setUpdatedAt(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [contactId]);

  return { summary, updatedAt, loading };
}
