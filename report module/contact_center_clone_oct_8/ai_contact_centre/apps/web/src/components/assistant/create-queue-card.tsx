import { ListChecks } from "lucide-react";

import type { CreateQueueToolMessage } from "@/features/assistant/copilot-engine";
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

const FIELD_ORDER: { key: keyof CreateQueueToolMessage["args"]; label: string }[] = [
  { key: "name", label: "Queue name" },
  { key: "teamName", label: "Team" },
  { key: "status", label: "Status" },
  { key: "description", label: "Description" },
];

function fieldValue(key: keyof CreateQueueToolMessage["args"], args: CreateQueueToolMessage["args"]) {
  const value = args[key];
  if (key === "status") return value === "active" ? "Active" : "Inactive";
  if (!value) return null;
  return String(value);
}

export function CreateQueueCard({
  message,
  onOpenQueues,
  actionLabel = "Open queues",
  preview = false,
}: {
  message: CreateQueueToolMessage;
  onOpenQueues?: () => void;
  actionLabel?: string;
  preview?: boolean;
}) {
  const { status, args, result, error } = message;
  const visibleFields = FIELD_ORDER.filter((field) => fieldValue(field.key, args) !== null);

  return (
    <ToolCardShell
      toolName="create_queue"
      status={status}
      statusLine={toolStatusLine(
        status,
        "Reading details from your message…",
        "Calling tool — creating queue…",
      )}
      preview={preview}
      footer={
        status === "success" ? (
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-[11px] text-neutral-600">
              <ListChecks className="size-3.5 text-neutral-900" />
              {new Date(result?.createdAt ?? message.createdAt).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
            {onOpenQueues ? (
              <Button variant="chip" onClick={onOpenQueues}>
                {actionLabel}
              </Button>
            ) : null}
          </div>
        ) : undefined
      }
    >
      <div className="space-y-1.5">
        {visibleFields.map((field, index) => (
          <ToolFieldRow
            key={field.key}
            label={field.label}
            value={fieldValue(field.key, args)}
            index={index}
            valueClassName={cn(
              field.key === "status" &&
                (args.status === "active" ? "text-emerald-600" : "text-neutral-600"),
            )}
          />
        ))}

        {status === "running" ? (
          <ToolRunningLine
            label={`Running create_queue(${args.name ? `"${args.name}"` : "…"})`}
          />
        ) : null}

        {status === "success" && result && !("_confirmation_required" in result) && result.id ? (
          <ToolSuccessBanner>
            Queue <strong>{args.name}</strong> created for <strong>{args.teamName}</strong>.
            {preview ? (
              <span className="mt-1 block text-emerald-600/80">
                Simulated for now — connect the real tool call to persist it.
              </span>
            ) : null}
          </ToolSuccessBanner>
        ) : null}

        {status === "error" && error ? <ToolErrorBanner>{error}</ToolErrorBanner> : null}
      </div>
    </ToolCardShell>
  );
}
