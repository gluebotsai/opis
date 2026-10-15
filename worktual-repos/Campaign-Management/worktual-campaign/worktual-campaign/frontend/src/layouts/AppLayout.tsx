import { useEffect, useSyncExternalStore } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { CampaignEmbedBridge } from "@/components/embed/CampaignEmbedBridge";
import { EmbedBlankScreen } from "@/components/embed/EmbedBlankScreen";
import { useEmbedMode } from "@/hooks/useEmbedMode";
import { AppShell } from "@/components/layout/AppShell";
import { useAppSelector } from "@/hooks/redux";
import { AuthBootstrapSkeleton } from "@/layouts/AuthBootstrapSkeleton";
import {
  DEFAULT_PACK_ID,
  getActivePackId,
  setSessionCampaignProfile,
  subscribeActivePack,
} from "@/lib/industry-packs";

export function AppLayout() {
  const { user, status } = useAppSelector((s) => s.auth);
  const location = useLocation();
  const embedMode = useEmbedMode();
  const packId = useSyncExternalStore(
    subscribeActivePack,
    getActivePackId,
    () => DEFAULT_PACK_ID,
  );

  useEffect(() => {
    if (!user) return;
    setSessionCampaignProfile({
      mode: user.mode,
      industry: user.industry,
      industryType: user.industryType,
    });
  }, [user]);

  if (status === "loading" || status === "idle") {
    if (!user) return <AuthBootstrapSkeleton />;
  }

  if (!user) {
    if (embedMode) {
      return <EmbedBlankScreen />;
    }
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return (
    <AppShell session={user} embedMode={embedMode}>
      {embedMode ? <CampaignEmbedBridge /> : null}
      <Outlet key={packId} />
    </AppShell>
  );
}
