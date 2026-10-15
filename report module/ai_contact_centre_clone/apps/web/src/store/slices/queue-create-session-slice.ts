import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

import type { ChatMessage } from "@/features/assistant/copilot-engine";
import type { RootState } from "@/store";
import type { QueueDraft } from "@/features/workforce/queues/types";

export const QUEUE_CREATE_SESSION_STORAGE_KEY = "cc2_queue_create_session";

export type QueueCreateSessionState = {
  active: boolean;
  draft: QueueDraft;
  messages: ChatMessage[];
};

const emptySession = (): QueueCreateSessionState => ({
  active: false,
  draft: {},
  messages: [],
});

function isQueueDraft(value: unknown): value is QueueDraft {
  return Boolean(value) && typeof value === "object";
}

function isChatMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as ChatMessage;
  return (
    typeof message.id === "string" &&
    typeof message.createdAt === "string" &&
    (message.kind === "text" || message.kind === "tool")
  );
}

export function readStoredQueueCreateSession(): QueueCreateSessionState {
  if (typeof window === "undefined") return emptySession();

  try {
    const raw = sessionStorage.getItem(QUEUE_CREATE_SESSION_STORAGE_KEY);
    if (!raw) return emptySession();

    const parsed = JSON.parse(raw) as Partial<QueueCreateSessionState>;
    const draft = isQueueDraft(parsed.draft) ? parsed.draft : {};
    const messages = Array.isArray(parsed.messages)
      ? parsed.messages.filter(isChatMessage)
      : [];

    return {
      active: Boolean(parsed.active && draft.guided),
      draft,
      messages,
    };
  } catch {
    return emptySession();
  }
}

function writeStoredQueueCreateSession(state: QueueCreateSessionState) {
  if (typeof window === "undefined") return;

  if (!state.active || !state.draft.guided) {
    sessionStorage.removeItem(QUEUE_CREATE_SESSION_STORAGE_KEY);
    return;
  }

  sessionStorage.setItem(QUEUE_CREATE_SESSION_STORAGE_KEY, JSON.stringify(state));
}

const initialState: QueueCreateSessionState = readStoredQueueCreateSession();

const queueCreateSessionSlice = createSlice({
  name: "queueCreateSession",
  initialState,
  reducers: {
    patchQueueDraft(state, action: PayloadAction<QueueDraft>) {
      state.draft = { ...state.draft, ...action.payload };
      if (state.draft.guided) {
        state.active = true;
      }
      writeStoredQueueCreateSession(state);
    },
    setQueueCreateMessages(state, action: PayloadAction<ChatMessage[]>) {
      state.messages = action.payload;
      if (state.draft.guided) {
        state.active = true;
      }
      writeStoredQueueCreateSession(state);
    },
    clearQueueCreateSession(state) {
      state.active = false;
      state.draft = {};
      state.messages = [];
      if (typeof window !== "undefined") {
        sessionStorage.removeItem(QUEUE_CREATE_SESSION_STORAGE_KEY);
      }
    },
  },
});

export const { patchQueueDraft, setQueueCreateMessages, clearQueueCreateSession } =
  queueCreateSessionSlice.actions;

export const queueCreateSessionReducer = queueCreateSessionSlice.reducer;

export const selectQueueDraft = (state: RootState) => state.queueCreateSession.draft;

export const selectQueueCreateSession = (state: RootState) => state.queueCreateSession;
