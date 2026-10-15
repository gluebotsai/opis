import { CheckCircle2, LoaderCircle, ShieldAlert } from "lucide-react";
import type { ReactNode } from "react";

import { CopilotMark } from "@/components/brand/CopilotMark";
import { StatusBanner } from "@/components/ui/status-banner";
import type { ToolStatus } from "@/features/assistant/copilot-engine";
import { cn } from "@/lib/utils";

export function ToolCardShell({
  toolName,
  status,
  statusLine,
  preview,
  children,
  footer,
}: {
  toolName: string;
  status: ToolStatus;
  statusLine: string;
  preview?: boolean;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "w-full max-w-[92%] overflow-hidden rounded-2xl bg-white shadow-md shadow-neutral-900/8 transition-colors",
      )}
    >
      <div
        className={cn(
          "flex items-center gap-2.5 border-b px-3.5 py-2.5",
          status === "success"
            ? "border-emerald-100 bg-emerald-50"
            : status === "error"
              ? "border-red-100 bg-red-50"
              : "border-neutral-100 bg-neutral-50",
        )}
      >
        {status === "collecting" ? (
          <CopilotMark />
        ) : (
          <div
            className={cn(
              "flex size-7 shrink-0 items-center justify-center rounded-full",
              status === "success"
                ? "bg-emerald-500 text-white"
                : status === "error"
                  ? "bg-red-500 text-white"
                  : "bg-black text-white",
            )}
          >
            {status === "running" ? (
              <LoaderCircle className="size-3.5 animate-spin" />
            ) : status === "success" ? (
              <CheckCircle2 className="size-4" />
            ) : (
              <ShieldAlert className="size-3.5" />
            )}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-neutral-900">{toolName}</p>
          <p className="text-[11px] text-neutral-600">{statusLine}</p>
        </div>
        {status === "success" && preview ? (
          <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium tracking-wide text-emerald-700 uppercase">
            Preview
          </span>
        ) : null}
      </div>

      <div className="px-3.5 py-3">{children}</div>

      {footer ? (
        <div className="border-t-[0.6px] border-[#bfbfbf] bg-neutral-50 px-3.5 py-2">{footer}</div>
      ) : null}
    </div>
  );
}

export function ToolFieldRow({
  label,
  value,
  index = 0,
  valueClassName,
}: {
  label: string;
  value: ReactNode;
  index?: number;
  valueClassName?: string;
}) {
  return (
    <div
      className="animate-in fade-in slide-in-from-bottom-1 flex items-baseline justify-between gap-3 text-[13px] duration-300"
      style={{ animationDelay: `${index * 110}ms`, animationFillMode: "both" }}
    >
      <span className="text-neutral-600">{label}</span>
      <span className={cn("max-w-[65%] truncate text-right font-medium text-neutral-900", valueClassName)}>
        {value}
      </span>
    </div>
  );
}

export function ToolRunningLine({ label }: { label: string }) {
  return (
    <div className="animate-in fade-in mt-2 flex items-center gap-2 border-t border-dashed border-[#bfbfbf] pt-2 text-[12px] text-neutral-600 duration-300">
      <LoaderCircle className="size-3 animate-spin" />
      {label}
    </div>
  );
}

export function ToolSuccessBanner({ children }: { children: ReactNode }) {
  return (
    <div className="animate-in fade-in zoom-in-95 mt-2.5 flex items-start gap-2 rounded-lg border border-emerald-100 bg-emerald-50 px-2.5 py-2 text-[12px] text-emerald-700 duration-300">
      <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

export function ToolErrorBanner({ children }: { children: ReactNode }) {
  return (
    <StatusBanner
      tone="error"
      icon={ShieldAlert}
      className="animate-in fade-in mt-2.5 duration-300"
    >
      {children}
    </StatusBanner>
  );
}

export function toolStatusLine(status: ToolStatus, collecting: string, running: string) {
  if (status === "collecting") return collecting;
  if (status === "running") return running;
  if (status === "success") return "Tool call complete";
  return "Tool call failed";
}
