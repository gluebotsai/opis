import { useEffect } from "react";
import { Outlet, useParams } from "react-router-dom";
import { CreateCampaignChatWorkspace } from "@/components/campaigns/CreateCampaignChatWorkspace";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { CampaignTemplateEditPage } from "@/pages/CampaignTemplateEditPage";
import { CREATE_CAMPAIGN_DRAFTS_HREF } from "@/lib/start-create-campaign-chat";
import {
  ensureCreateCampaignBridge,
  releaseCreateCampaignBridge,
} from "@/lib/create-campaign-chat-bridge";
import { getToken } from "@/services/api";
import { getAgentsSocket } from "@/services/agents.socket";

/**
 * Persistent create-campaign shell: main chat stays mounted while template
 * edit opens as a nested route (Outlet overlay). Avoids join_session / draft
 * reload on every View → back.
 */
export function CreateCampaignDraftLayout() {
  const { draftId } = useParams();
  if (!draftId) return null;

  useEffect(() => {
    ensureCreateCampaignBridge(draftId);
    return () => {
      releaseCreateCampaignBridge(draftId);
    };
  }, [draftId]);

  return (
    <div className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <CreateCampaignChatWorkspace
        draftId={draftId}
        listHref={CREATE_CAMPAIGN_DRAFTS_HREF}
      />
      <Outlet />
    </div>
  );
}

export function CampaignTemplateEditOverlay() {
  const { draftId } = useParams();

  useEffect(() => {
    return () => {
      const token = getToken();
      if (!draftId || !token) return;
      getAgentsSocket().emit("leave_template_editor", {
        session_id: draftId,
        token,
      });
    };
  }, [draftId]);

  return (
    <div
      className="absolute inset-0 z-40 flex min-h-0 flex-col overflow-hidden bg-[#f3f4f6]"
      role="dialog"
      aria-modal="true"
      aria-label="Template editor"
    >
      <ErrorBoundary label="Template edit">
        <CampaignTemplateEditPage />
      </ErrorBoundary>
    </div>
  );
}
