import { Loader2 } from "lucide-react";

const DEFAULT_LABEL = "Agent is preparing a response";

/**
 * Shared busy/typing pill — create-campaign style (label + spinner).
 * Use in every co-worker chat while the agent is working.
 */
export function AgentThinkingIndicator({
  label,
}: {
  /** Live progress label; falls back to the create-campaign default. */
  label?: string | null;
}) {
  const text = String(label || "").trim() || DEFAULT_LABEL;
  return (
    <div className="flex justify-start" role="status" aria-live="polite">
      <div className="inline-flex items-center gap-2 rounded-2xl border border-border-default bg-surface px-3.5 py-2.5 text-xs text-text-caption">
        <span>{text}</span>
        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
      </div>
    </div>
  );
}

export const AGENT_THINKING_DEFAULT_LABEL = DEFAULT_LABEL;
