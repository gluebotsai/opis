import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";

import type { QueueDraft } from "@/features/workforce/queues/types";
import { useAppDispatch, useAppSelector } from "@/hooks/redux";
import {
  clearQueueCreateSession,
  patchQueueDraft,
  selectQueueDraft,
} from "@/store/slices/queue-create-session-slice";

export const ASSISTANT_QUEUE_DRAFT_APPLY = "assistant:queue-draft-apply";

type QueueDraftContextValue = {
  draft: QueueDraft;
  setDraft: (patch: QueueDraft) => void;
  clearDraft: () => void;
  applyDraftEvent: (draft: QueueDraft) => void;
};

const QueueDraftContext = createContext<QueueDraftContextValue | null>(null);

export function QueueDraftProvider({ children }: { children: ReactNode }) {
  const dispatch = useAppDispatch();
  const draft = useAppSelector(selectQueueDraft);

  const setDraft = useCallback(
    (patch: QueueDraft) => {
      dispatch(patchQueueDraft(patch));
    },
    [dispatch],
  );

  const clearDraft = useCallback(() => {
    dispatch(clearQueueCreateSession());
  }, [dispatch]);

  const applyDraftEvent = useCallback(
    (next: QueueDraft) => {
      dispatch(patchQueueDraft(next));
      window.dispatchEvent(new CustomEvent(ASSISTANT_QUEUE_DRAFT_APPLY, { detail: next }));
    },
    [dispatch],
  );

  const value = useMemo(
    () => ({ draft, setDraft, clearDraft, applyDraftEvent }),
    [applyDraftEvent, clearDraft, draft, setDraft],
  );

  return <QueueDraftContext.Provider value={value}>{children}</QueueDraftContext.Provider>;
}

export function useQueueDraft() {
  const ctx = useContext(QueueDraftContext);
  if (!ctx) {
    throw new Error("useQueueDraft must be used within QueueDraftProvider");
  }
  return ctx;
}
