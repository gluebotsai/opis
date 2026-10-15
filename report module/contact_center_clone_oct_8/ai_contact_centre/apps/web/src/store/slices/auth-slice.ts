import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

import type { AuthUser } from "@/types/auth";

const STORAGE_KEY = "cc2_auth_user";

export { STORAGE_KEY };

export function isSessionError(message: string) {
  return /invalid or expired token|unauthorized|session expired|signed out/i.test(message);
}

export function isAlreadySignedInError(message: string) {
  return /already signed in/i.test(message);
}

export type AuthState = {
  user: AuthUser | null;
};

function isNumericEntityId(id: string): boolean {
  return /^\d+$/.test(id);
}

function isAuthUser(value: unknown): value is AuthUser {
  if (!value || typeof value !== "object") return false;
  const user = value as AuthUser;
  return (
    typeof user.id === "string" &&
    typeof user.email === "string" &&
    typeof user.token === "string" &&
    typeof user.organizationId === "string" &&
    (user.role === "admin" || user.role === "agent")
  );
}

function readStoredUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!isAuthUser(parsed)) return null;
    // Drop legacy UUID sessions — org/user PKs are bigint decimal strings.
    if (!isNumericEntityId(parsed.organizationId) || !isNumericEntityId(parsed.id)) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

const initialState: AuthState = {
  user: typeof window !== "undefined" ? readStoredUser() : null,
};

const authSlice = createSlice({
  name: "auth",
  initialState,
  reducers: {
    loginSuccess(state, action: PayloadAction<AuthUser>) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(action.payload));
      state.user = action.payload;
    },
    logout(state) {
      localStorage.removeItem(STORAGE_KEY);
      state.user = null;
    },
  },
});

export const { loginSuccess, logout } = authSlice.actions;
export const authReducer = authSlice.reducer;

export function validateLogin(
  email: string,
  password: string,
): { ok: true; email: string; password: string } | { ok: false; error: string } {
  const trimmed = email.trim();
  if (!trimmed || !trimmed.includes("@")) {
    return { ok: false, error: "Enter a valid work email." };
  }
  if (!password.trim()) {
    return { ok: false, error: "Enter your password." };
  }
  return { ok: true, email: trimmed, password };
}
