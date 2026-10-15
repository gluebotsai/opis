import {
  BarChartOutlined,
  DashboardOutlined,
  UnorderedListOutlined,
} from "@ant-design/icons";
import { AudioLines, ListOrdered, MessageSquare, MonitorDot, Users } from "lucide-react";
import type { ReactNode } from "react";

import { WorkspaceHeadsetIcon } from "@/components/icons/workspace-headset-icon";
import type { UserRole } from "@/types/auth";

const contactsNavIcon = <Users className="size-[1.2em] stroke-[1.75]" aria-hidden />;
const workspaceNavIcon = <WorkspaceHeadsetIcon className="size-[1.4em]" />;
const liveMonitoringNavIcon = (
  <MonitorDot className="size-[1.2em] stroke-[1.75]" aria-hidden />
);
const queuesNavIcon = <ListOrdered className="size-[1.2em] stroke-[1.75]" aria-hidden />;
const recordingNavIcon = <AudioLines className="size-[1.2em] stroke-[1.75]" aria-hidden />;
const teamChatNavIcon = (
  <MessageSquare className="size-[1.2em] stroke-[1.75]" aria-hidden />
);

export type NavItem = {
  label: string;
  path: string;
  icon: ReactNode;
};

export type NavSection = {
  label?: string;
  items: NavItem[];
};

const adminNav: NavSection[] = [
  {
    items: [
      { label: "Dashboard", path: "/admin/dashboard", icon: <DashboardOutlined /> },
      { label: "Contacts", path: "/admin/contacts", icon: contactsNavIcon },
      { label: "Queues", path: "/admin/workforce/queues", icon: queuesNavIcon },
      { label: "Recording", path: "/admin/recording", icon: recordingNavIcon },
      { label: "My Workspace", path: "/admin/workspace", icon: workspaceNavIcon },
      { label: "Live Monitoring", path: "/admin/monitoring", icon: liveMonitoringNavIcon },
      { label: "Internal Chat", path: "/admin/team-chat", icon: teamChatNavIcon },
    ],
  },
];

const agentNav: NavSection[] = [
  {
    items: [
      { label: "Agent Workspace", path: "/agent/workspace", icon: workspaceNavIcon },
      { label: "Contacts", path: "/agent/contacts", icon: contactsNavIcon },
      { label: "My Tasks", path: "/agent/tasks", icon: <UnorderedListOutlined /> },
      { label: "My Performance", path: "/agent/performance", icon: <BarChartOutlined /> },
      { label: "Internal Chat", path: "/agent/team-chat", icon: teamChatNavIcon },
    ],
  },
];

export function getNavForRole(role: UserRole): NavSection[] {
  return role === "admin" ? adminNav : agentNav;
}

export function getPortalLabel(role: UserRole): string {
  return role === "admin" ? "ADMIN PORTAL" : "AGENT PORTAL";
}

export function getHomePath(role: UserRole): string {
  return role === "admin" ? "/admin/dashboard" : "/agent/workspace";
}

export function getTeamChatPath(role: UserRole, dmUserId?: string | null): string {
  const base = role === "admin" ? "/admin/team-chat" : "/agent/team-chat";
  if (!dmUserId) return base;
  return `${base}?dm=${encodeURIComponent(dmUserId)}`;
}
