import type { ToolStatus } from "@/features/assistant/copilot-engine";
import { workspaceConversationIdFromPath } from "@/features/assistant/copilot-workspace-stay";

type SilentFallbackTool = {
  tool: string;
  status: ToolStatus;
  args?: Record<string, unknown>;
  result?: unknown;
  error?: string;
};

function workspaceStayCopy(result: Record<string, unknown> | undefined): string {
  const fromResult = typeof result?.conversationId === "string" ? result.conversationId.trim() : "";
  const fromPath =
    typeof result?.path === "string" ? workspaceConversationIdFromPath(result.path) : null;
  if (fromResult || fromPath) {
    return "<p>Opened that conversation in this workspace.</p>";
  }
  return "<p>Updated that from this workspace.</p>";
}

export function buildCopilotSilentFallback(
  tool: SilentFallbackTool | null,
  options?: { stayOnWorkspace?: boolean },
): string | null {
  if (!tool) return null;
  const result =
    tool.result && typeof tool.result === "object"
      ? (tool.result as Record<string, unknown>)
      : undefined;

  if (tool.status === "error") {
    if (tool.tool === "open_task_workspace") {
      return `<p>I couldn't open the workspace for that task. ${tool.error ?? "It may not have a linked conversation or customer yet."}</p>`;
    }
    if (tool.error) {
      return `<p>${tool.error}</p>`;
    }
    return "<p>I couldn't complete that request. Please try again.</p>";
  }

  if (tool.status !== "success") return null;

  if (result?._confirmation_required) {
    return null;
  }

  if (tool.tool === "open_task_workspace") {
    if (options?.stayOnWorkspace) {
      return workspaceStayCopy(result);
    }
    return "<p>Opening the linked workspace for that task now.</p>";
  }
  if (tool.tool === "update_task") {
    return "<p>Task updated.</p>";
  }
  if (tool.tool === "navigate") {
    if (options?.stayOnWorkspace) {
      return workspaceStayCopy(result);
    }
    return "<p>Opening that page now.</p>";
  }
  if (tool.tool === "get_task") {
    const title = (result?.task as { title?: string } | undefined)?.title;
    return title
      ? `<p>Here are the details for <strong>${title}</strong>.</p>`
      : "<p>Here are the task details.</p>";
  }
  if (tool.tool === "create_callback_task") {
    return "<p>Callback assigned.</p>";
  }
  if (tool.tool === "force_agent_logout") {
    return "<p>Agent logged out.</p>";
  }
  if (tool.tool === "set_agent_presence") {
    const presence = tool.args?.presence;
    if (presence === "not_ready") {
      return "<p>Agent set to Not Ready.</p>";
    }
    if (presence === "ready") {
      return "<p>Agent set to Ready.</p>";
    }
    return "<p>Agent presence updated.</p>";
  }
  if (tool.tool === "acknowledge_not_ready_escalation") {
    return "<p>Escalation acknowledged.</p>";
  }
  if (tool.tool === "acknowledge_proactive_callback") {
    return "<p>Proactive callback alert acknowledged.</p>";
  }
  if (tool.tool === "ask_ontology_layer") {
    const answer = typeof result?.answer === "string" ? result.answer.trim() : "";
    if (answer) return answer;
    if (tool.error) return `<p>${tool.error}</p>`;
  }

  return null;
}
