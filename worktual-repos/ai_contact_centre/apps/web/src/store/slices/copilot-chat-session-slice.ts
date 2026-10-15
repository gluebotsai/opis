import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

import type { ChatMessage } from "@/features/assistant/copilot-engine";
import type { RootState } from "@/store";
import { logout } from "./auth-slice";

export type CopilotChatSessionState = {
  userId: string | null;
  messages: ChatMessage[];
  input: string;
  loading: boolean;
  streaming: boolean;
  statusLabel: string;
};

const emptySession = (): CopilotChatSessionState => ({
  userId: null,
  messages: [],
  input: "",
  loading: false,
  streaming: false,
  statusLabel: "Ready when you are",
});

const initialState: CopilotChatSessionState = emptySession();

const copilotChatSessionSlice = createSlice({
  name: "copilotChatSession",
  initialState,
  reducers: {
    initializeCopilotChatSession(
      state,
      action: PayloadAction<{ userId: string; welcomeMessage: ChatMessage }>,
    ) {
      if (
        state.userId === action.payload.userId &&
        Array.isArray(state.messages) &&
        state.messages.length > 0
      ) {
        const welcome = state.messages.find((message) => message.id === "welcome");
        if (welcome && welcome.kind === "text") {
          welcome.content = action.payload.welcomeMessage.kind === "text"
            ? action.payload.welcomeMessage.content
            : welcome.content;
        }
        return;
      }
      state.userId = action.payload.userId;
      state.messages = [action.payload.welcomeMessage];
      state.input = "";
      state.loading = false;
      state.streaming = false;
      state.statusLabel = "Ready when you are";
    },
    setCopilotChatMessages(
      state,
      action: PayloadAction<{ userId: string; messages: ChatMessage[] }>,
    ) {
      state.userId = action.payload.userId;
      state.messages = action.payload.messages;
    },
    appendCopilotChatMessage(state, action: PayloadAction<ChatMessage>) {
      if (!Array.isArray(state.messages)) state.messages = [];
      state.messages.push(action.payload);
    },
    updateCopilotChatMessage(
      state,
      action: PayloadAction<{ id: string; patch: Partial<ChatMessage> }>,
    ) {
      if (!Array.isArray(state.messages)) return;
      const index = state.messages.findIndex((message) => message.id === action.payload.id);
      if (index === -1) return;
      state.messages[index] = {
        ...state.messages[index],
        ...action.payload.patch,
      } as ChatMessage;
    },
    applyCopilotChatMessages(
      state,
      action: PayloadAction<ChatMessage[] | ((messages: ChatMessage[]) => ChatMessage[])>,
    ) {
      const current = Array.isArray(state.messages) ? state.messages : [];
      state.messages =
        typeof action.payload === "function" ? action.payload(current) : action.payload;
    },
    setCopilotChatInput(state, action: PayloadAction<string>) {
      state.input = action.payload;
    },
    setCopilotRunnerState(
      state,
      action: PayloadAction<Partial<Pick<CopilotChatSessionState, "loading" | "streaming" | "statusLabel">>>,
    ) {
      if (action.payload.loading !== undefined) state.loading = action.payload.loading;
      if (action.payload.streaming !== undefined) state.streaming = action.payload.streaming;
      if (action.payload.statusLabel !== undefined) state.statusLabel = action.payload.statusLabel;
    },
    clearCopilotChatSession: () => emptySession(),
  },
  extraReducers(builder) {
    builder.addCase(logout, () => emptySession());
  },
});

export const {
  initializeCopilotChatSession,
  setCopilotChatMessages,
  appendCopilotChatMessage,
  updateCopilotChatMessage,
  applyCopilotChatMessages,
  setCopilotChatInput,
  setCopilotRunnerState,
  clearCopilotChatSession,
} = copilotChatSessionSlice.actions;

export const copilotChatSessionReducer = copilotChatSessionSlice.reducer;

export const selectCopilotChatSession = (state: RootState) => state.copilotChatSession;
