import { useEffect, useState } from "react";

import { workspaceApi } from "@/features/workspace/api";
import type { CustomerTicket } from "@/features/workspace/types";

export function useCustomerTickets(contactId?: string | null) {
  const [tickets, setTickets] = useState<CustomerTicket[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!contactId) {
      setTickets([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setTickets([]);
    setLoading(true);
    void workspaceApi
      .getCustomerTickets(contactId)
      .then((next) => {
        if (!cancelled) setTickets(next);
      })
      .catch(() => {
        if (!cancelled) setTickets([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [contactId]);

  return { tickets, loading };
}
