import { useCallback, useEffect, useMemo } from "react";

import { useAppDispatch, useAppSelector } from "@/hooks/redux";
import {
  fetchCustomerInteractionsPage,
  INTERACTION_PAGE_SIZE_EXPORT,
  resetInteractionPage,
} from "@/store/slices/workspace-slice";

export function useCustomerInteractions(input?: {
  visitorId?: string;
  contactId?: string | null;
}) {
  const dispatch = useAppDispatch();
  const interactionKey = useMemo(
    () =>
      input?.contactId
        ? `contact:${input.contactId}`
        : input?.visitorId
          ? `visitor:${input.visitorId}`
          : undefined,
    [input?.contactId, input?.visitorId],
  );
  const page = useAppSelector((state) =>
    interactionKey ? state.workspace.interactionPages[interactionKey] : undefined,
  );

  useEffect(() => {
    if (!interactionKey || (!input?.contactId && !input?.visitorId)) return;
    dispatch(resetInteractionPage(interactionKey));
    void dispatch(
      fetchCustomerInteractionsPage({
        visitorId: input?.visitorId,
        contactId: input?.contactId ?? undefined,
        offset: 0,
      }),
    );
  }, [dispatch, input?.contactId, input?.visitorId, interactionKey]);

  const loadMore = useCallback(() => {
    if (!interactionKey || !page?.hasMore || page.loadingMore) return;
    const nextOffset = page.offset + INTERACTION_PAGE_SIZE_EXPORT;
    void dispatch(
      fetchCustomerInteractionsPage({
        visitorId: input?.visitorId,
        contactId: input?.contactId ?? undefined,
        offset: nextOffset,
      }),
    );
  }, [dispatch, input?.contactId, input?.visitorId, interactionKey, page]);

  return {
    history: page?.items ?? [],
    loading: page?.loading ?? false,
    loadingMore: page?.loadingMore ?? false,
    hasMore: page?.hasMore ?? false,
    loadMore,
  };
}
