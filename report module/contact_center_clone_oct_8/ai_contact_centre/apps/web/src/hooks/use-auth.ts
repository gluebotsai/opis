import { useCallback } from "react";

import { getHomePath } from "@/config/navigation";
import { stopSipRegistration } from "@/features/voice/sip-ua";
import { resetPresenceSession } from "@/features/workspace/presence-session";
import { useAppDispatch, useAppSelector } from "@/hooks/redux";
import { ccCoreApi } from "@/services/cc-core";
import { loginSuccess, logout as logoutAction, validateLogin, isAlreadySignedInError } from "@/store/slices/auth-slice";

export function useAuth() {
  const dispatch = useAppDispatch();
  const user = useAppSelector((state) => state.auth.user);

  const login = useCallback(
    async (email: string, password: string, options?: { force?: boolean }) => {
      const result = validateLogin(email, password);
      if (!result.ok) return { ...result, alreadySignedIn: false };

      try {
        const user = await ccCoreApi.login(result.email, result.password, options);
        resetPresenceSession();
        dispatch(loginSuccess(user));
        return { ok: true as const, homePath: getHomePath(user.role) };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Sign in failed.";
        return {
          ok: false as const,
          error: message,
          alreadySignedIn: isAlreadySignedInError(message),
        };
      }
    },
    [dispatch],
  );

  const completeOnboarding = useCallback(
    async (code: string) => {
      try {
        const { redirectTo, ...authUser } = await ccCoreApi.exchangeOnboarding(code);
        resetPresenceSession();
        dispatch(loginSuccess(authUser));
        return { ok: true as const, homePath: redirectTo || getHomePath(authUser.role) };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Onboarding link is invalid.";
        return { ok: false as const, error: message };
      }
    },
    [dispatch],
  );

  const logout = useCallback(async () => {
    await stopSipRegistration();
    try {
      await ccCoreApi.logout();
    } catch {
      // Clear local session even if the server is unreachable.
    }
    resetPresenceSession();
    dispatch(logoutAction());
  }, [dispatch]);

  return {
    user,
    isAuthenticated: Boolean(user),
    login,
    completeOnboarding,
    logout,
  };
}
