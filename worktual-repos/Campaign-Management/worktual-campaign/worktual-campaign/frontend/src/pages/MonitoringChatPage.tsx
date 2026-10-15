import { useParams } from "react-router-dom";
import { MonitoringChatWorkspace } from "@/components/campaigns/MonitoringChatWorkspace";

export function MonitoringChatPage() {
  const { sessionId } = useParams();
  if (!sessionId) return null;
  return <MonitoringChatWorkspace sessionId={sessionId} />;
}
