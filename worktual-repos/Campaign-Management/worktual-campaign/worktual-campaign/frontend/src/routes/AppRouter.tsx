import { Navigate, Route, Routes, useParams } from "react-router-dom";
import { EmbedBlankScreen } from "@/components/embed/EmbedBlankScreen";
import { AppLayout } from "@/layouts/AppLayout";
import { AuthBootstrapSkeleton } from "@/layouts/AuthBootstrapSkeleton";
import { LoginForm } from "@/components/auth/LoginForm";
import { useAppSelector } from "@/hooks/redux";
import { isEmbedMode } from "@/lib/embed-auth";
import { DashboardPage } from "@/pages/DashboardPage";
import { CampaignsPage } from "@/pages/CampaignsPage";
import { CampaignMonitorDetailPage } from "@/pages/CampaignMonitorDetailPage";
import { MonitoringChatPage } from "@/pages/MonitoringChatPage";
import { ContactsPage } from "@/pages/ContactsPage";
import { CreateContactChatPage } from "@/pages/CreateContactChatPage";
import { ConfigurationPage } from "@/pages/ConfigurationPage";
import { ConfigurationChannelPage } from "@/pages/ConfigurationChannelPage";
import {
  CreateCampaignDraftLayout,
  CampaignTemplateEditOverlay,
} from "@/components/campaigns/CreateCampaignDraftLayout";
import {
  CreateCampaignPage,
  CreateCampaignRecommendationsPage,
  CreateCampaignTemplatesPage,
  CreateCampaignWhatsAppApprovalsPage,
  CreateEventEditorPage,
  LegacyCreateEventEditorRedirect,
} from "@/pages/CampaignFeaturePages";
import { PublicFormPage } from "@/pages/PublicFormPage";
import { EventsTrackingPage } from "@/pages/EventsTrackingPage";
import { CampaignCalendarPage } from "@/pages/CampaignCalendarPage";
import { OnDemandSendDetailPage } from "@/pages/OnDemandSendDetailPage";
import { PersonalisedCrmSendDetailPage } from "@/pages/PersonalisedCrmSendDetailPage";
import { OnDemandSendChatPage } from "@/pages/OnDemandSendChatPage";
import { OnboardingAuthPage } from "@/pages/OnboardingAuthPage";
import { WhatsAppTemplateAgentWorkspace } from "@/components/campaigns/WhatsAppTemplateAgentWorkspace";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { isConfigurationUiHidden } from "@/lib/campaign-channels";

function ConfigurationIndexRoute() {
  if (isConfigurationUiHidden()) {
    return <Navigate to="/dashboard" replace />;
  }
  return <ConfigurationPage />;
}

function ConfigurationChannelRoute() {
  if (isConfigurationUiHidden()) {
    return <Navigate to="/dashboard" replace />;
  }
  return <ConfigurationChannelPage />;
}

function WhatsAppApprovedTemplatePage() {
  return <WhatsAppTemplateAgentWorkspace mode="approved" />;
}

function WhatsAppRejectedTemplatePage() {
  return <WhatsAppTemplateAgentWorkspace mode="rejected" />;
}
function LoginPage() {
  const { user, status } = useAppSelector((s) => s.auth);
  // Only block on initial bootstrap — never on password submit (login keeps
  // status "anonymous" while in flight so the form stays mounted).
  if ((status === "loading" || status === "idle") && !user) {
    return isEmbedMode() ? <EmbedBlankScreen /> : <AuthBootstrapSkeleton />;
  }
  if (user) return <Navigate to="/dashboard" replace />;
  if (isEmbedMode()) return <EmbedBlankScreen />;
  return <LoginForm />;
}

/** Redirect legacy /contacts/* URLs to /audience/*. */
function RedirectContactsToAudience({
  suffix,
}: {
  suffix: "chat" | "createChat" | "detail";
}) {
  const { sessionId, draftId, contactId } = useParams();
  if (suffix === "chat" && sessionId) {
    return <Navigate to={`/audience/chat/${sessionId}`} replace />;
  }
  if (suffix === "createChat" && draftId) {
    return <Navigate to={`/audience/create/chat/${draftId}`} replace />;
  }
  if (suffix === "detail" && contactId) {
    return <Navigate to={`/audience/${contactId}`} replace />;
  }
  return <Navigate to="/audience" replace />;
}

export function AppRouter() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/auth/onboarding" element={<OnboardingAuthPage />} />
      {/* Public form — no auth shell */}
      <Route path="/f/:slug" element={<PublicFormPage />} />
      <Route element={<AppLayout />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route
          path="/audience/chat/:sessionId"
          element={<CreateContactChatPage />}
        />
        <Route
          path="/audience/create/chat/:draftId"
          element={<CreateContactChatPage />}
        />
        {/* Splat keeps AudienceWorkspace mounted for list → detail → create. */}
        <Route path="/audience/*" element={<ContactsPage />} />
        {/* Legacy Contacts URLs */}
        <Route
          path="/contacts"
          element={<Navigate to="/audience" replace />}
        />
        <Route
          path="/contacts/chat/:sessionId"
          element={<RedirectContactsToAudience suffix="chat" />}
        />
        <Route
          path="/contacts/create/chat/:draftId"
          element={<RedirectContactsToAudience suffix="createChat" />}
        />
        <Route
          path="/contacts/:contactId"
          element={<RedirectContactsToAudience suffix="detail" />}
        />
        <Route path="/configuration" element={<ConfigurationIndexRoute />} />
        <Route
          path="/configuration/:channel"
          element={<ConfigurationChannelRoute />}
        />
        <Route path="/campaigns" element={<CampaignsPage />} />
        <Route
          path="/campaigns/monitor/chat/:sessionId"
          element={<MonitoringChatPage />}
        />
        <Route path="/campaigns/create" element={<CreateCampaignPage />} />
        <Route
          path="/campaigns/create/templates"
          element={<CreateCampaignTemplatesPage />}
        />
        <Route
          path="/campaigns/create/whatsapp"
          element={<CreateCampaignWhatsAppApprovalsPage />}
        />
        <Route
          path="/campaigns/create/whatsapp/approved/:templateId"
          element={<WhatsAppApprovedTemplatePage />}
        />
        <Route
          path="/campaigns/create/whatsapp/rejected/:templateId"
          element={<WhatsAppRejectedTemplatePage />}
        />
        <Route
          path="/campaigns/create/recommendations/*"
          element={<CreateCampaignRecommendationsPage />}
        />
        <Route
          path="/campaigns/create/ppc"
          element={<Navigate to="/campaigns/create" replace />}
        />
        <Route
          path="/campaigns/create/ppc/:network"
          element={<Navigate to="/campaigns/create" replace />}
        />
        {/* Events hub + editor — before :draftId so "events" is not treated as a draft */}
        <Route
          path="/campaigns/create/events"
          element={<Navigate to="/events?tab=draft" replace />}
        />
        <Route
          path="/campaigns/create/events/:eventId"
          element={<LegacyCreateEventEditorRedirect />}
        />
        <Route
          path="/campaigns/create/on-demand"
          element={
            <ErrorBoundary label="On-demand chat">
              <OnDemandSendChatPage />
            </ErrorBoundary>
          }
        />
        <Route
          path="/campaigns/create/:draftId"
          element={
            <ErrorBoundary label="Create campaign draft">
              <CreateCampaignDraftLayout />
            </ErrorBoundary>
          }
        >
          <Route
            path="templates/:templateId"
            element={<CampaignTemplateEditOverlay />}
          />
          <Route
            path="templates/channel/:channel"
            element={<CampaignTemplateEditOverlay />}
          />
        </Route>
        <Route
          path="/campaigns/new"
          element={<Navigate to="/campaigns/create" replace />}
        />
        <Route
          path="/campaigns/calendar"
          element={<CampaignCalendarPage />}
        />
        <Route
          path="/campaigns/on-demand"
          element={<Navigate to="/campaigns?tab=on-demand" replace />}
        />
        <Route
          path="/campaigns/on-demand/:runId"
          element={
            <ErrorBoundary label="On-demand detail">
              <OnDemandSendDetailPage />
            </ErrorBoundary>
          }
        />
        <Route
          path="/campaigns/personalised-crm"
          element={<Navigate to="/campaigns?tab=personalised-crm" replace />}
        />
        <Route
          path="/campaigns/personalised-crm/:runId"
          element={
            <ErrorBoundary label="Personalised CRM detail">
              <PersonalisedCrmSendDetailPage />
            </ErrorBoundary>
          }
        />
        <Route
          path="/campaigns/:campaignId"
          element={<CampaignMonitorDetailPage />}
        />
        <Route
          path="/templates"
          element={<Navigate to="/campaigns/create?tool=templates" replace />}
        />
        <Route
          path="/events/create"
          element={<Navigate to="/events?tab=draft" replace />}
        />
        <Route
          path="/events/create/:eventId"
          element={<CreateEventEditorPage />}
        />
        <Route path="/events/:eventId" element={<EventsTrackingPage />} />
        <Route path="/events" element={<EventsTrackingPage />} />
        <Route path="/reports" element={<Navigate to="/dashboard" replace />} />
        <Route
          path="/recommendations"
          element={<Navigate to="/campaigns/create" replace />}
        />
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
