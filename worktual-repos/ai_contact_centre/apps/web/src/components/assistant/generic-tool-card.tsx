import type { GenericCopilotToolMessage } from "@/features/assistant/copilot-engine";
import {
  ToolCardShell,
  ToolErrorBanner,
  ToolRunningLine,
  ToolSuccessBanner,
  toolStatusLine,
} from "@/components/assistant/tool-card-shell";

export function GenericToolCard({ message }: { message: GenericCopilotToolMessage }) {
  return (
    <ToolCardShell
      toolName={message.tool}
      status={message.status}
      statusLine={toolStatusLine(
        message.status,
        "Preparing request…",
        `Calling tool — ${message.tool.replaceAll("_", " ")}…`,
      )}
    >
      {message.status === "running" ? (
        <ToolRunningLine label={`Running ${message.tool}()`} />
      ) : null}
      {message.status === "success" ? (
        <ToolSuccessBanner>Data loaded successfully.</ToolSuccessBanner>
      ) : null}
      {message.status === "error" && message.error ? (
        <ToolErrorBanner>{message.error}</ToolErrorBanner>
      ) : null}
    </ToolCardShell>
  );
}
