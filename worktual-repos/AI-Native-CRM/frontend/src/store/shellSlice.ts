import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import { setUser } from "./authSlice";
import { readSidebarCollapsedPreference } from "@/lib/sidebar-preference";
import { readCoworkerExpandPreference } from "@/lib/coworker-expand-preference";

export type CoworkerExpand = "default" | "chat" | "draft" | "chatFull";

export type ShellState = {
  sidebarCollapsed: boolean;
  mobileNavOpen: boolean;
  coworkerRailOpen: boolean;
  coworkerExpand: CoworkerExpand;
};

const initialState: ShellState = {
  sidebarCollapsed: readSidebarCollapsedPreference(),
  mobileNavOpen: false,
  coworkerRailOpen: false,
  coworkerExpand: readCoworkerExpandPreference(),
};

const shellSlice = createSlice({
  name: "shell",
  initialState,
  reducers: {
    setSidebarCollapsed(state, action: PayloadAction<boolean>) {
      state.sidebarCollapsed = action.payload;
    },
    toggleSidebarCollapsed(state) {
      state.sidebarCollapsed = !state.sidebarCollapsed;
    },
    setMobileNavOpen(state, action: PayloadAction<boolean>) {
      state.mobileNavOpen = action.payload;
    },
    hydrateCoworkerRailOpen(state, action: PayloadAction<boolean>) {
      state.coworkerRailOpen = action.payload;
    },
    setCoworkerRailOpen(state, action: PayloadAction<boolean>) {
      state.coworkerRailOpen = action.payload;
    },
    setCoworkerExpand(state, action: PayloadAction<CoworkerExpand>) {
      state.coworkerExpand = action.payload;
    },
    toggleCoworkerExpand(
      state,
      action: PayloadAction<"chat" | "draft">,
    ) {
      const side = action.payload;
      state.coworkerExpand =
        state.coworkerExpand === side ? "default" : side;
    },
  },
  extraReducers: (builder) => {
    builder.addCase(setUser, (state, action) => {
      if (action.payload) return;
      state.mobileNavOpen = false;
      state.coworkerRailOpen = false;
      state.coworkerExpand = "default";
    });
  },
});

export const {
  setSidebarCollapsed,
  toggleSidebarCollapsed,
  setMobileNavOpen,
  hydrateCoworkerRailOpen,
  setCoworkerRailOpen,
  setCoworkerExpand,
  toggleCoworkerExpand,
} = shellSlice.actions;
export const shellReducer = shellSlice.reducer;
