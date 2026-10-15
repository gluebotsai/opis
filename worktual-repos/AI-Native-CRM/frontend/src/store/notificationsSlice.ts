import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import { setUser } from "./authSlice";

export type NotificationToast = {
  id: string;
  title: string;
  body: string | null;
  href: string | null;
};

export type NotificationsState = {
  unreadCount: number;
  incomingToast: NotificationToast | null;
};

const notificationsSlice = createSlice({
  name: "notifications",
  initialState: { unreadCount: 0, incomingToast: null } as NotificationsState,
  reducers: {
    setUnreadCount(state, action: PayloadAction<number>) {
      state.unreadCount = Math.max(0, action.payload);
    },
    setIncomingToast(state, action: PayloadAction<NotificationToast | null>) {
      state.incomingToast = action.payload;
    },
  },
  extraReducers: (builder) => {
    builder.addCase(setUser, (state, action) => {
      if (!action.payload) {
        state.unreadCount = 0;
        state.incomingToast = null;
      }
    });
  },
});

export const { setUnreadCount, setIncomingToast } = notificationsSlice.actions;
export const notificationsReducer = notificationsSlice.reducer;
