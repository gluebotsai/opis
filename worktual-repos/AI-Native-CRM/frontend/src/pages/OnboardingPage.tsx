import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { onboardingExchangeRequest } from "@/services/auth";
import { setUser, useAppDispatch, useAppSelector } from "@/store";
import { startBriefingDelayClock } from "@/lib/unlock-audio";
import { startDailyBriefingClock } from "@/components/home/DailyBriefingPlayer";

export function OnboardingPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const dispatch = useAppDispatch();
  const bootstrapped = useAppSelector((s) => s.auth.bootstrapped);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!bootstrapped) return;
    const code = searchParams.get("code")?.trim() ?? "";
    if (!code) {
      navigate("/login", { replace: true });
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const result = await onboardingExchangeRequest(code);
        if (cancelled) return;
        if (!result.ok) {
          setError(result.error || "This onboarding link is invalid or has expired.");
          return;
        }
        dispatch(setUser(result.user));
        startBriefingDelayClock();
        startDailyBriefingClock();
        const next =
          result.redirectTo?.startsWith("/") ? result.redirectTo : "/dashboard";
        navigate(next, { replace: true });
      } catch {
        if (!cancelled) {
          setError(
            "Unable to reach the CRM API. Open sign in and try email and password.",
          );
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [bootstrapped, dispatch, navigate, searchParams]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-subtle px-4 text-text-secondary">
      {error ? (
        <div className="max-w-md text-center">
          <p className="text-sm text-text-primary">{error}</p>
          <Link
            to="/login"
            className="mt-4 inline-block text-sm font-medium text-text-primary underline"
          >
            Continue to sign in
          </Link>
        </div>
      ) : (
        <p className="text-sm">Signing you in…</p>
      )}
    </div>
  );
}
