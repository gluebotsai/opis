import { CreateCampaignHubWorkspace } from "@/components/campaigns/CreateCampaignHubWorkspace";
import { CreateCampaignChatWorkspace } from "@/components/campaigns/CreateCampaignChatWorkspace";
import { CREATE_CAMPAIGN_DRAFTS_HREF } from "@/lib/start-create-campaign-chat";
import { CreateEventEditorWorkspace } from "@/components/campaigns/CreateEventEditorWorkspace";
import { RecommendationWorkspace } from "@/components/campaigns/RecommendationWorkspace";
import { WhatsAppApprovalsWorkspace } from "@/components/campaigns/WhatsAppApprovalsWorkspace";
import { PpcAdsWorkspace } from "@/components/campaigns/PpcAdsWorkspace";
import { EventsTrackingPage } from "@/pages/EventsTrackingPage";
import { Navigate, useLocation, useParams } from "react-router-dom";
import {
  isBareCreateCampaignPath,
  resolveCreateSoftNavPath,
} from "@/lib/create-campaign-active-session";

export function CreateCampaignPage() {
  const location = useLocation();
  const path = `${location.pathname}${location.search}`;
  if (isBareCreateCampaignPath(path)) {
    const resumed = resolveCreateSoftNavPath(path);
    if (resumed !== path) {
      return <Navigate to={resumed} replace />;
    }
  }
  return <CreateCampaignHubWorkspace />;
}

export function CreateCampaignTemplatesPage() {
  return <Navigate to="/campaigns/create?tool=templates" replace />;
}

export function CreateCampaignRecommendationsPage() {
  return <RecommendationWorkspace />;
}

export function CreateCampaignWhatsAppApprovalsPage() {
  return <WhatsAppApprovalsWorkspace />;
}

export function CreateCampaignPpcPage() {
  return <PpcAdsWorkspace />;
}

export function CreateCampaignEventEditorPage() {
  return <CreateEventEditorWorkspace />;
}

/** Events module — form/event editor. */
export function CreateEventEditorPage() {
  return <CreateEventEditorWorkspace />;
}

/** Legacy URL: /campaigns/create/events/:eventId → /events/create/:eventId */
export function LegacyCreateEventEditorRedirect() {
  const { eventId } = useParams();
  if (!eventId) return <Navigate to="/events?tab=draft" replace />;
  return <Navigate to={`/events/create/${eventId}`} replace />;
}

export function CreateCampaignDraftPage() {
  const { draftId } = useParams();
  if (!draftId) return null;
  return (
    <CreateCampaignChatWorkspace
      draftId={draftId}
      listHref={CREATE_CAMPAIGN_DRAFTS_HREF}
    />
  );
}

export function EventsPage() {
  return <EventsTrackingPage />;
}
