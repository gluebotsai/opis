import { useMemo } from "react";
import { useLocation, useNavigate } from "react-router";

import { WorkspacePanels } from "@/components/workspace/workspace-panels";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import { getNavForRole } from "@/config/navigation";
import { useAuth } from "@/hooks/use-auth";

export default function WorkspacePage() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const role = user?.role ?? "agent";

  const title = useMemo(() => {
    const sections = getNavForRole(role);
    for (const section of sections) {
      const match = section.items.find((item) => item.path === location.pathname);
      if (match) return match.label;
    }
    return "Workspace";
  }, [location.pathname, role]);

  return (
    <WorkspaceShell title={title}>
      <WorkspacePanels onOpenQueue={(queueId) => navigate(`/admin/workforce/queues?queue=${queueId}`)} />
    </WorkspaceShell>
  );
}
