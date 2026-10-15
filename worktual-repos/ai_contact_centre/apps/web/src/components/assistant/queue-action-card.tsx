import { ListChecks } from "lucide-react";

import type {
  DeleteQueueToolMessage,
  UpdateQueueStatusToolMessage,
} from "@/features/assistant/copilot-engine";
import {
  ToolCardShell,
  ToolErrorBanner,
  ToolFieldRow,
  ToolRunningLine,
  ToolSuccessBanner,
  toolStatusLine,
} from "@/components/assistant/tool-card-shell";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type QueueActionMessage = UpdateQueueStatusToolMessage | DeleteQueueToolMessage;

export function QueueActionCard({
  message,
  onOpenQueues,
}: {
  message: QueueActionMessage;
  onOpenQueues?: () => void;
}) {
  const isDelete = message.tool === "delete_queue";
  const { status, args, result, error } = message;

  const toolName = isDelete ? "delete_queue" : "update_queue_status";

  return (
    <ToolCardShell
      toolName={toolName}
      status={status}
      statusLine={toolStatusLine(
        status,
        "Reading your request…",
        isDelete ? "Calling tool — deleting queue…" : "Calling tool — updating status…",
      )}
      footer={
        status === "success" && onOpenQueues ? (
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-[11px] text-neutral-600">
              <ListChecks className="size-3.5 text-neutral-900" />
              {new Date(message.createdAt).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
            <Button variant="chip" onClick={onOpenQueues}>
              Open queues
            </Button>
          </div>
        ) : undefined
      }
    >
      <div className="space-y-1.5">
        <ToolFieldRow label="Queue" value={args.queueName} index={0} />
        {!isDelete && message.tool === "update_queue_status" ? (
          <ToolFieldRow
            label="Status"
            value={message.args.status === "active" ? "Active" : "Inactive"}
            index={1}
            valueClassName={cn(
              message.args.status === "active" ? "text-emerald-600" : "text-neutral-600",
            )}
          />
        ) : null}
        {isDelete ? (
          <ToolFieldRow label="Action" value="Delete" index={1} valueClassName="text-red-600" />
        ) : null}

        {status === "running" ? (
          <ToolRunningLine
            label={`Running ${toolName}("${args.queueName}")`}
          />
        ) : null}

        {status === "success" && result ? (
          <ToolSuccessBanner>
            {isDelete ? (
              <>
                Deleted queue <strong>{result.name}</strong>.
              </>
            ) : (
              <>
                <strong>{result.name}</strong> is now{" "}
                <strong>{result.status === "active" ? "active" : "inactive"}</strong>.
              </>
            )}
          </ToolSuccessBanner>
        ) : null}

        {status === "error" && error ? <ToolErrorBanner>{error}</ToolErrorBanner> : null}
      </div>
    </ToolCardShell>
  );
}
