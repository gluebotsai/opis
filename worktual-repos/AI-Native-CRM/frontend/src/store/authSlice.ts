import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { AuthUser } from "../services/auth";

export type AuthState = {
  user: AuthUser | null;
  bootstrapped: boolean;
};

const authSlice = createSlice({
  name: "auth",
  initialState: { user: null, bootstrapped: false } as AuthState,
  reducers: {
    setUser(state, action: PayloadAction<AuthUser | null>) {
      state.user = action.payload;
    },
    setBootstrapped(state, action: PayloadAction<boolean>) {
      state.bootstrapped = action.payload;
    },
  },
});

export const { setUser, setBootstrapped } = authSlice.actions;
export const authReducer = authSlice.reducer;
