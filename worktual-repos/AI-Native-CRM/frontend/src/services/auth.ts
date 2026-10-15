import { api } from "./api";

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  role: string;
  initials: string;
  businessType: "b2b" | "b2c" | "b2b2c";
  organizationId: string;
  orgName: string;
};

export type LoginResult =
  | { ok: true; user: AuthUser }
  | {
      ok: false;
      error: string;
      code?: string;
    };

export async function loginRequest(input: {
  email: string;
  password: string;
  remember?: boolean;
  force?: boolean;
}): Promise<LoginResult> {
  const { data } = await api.post<LoginResult & { statusCode?: number }>(
    "/api/auth/login",
    input,
  );
  if (
    !data.ok &&
    data.code !== "session_active_elsewhere" &&
    data.statusCode === 409
  ) {
    return {
      ok: false,
      error: data.error,
      code: "session_active_elsewhere",
    };
  }
  return data;
}

export async function logoutRequest() {
  await api.post("/api/auth/logout");
}

export async function meRequest() {
  const { data } = await api.get<
    | { ok: true; user: AuthUser }
    | { ok: false; error: string; code?: string }
  >("/api/auth/me", {
    headers: {
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
    },
    params: { _: Date.now() },
  });
  return data;
}

const onboardingExchangeInflight = new Map<
  string,
  Promise<{
    ok: true;
    user: AuthUser;
    redirectTo: string;
  } | { ok: false; error: string }>
>();

/** Dedupe Strict Mode double-mount so a one-time code is POSTed once. */
export function onboardingExchangeRequest(code: string) {
  const key = code.trim();
  const existing = onboardingExchangeInflight.get(key);
  if (existing) return existing;

  const pending = api
    .post<{
      ok: true;
      user: AuthUser;
      redirectTo: string;
    } | { ok: false; error: string }>("/api/auth/onboarding-exchange", { code: key })
    .then(({ data }) => {
      if (!data.ok) onboardingExchangeInflight.delete(key);
      return data;
    })
    .catch((err) => {
      onboardingExchangeInflight.delete(key);
      throw err;
    });

  onboardingExchangeInflight.set(key, pending);
  return pending;
}
