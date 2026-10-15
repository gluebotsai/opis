import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";

import {
  workspaceApi,
  type ApiMessage,
} from "@/features/workspace/api";
import type { CustomerInteractionHistory } from "@/features/workspace/types";

const MESSAGE_PAGE_SIZE = 30;
const INTERACTION_PAGE_SIZE = 15;

type PaginationMeta = {
  offset: number;
  total: number;
  hasMore: boolean;
};

type MessagePageState = PaginationMeta & {
  loading: boolean;
  loadingMore: boolean;
};

type InteractionPageState = PaginationMeta & {
  items: CustomerInteractionHistory[];
  loading: boolean;
  loadingMore: boolean;
};

export type WorkspaceSliceState = {
  inboxLoading: boolean;
  conversationLoadingId: string | null;
  messagePages: Record<string, MessagePageState>;
  interactionPages: Record<string, InteractionPageState>;
};

const initialPageState = (): MessagePageState => ({
  offset: 0,
  total: 0,
  hasMore: false,
  loading: false,
  loadingMore: false,
});

const initialInteractionState = (): InteractionPageState => ({
  items: [],
  offset: 0,
  total: 0,
  hasMore: false,
  loading: false,
  loadingMore: false,
});

const initialState: WorkspaceSliceState = {
  inboxLoading: true,
  conversationLoadingId: null,
  messagePages: {},
  interactionPages: {},
};

export const fetchConversationMessagesPage = createAsyncThunk(
  "workspace/fetchConversationMessagesPage",
  async (
    {
      conversationId,
      offset,
      limit = MESSAGE_PAGE_SIZE,
      anchor,
    }: {
      conversationId: string;
      offset: number;
      limit?: number;
      anchor?: "start" | "end";
    },
    { rejectWithValue },
  ) => {
    try {
      const page = await workspaceApi.getConversationMessages(
        conversationId,
        offset,
        limit,
        anchor ?? (offset === 0 ? "end" : "start"),
      );
      return { conversationId, ...page };
    } catch (error) {
      return rejectWithValue(
        error instanceof Error ? error.message : "Failed to load messages",
      );
    }
  },
);

export const fetchCustomerInteractionsPage = createAsyncThunk(
  "workspace/fetchCustomerInteractionsPage",
  async (
    {
      visitorId,
      contactId,
      offset,
      limit = INTERACTION_PAGE_SIZE,
    }: { visitorId?: string; contactId?: string; offset: number; limit?: number },
    { rejectWithValue },
  ) => {
    try {
      const interactionKey = contactId ? `contact:${contactId}` : `visitor:${visitorId ?? ""}`;
      const page = await workspaceApi.getCustomerInteractions({ visitorId, contactId }, offset, limit);
      return { interactionKey, ...page };
    } catch (error) {
      return rejectWithValue(
        error instanceof Error ? error.message : "Failed to load interactions",
      );
    }
  },
);

const workspaceSlice = createSlice({
  name: "workspace",
  initialState,
  reducers: {
    setInboxLoading(state, action: { payload: boolean }) {
      state.inboxLoading = action.payload;
    },
    setConversationLoadingId(state, action: { payload: string | null }) {
      state.conversationLoadingId = action.payload;
    },
    resetMessagePage(state, action: { payload: string }) {
      state.messagePages[action.payload] = initialPageState();
    },
    resetInteractionPage(state, action: { payload: string }) {
      state.interactionPages[action.payload] = initialInteractionState();
    },
    appendRealtimeMessage(
      state,
      action: { payload: { conversationId: string; message: ApiMessage } },
    ) {
      const page = state.messagePages[action.payload.conversationId];
      if (!page) return;
      page.total += 1;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchConversationMessagesPage.pending, (state, action) => {
        const { conversationId, offset } = action.meta.arg;
        const current = state.messagePages[conversationId] ?? initialPageState();
        state.messagePages[conversationId] = {
          ...current,
          loading: offset === 0,
          loadingMore: offset > 0,
        };
      })
      .addCase(fetchConversationMessagesPage.fulfilled, (state, action) => {
        const { conversationId, offset, total, hasMore } = action.payload;
        state.messagePages[conversationId] = {
          offset,
          total,
          hasMore,
          loading: false,
          loadingMore: false,
        };
      })
      .addCase(fetchConversationMessagesPage.rejected, (state, action) => {
        const { conversationId } = action.meta.arg;
        const current = state.messagePages[conversationId] ?? initialPageState();
        state.messagePages[conversationId] = {
          ...current,
          loading: false,
          loadingMore: false,
        };
      })
      .addCase(fetchCustomerInteractionsPage.pending, (state, action) => {
        const { visitorId, contactId, offset } = action.meta.arg;
        const interactionKey = contactId ? `contact:${contactId}` : `visitor:${visitorId ?? ""}`;
        const current = state.interactionPages[interactionKey] ?? initialInteractionState();
        state.interactionPages[interactionKey] = {
          ...current,
          loading: offset === 0,
          loadingMore: offset > 0,
        };
      })
      .addCase(fetchCustomerInteractionsPage.fulfilled, (state, action) => {
        const { interactionKey, offset, total, hasMore, interactions } = action.payload;
        const current = state.interactionPages[interactionKey] ?? initialInteractionState();
        state.interactionPages[interactionKey] = {
          items: offset === 0 ? interactions : [...current.items, ...interactions],
          offset,
          total,
          hasMore,
          loading: false,
          loadingMore: false,
        };
      })
      .addCase(fetchCustomerInteractionsPage.rejected, (state, action) => {
        const { visitorId, contactId } = action.meta.arg;
        const interactionKey = contactId ? `contact:${contactId}` : `visitor:${visitorId ?? ""}`;
        const current = state.interactionPages[interactionKey] ?? initialInteractionState();
        state.interactionPages[interactionKey] = {
          ...current,
          loading: false,
          loadingMore: false,
        };
      });
  },
});

export const {
  setInboxLoading,
  setConversationLoadingId,
  resetMessagePage,
  resetInteractionPage,
} = workspaceSlice.actions;

export const workspaceReducer = workspaceSlice.reducer;
export const MESSAGE_PAGE_SIZE_EXPORT = MESSAGE_PAGE_SIZE;
export const INTERACTION_PAGE_SIZE_EXPORT = INTERACTION_PAGE_SIZE;
