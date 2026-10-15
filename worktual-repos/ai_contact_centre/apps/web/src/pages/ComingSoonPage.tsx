import { Construction } from "lucide-react";
import { useMemo } from "react";
import { useLocation } from "react-router";

import { CopilotWorkspace, PanelExpandButton } from "@/components/assistant/copilot-workspace";
import { EmbeddedCopilotPanel } from "@/components/assistant/embedded-copilot-panel";
import { getNavForRole } from "@/config/navigation";
import { useAuth } from "@/hooks/use-auth";
import { contentPanel } from "@/lib/panel-chrome";

function titleFromPath(pathname: string, role: "admin" | "agent"): string {
  const sections = getNavForRole(role);
  for (const section of sections) {
    const match = section.items.find((item) => item.path === pathname);
    if (match) return match.label;
  }
  const segment = pathname.split("/").filter(Boolean).pop() ?? "Page";
  return segment
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

const moduleDescriptions: Record<string, string> = {
  Dashboard: "Overview of contact center health, volume, and team performance.",
  Agents: "Manage agent profiles, skills, and queue assignments.",
  Skills: "Define routing skills and proficiency levels.",
  Presence: "Monitor agent availability and channel readiness.",
  "Shift Assignment": "Assign agents to shifts and business hours.",
  "My Workspace": "Handle conversations as an admin or supervisor.",
  "Live Monitoring": "Watch queues, SLAs, and agent activity in real time.",
  Contacts: "Search customers, view profiles, and conversation history.",
  "Reports & Analytics": "Reports on queues, agents, SLAs, and channel performance.",
  "Agent Workspace": "Your assigned conversations across voice, chat, and email.",
  "My Tasks": "Follow-ups, escalations, and callbacks.",
  "My Performance": "Your personal handle time, CSAT, and resolution metrics.",
};

export default function ComingSoonPage() {
  const { user } = useAuth();
  const location = useLocation();
  const title = useMemo(
    () => titleFromPath(location.pathname, user?.role ?? "agent"),
    [location.pathname, user?.role],
  );
  const description =
    moduleDescriptions[title] ??
    "This module is scaffolded for your role. Full functionality will land in upcoming sprints.";

  return (
    <CopilotWorkspace
      title={title}
      subtitle={description}
      copilot={<EmbeddedCopilotPanel />}
    >
      <div className={contentPanel("relative")}>
        <div className="absolute top-3 right-3 z-10">
          <PanelExpandButton side="right" />
        </div>
        <div className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
          <div className="flex size-14 items-center justify-center rounded-2xl bg-neutral-100 text-neutral-700">
            <Construction className="size-6" />
          </div>
          <h2 className="mt-5 text-xl font-semibold tracking-tight">Coming Soon</h2>
          <p className="mt-2 max-w-md text-center text-sm leading-relaxed text-neutral-600">
            The <span className="font-medium text-neutral-800">{title}</span> experience for{" "}
            {user?.roleLabel.toLowerCase()} is under construction. Use Copilot on the left to
            navigate or ask what&apos;s available today.
          </p>
        </div>
      </div>
    </CopilotWorkspace>
  );
}
