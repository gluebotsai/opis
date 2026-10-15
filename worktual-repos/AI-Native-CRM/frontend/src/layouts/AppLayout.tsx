import { Suspense, useEffect } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { Header } from "@/components/layout/Header";
import { Sidebar } from "@/components/layout/Sidebar";
import {
  clearChunkReloadGuard,
  RouteErrorBoundary,
} from "@/components/layout/RouteErrorBoundary";
import { RouteFallbackSkeleton } from "@/components/skeleton/RouteFallbackSkeleton";
import { DailyBriefingPlayer } from "@/components/home/DailyBriefingPlayer";
import {
  isModuleEnabledForAccess,
  isValidModuleId,
} from "@/config/modules";
import { isCampaignEmbedRoute } from "@/lib/campaign-portal-nav";
import { useNotificationsSync } from "@/hooks/useNotificationsSync";
import { useMarketingEmbedWarm } from "@/hooks/useMarketingEmbedWarm";
import { MarketingPortalPage } from "@/pages/marketing/MarketingPortalPage";
import { CallAssistPopup } from "@/features/voice/call-assist-popup";
import { SipRegistrationHost } from "@/features/voice/sip-registration-host";
import { CoworkerThreadProvider } from "@/lib/coworker/coworker-thread";
import { setMobileNavOpen, useAppDispatch, useAppSelector } from "@/store";
import { useNavReturn } from "@/components/layout/use-nav-return";

function BusinessTypeRouteSync() {
  const user = useAppSelector((s) => s.auth.user);
  const { pathname } = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (!user) return;
    const segment = pathname.split("/").filter(Boolean)[0];
    if (
      segment &&
      isValidModuleId(segment) &&
      !isModuleEnabledForAccess(segment, user.businessType, user.role)
    ) {
      navigate("/", { replace: true });
    }
  }, [user, pathname, navigate]);

  return null;
}

export function AppLayout() {
  useNavReturn();
  const { pathname } = useLocation();
  const dispatch = useAppDispatch();
  const user = useAppSelector((s) => s.auth.user);
  const navOpen = useAppSelector((s) => s.shell.mobileNavOpen);
  useNotificationsSync();

  const marketingAllowed = Boolean(
    user &&
      isModuleEnabledForAccess("marketing", user.businessType, user.role),
  );
  useMarketingEmbedWarm(marketingAllowed);

  useEffect(() => {
    dispatch(setMobileNavOpen(false));
  }, [pathname, dispatch]);

  useEffect(() => {
    clearChunkReloadGuard();
  }, []);

  useEffect(() => {
    if (!navOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [navOpen]);

  const onCampaignEmbed = isCampaignEmbedRoute(pathname);

  // Campaign embed: CRM sidebar + iframe only (portal stays mounted across Marketing tabs).
  if (onCampaignEmbed && marketingAllowed) {
    return (
      <div className="flex h-dvh w-full min-w-0 overflow-hidden bg-[#f3f4f6]">
        <SipRegistrationHost />
        <Sidebar />
        <div className="flex min-h-0 min-w-0 w-full flex-1 flex-col overflow-hidden">
          <BusinessTypeRouteSync />
          <MarketingPortalPage active />
        </div>
        <CallAssistPopup />
      </div>
    );
  }

  // Normal CRM chrome — do not park a min-h-dvh iframe under Dashboard (clips header/content).
  return (
    <div className="flex h-dvh w-full min-w-0 overflow-hidden bg-[#f3f4f6]">
      <SipRegistrationHost />
      <Sidebar />
      <div className="flex min-h-0 min-w-0 w-full flex-1 flex-col overflow-hidden">
        <Header />
        <div className="relative flex min-h-0 min-w-0 w-full flex-1 flex-col">
          <DailyBriefingPlayer />
          <main className="flex min-h-0 min-w-0 w-full flex-1 flex-col overflow-hidden">
            <BusinessTypeRouteSync />
            <div className="flex min-h-0 min-w-0 w-full flex-1 flex-col overflow-hidden">
              <CoworkerThreadProvider>
                <RouteErrorBoundary resetKey={pathname}>
                  <Suspense fallback={<RouteFallbackSkeleton pathname={pathname} />}>
                    <Outlet key={pathname} />
                  </Suspense>
                </RouteErrorBoundary>
              </CoworkerThreadProvider>
            </div>
          </main>
        </div>
      </div>
      <CallAssistPopup />
    </div>
  );
}
