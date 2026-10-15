import { createBrowserRouter, Navigate, useParams } from "react-router";

import AppLayout, { RoleHomeRedirect } from "@/layouts/AppLayout";
import DashboardPage from "@/pages/admin/DashboardPage";
import DashboardAnalyticsPage from "@/pages/admin/DashboardAnalyticsPage";
import RecordingPage from "@/pages/admin/RecordingPage";
import QueuesPage from "@/pages/admin/workforce/QueuesPage";
import AgentsPage from "@/pages/admin/workforce/AgentsPage";
import PresencePage from "@/pages/admin/workforce/PresencePage";
import ShiftsPage from "@/pages/admin/workforce/ShiftsPage";
import ComingSoonPage from "@/pages/ComingSoonPage";
import MonitoringPage from "@/pages/admin/MonitoringPage";
import ContactsPage from "@/pages/contacts/ContactsPage";
import LoginPage from "@/pages/auth/LoginPage";
import OnboardingPage from "@/pages/auth/OnboardingPage";
import WorkspacePage from "@/pages/workspace/WorkspacePage";
import PerformancePage from "@/pages/performance/PerformancePage";
import TasksPage from "@/pages/tasks/TasksPage";
import TeamChatPage from "@/pages/internal-chat/TeamChatPage";

function QueueLegacyRedirect() {
  const { queueId } = useParams();
  if (!queueId || queueId === "new") {
    return <Navigate to="/admin/workforce/queues?create=1" replace />;
  }
  return <Navigate to={`/admin/workforce/queues?queue=${encodeURIComponent(queueId)}`} replace />;
}

export const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  { path: "/auth/onboarding", element: <OnboardingPage /> },
  {
    path: "/",
    element: <AppLayout />,
    children: [
      { index: true, element: <RoleHomeRedirect /> },
      { path: "admin", element: <Navigate to="/admin/dashboard" replace /> },
      { path: "admin/dashboard", element: <DashboardPage /> },
      { path: "admin/dashboard/analytics", element: <DashboardAnalyticsPage /> },
      { path: "admin/workforce/agents", element: <AgentsPage /> },
      { path: "admin/workforce/queues", element: <QueuesPage /> },
      { path: "admin/recording", element: <RecordingPage /> },
      {
        path: "admin/workforce/queues/new",
        element: <Navigate to="/admin/workforce/queues?create=1" replace />,
      },
      { path: "admin/workforce/queues/:queueId", element: <QueueLegacyRedirect /> },
      { path: "admin/workforce/skills", element: <ComingSoonPage /> },
      { path: "admin/workforce/presence", element: <PresencePage /> },
      { path: "admin/workforce/shifts", element: <ShiftsPage /> },
      { path: "admin/workspace", element: <WorkspacePage /> },
      { path: "admin/contacts", element: <ContactsPage /> },
      { path: "admin/monitoring", element: <MonitoringPage /> },
      { path: "admin/team-chat", element: <TeamChatPage /> },
      { path: "agent", element: <Navigate to="/agent/workspace" replace /> },
      { path: "agent/workspace", element: <WorkspacePage /> },
      { path: "agent/contacts", element: <ContactsPage /> },
      { path: "agent/team-chat", element: <TeamChatPage /> },
      { path: "agent/tasks", element: <TasksPage /> },
      { path: "agent/performance", element: <PerformancePage /> },
      { path: "*", element: <ComingSoonPage /> },
    ],
  },
]);
