import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";

import { WorktualMark } from "@/components/brand/WorktualMark";
import { useAuth } from "@/hooks/use-auth";

const inflightExchanges = new Map<string, Promise<{ ok: true; homePath: string } | { ok: false; error: string }>>();

export default function OnboardingPage() {
  const { completeOnboarding } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const code = searchParams.get("code")?.trim();
    if (!code) {
      setError("This onboarding link is missing a code. Sign in with your email and password.");
      return;
    }

    let cancelled = false;
    let pending = inflightExchanges.get(code);
    if (!pending) {
      pending = completeOnboarding(code);
      inflightExchanges.set(code, pending);
    }

    void pending.then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        inflightExchanges.delete(code);
        setError(result.error);
        return;
      }
      navigate(result.homePath, { replace: true });
    });

    return () => {
      cancelled = true;
    };
  }, [completeOnboarding, navigate, searchParams]);

  return (
    <div className="flex min-h-svh flex-col bg-[#eceef2] text-neutral-900">
      <header className="flex h-14 items-center bg-black px-4 sm:px-6">
        <WorktualMark className="h-7" />
      </header>
      <main className="flex flex-1 items-center justify-center px-4 py-8">
        <div className="w-full max-w-md rounded-2xl bg-white px-6 py-10 shadow-[0_20px_60px_rgba(15,23,42,0.12)] sm:px-10">
          {error ? (
            <div className="space-y-4">
              <h1 className="text-2xl font-semibold tracking-tight">Could not open Contact Center</h1>
              <p className="text-sm text-neutral-600">{error}</p>
              <Link
                to="/login"
                className="inline-flex h-11 w-full items-center justify-center rounded-xl bg-black text-sm font-medium text-white no-underline transition hover:bg-neutral-800"
              >
                Continue to sign in
              </Link>
            </div>
          ) : (
            <div className="space-y-2">
              <h1 className="text-2xl font-semibold tracking-tight">Opening Contact Center</h1>
              <p className="text-sm text-neutral-600">Signing you in…</p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
