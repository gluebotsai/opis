import { ListChecks } from "lucide-react";

import type { ListQueuesToolMessage } from "@/features/assistant/copilot-engine";
import {
  ToolCardShell,
  ToolErrorBanner,
  ToolRunningLine,
  toolStatusLine,
} from "@/components/assistant/tool-card-shell";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Fix import - I used ToolStatusLine which doesn't exist, use inline

export function ListQueuesCard({
  message,
  onOpenQueue,
  onOpenQueues,
}: {
  message: ListQueuesToolMessage;
  onOpenQueue?: (id: string) => void;
  onOpenQueues?: () => void;
}) {
  const { status, result, error } = message;

  return (
    <ToolCardShell
      toolName="list_queues"
      status={status}
      statusLine={toolStatusLine(
        status,
        "Fetching queues from your workspace…",
        "Calling tool — loading queues…",
      )}
      footer={
        status === "success" && onOpenQueues ? (
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-[11px] text-neutral-600">
              <ListChecks className="size-3.5 text-neutral-900" />
              {result?.queues.length ?? 0} queue(s)
            </span>
            <Button variant="chip" onClick={onOpenQueues}>
              Open queues
            </Button>
          </div>
        ) : undefined
      }
    >
      <div className="space-y-1.5">
        {status === "running" ? (
          <ToolRunningLine label="Running list_queues()" />
        ) : null}

        {status === "success" && result ? (
          <div className="space-y-2">
            {result.queues.length === 0 ? (
              <p className="text-[13px] text-neutral-600">No queues yet.</p>
            ) : (
              result.queues.map((queue, index) => (
                <button
                  key={queue.id}
                  type="button"
                  onClick={() => onOpenQueue?.(queue.id)}
                  className={cn(
                    "animate-in fade-in slide-in-from-bottom-1 flex w-full items-center justify-between gap-3 rounded-xl border-[0.6px] border-[#bfbfbf] bg-neutral-50 px-3 py-2 text-left text-[13px] transition hover:border-[#bfbfbf] hover:bg-white",
                  )}
                  style={{ animationDelay: `${index * 80}ms`, animationFillMode: "both" }}
                >
                  <span className="font-medium text-neutral-900">{queue.name}</span>
                  <span className="shrink-0 text-neutral-600">
                    {queue.teamName} ·{" "}
                    <span
                      className={queue.status === "active" ? "text-emerald-600" : "text-neutral-900"}
                    >
                      {queue.status}
                    </span>
                    {" · "}
                    {queue.agentCount} agent{queue.agentCount === 1 ? "" : "s"}
                  </span>
                </button>
              ))
            )}
          </div>
        ) : null}

        {status === "error" && error ? <ToolErrorBanner>{error}</ToolErrorBanner> : null}
      </div>
    </ToolCardShell>
  );
}
