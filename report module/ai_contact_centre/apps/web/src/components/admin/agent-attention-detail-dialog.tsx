import { useEffect, useState } from "react";
import { AlertTriangle, Info, LoaderCircle, Sparkles, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { monitoringApi, type AgentAttentionInsight } from "@/features/monitoring/api";

type AgentAttentionDetailDialogProps = {
  open: boolean;
  agentId: string;
  agentName: string;
  employeeId?: string | null;
  escalationId: string;
  preview?: {
    summary?: string;
    suggestion?: string;
    classification?: string;
  };
  onClose: () => void;
  onViewAgent: (agentId: string, escalationId: string) => void;
};

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder > 0 ? `${hours}h ${remainder}m` : `${hours}h`;
}

function formatPresenceSeconds(seconds: Record<string, number>, state: string): string {
  const value = seconds[state] ?? 0;
  if (value <= 0) return "0m";
  return formatMinutes(Math.round(value / 60));
}

export function AgentAttentionDetailDialog({
  open,
  agentId,
  agentName,
  employeeId,
  escalationId,
  preview,
  onClose,
  onViewAgent,
}: AgentAttentionDetailDialogProps) {
  const [insight, setInsight] = useState<AgentAttentionInsight | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) {
      setInsight(null);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    void monitoringApi
      .getAgentAttentionInsight(escalationId)
      .then((result) => {
        if (!cancelled) setInsight(result.insight);
      })
      .catch((reason) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : "Unable to load insight");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, escalationId]);

  if (!open) return null;

  const summary = insight?.summary ?? preview?.summary ?? null;
  const suggestion = insight?.suggestion ?? preview?.suggestion ?? null;
  const classificationLabel = insight?.classificationLabel ?? preview?.classification ?? null;
  const context = insight?.context;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/35 p-4"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="agent-attention-title"
        className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-600">
              <AlertTriangle className="size-5" />
            </span>
            <div>
              <p id="agent-attention-title" className="text-base font-semibold text-neutral-900">
                {agentName} needs attention
              </p>
              {employeeId?.trim() ? (
                <p className="mt-0.5 text-sm text-neutral-600">Employee ID: {employeeId.trim()}</p>
              ) : null}
              {classificationLabel ? (
                <p className="mt-0.5 text-xs font-medium text-red-700">{classificationLabel}</p>
              ) : null}
            </div>
          </div>
          <button
            type="button"
            aria-label="Close"
            className="rounded-lg p-1 text-neutral-600 hover:bg-neutral-100 hover:text-neutral-800"
            onClick={onClose}
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="mt-4 space-y-4">
          {loading && !summary ? (
            <div className="flex items-center gap-2 text-sm text-neutral-600">
              <LoaderCircle className="size-4 animate-spin" />
              Generating supervisor insight…
            </div>
          ) : null}

          {error && !summary ? (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{error}</p>
          ) : null}

          {summary ? (
            <div className="rounded-xl border-[0.6px] border-[#bfbfbf] bg-neutral-50/80 p-3">
              <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-600">
                <Info className="size-3.5" />
                Summary
              </div>
              <p className="text-sm leading-relaxed text-neutral-800">{summary}</p>
            </div>
          ) : null}

          {suggestion ? (
            <div className="rounded-xl border border-sky-100 bg-sky-50/70 p-3">
              <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-sky-700">
                <Sparkles className="size-3.5" />
                Suggested action
              </div>
              <p className="text-sm leading-relaxed text-sky-950">{suggestion}</p>
            </div>
          ) : null}

          {context ? (
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-lg border-[0.6px] border-[#bfbfbf] px-3 py-2">
                <p className="text-neutral-600">Handled today</p>
                <p className="font-semibold text-neutral-900">{context.todayKpis.handled}</p>
              </div>
              <div className="rounded-lg border-[0.6px] border-[#bfbfbf] px-3 py-2">
                <p className="text-neutral-600">Not Ready today</p>
                <p className="font-semibold text-neutral-900">
                  {formatPresenceSeconds(context.presenceTodaySeconds, "not_ready")}
                </p>
              </div>
            </div>
          ) : null}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="outline" className="h-[38px] gap-1.5 px-3 text-xs" onClick={onClose}>
            Close
          </Button>
          <Button type="button" onClick={() => onViewAgent(agentId, escalationId)}>
            View agent
          </Button>
        </div>
      </div>
    </div>
  );
}
