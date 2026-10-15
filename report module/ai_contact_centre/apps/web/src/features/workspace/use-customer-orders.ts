import { useEffect, useState } from "react";

import { workspaceApi } from "@/features/workspace/api";
import type { CustomerOrder } from "@/features/workspace/types";

export function useCustomerOrders(contactId?: string | null) {
  const [orders, setOrders] = useState<CustomerOrder[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!contactId) {
      setOrders([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setOrders([]);
    setLoading(true);
    void workspaceApi
      .getCustomerOrders(contactId)
      .then((next) => {
        if (!cancelled) setOrders(next);
      })
      .catch(() => {
        if (!cancelled) setOrders([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [contactId]);

  return { orders, loading };
}
