import { useMemo } from "react";
import { ReportsAgentWorkspace } from "@/components/campaigns/ReportsAgentWorkspace";

const MONITORING_SESSION_KEY = "worktual.campaign.monitoring.session.v2";

function getOrCreateMonitoringSessionId(): string {
  try {
    const existing = sessionStorage.getItem(MONITORING_SESSION_KEY)?.trim();
    if (existing) return existing;
    const id = crypto.randomUUID();
    sessionStorage.setItem(MONITORING_SESSION_KEY, id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

/**
 * Campaign monitoring module — live / scheduled / past list, detail, stop-resume.
 */
export function CampaignsPage() {
  const sessionId = useMemo(() => getOrCreateMonitoringSessionId(), []);
  return (
    <ReportsAgentWorkspace sessionId={sessionId} variant="monitoring" />
  );
}
