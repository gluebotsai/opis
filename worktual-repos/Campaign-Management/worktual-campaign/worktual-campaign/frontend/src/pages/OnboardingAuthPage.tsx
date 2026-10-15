import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { WorktualLogo } from "@/components/brand/WorktualLogo";
import { AuthBootstrapSkeleton } from "@/layouts/AuthBootstrapSkeleton";
import { useAppDispatch, useAppSelector } from "@/hooks/redux";
import { onboardingExchangeRequest } from "@/services/auth.service";
import { setUser } from "@/store/slices/authSlice";
import { hydrateRecommendationsFromServer } from "@/lib/campaign-recommendations-store";
import { hydrateCampaignDraftsFromServer } from "@/lib/campaign-drafts";
import { hydrateOpportunityEventsFromServer } from "@/lib/opportunity-events-store";
import { postGalleryBootstrap } from "@/services/gallery.api";
import axios from "axios";

export function OnboardingAuthPage() {
  const dispatch = useAppDispatch();
  const { user, status } = useAppSelector((s) => s.auth);
  const [searchParams] = useSearchParams();
  const code = searchParams.get("code")?.trim() || "";
  const [error, setError] = useState<string | null>(null);
  const [exchanging, setExchanging] = useState(false);
  const startedRef = useRef(false);

  useEffect(() => {
    if (user || startedRef.current) return;
    if (!code) {
      setError("This onboarding link is missing a code. Ask your admin to resend it.");
      return;
    }

    startedRef.current = true;
    setExchanging(true);
    void (async () => {
      try {
        const result = await onboardingExchangeRequest(code);
        dispatch(setUser(result.user));
        void hydrateRecommendationsFromServer();
        void hydrateOpportunityEventsFromServer();
        void hydrateCampaignDraftsFromServer();
        void postGalleryBootstrap();
      } catch (err) {
        if (axios.isAxiosError(err)) {
          setError(
            (err.response?.data as { message?: string })?.message ??
              "This onboarding link is invalid or expired.",
          );
        } else {
          setError("Unable to complete onboarding sign-in.");
        }
      } finally {
        setExchanging(false);
      }
    })();
  }, [code, dispatch, user]);

  if (user) {
    return <Navigate to="/dashboard" replace />;
  }

  if (status === "loading" || status === "idle" || exchanging) {
    return <AuthBootstrapSkeleton />;
  }

  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-[#f3f4f6] px-4">
        <WorktualLogo className="mb-8 h-8 w-auto" />
        <div className="max-w-md rounded-lg border border-[#bfbfbf]/60 bg-white p-6 text-center shadow-none">
          <p className="text-sm text-[#111111]">{error}</p>
          <Link
            to="/login"
            className="mt-4 inline-block text-sm font-medium text-[#111111] underline"
          >
            Go to login
          </Link>
        </div>
      </div>
    );
  }

  return <AuthBootstrapSkeleton />;
}
