import { useEffect, useId, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Check,
  Circle,
  FileText,
  Loader2,
  Mail,
  X,
} from "lucide-react";
import { ContentFadeIn } from "@/components/skeleton";
import { useEmbedPageReady } from "@/hooks/useEmbedPageReady";
import {
  mapApiRunToOnDemandRun,
  onDemandSourceLabel,
  onDemandStatusClass,
  onDemandStatusLabel,
  onDemandStepStatusClass,
  type OnDemandChecklistStep,
  type OnDemandRun,
} from "@/lib/on-demand-sends-mock";
import { getOnDemandRunApi } from "@/services/on-demand.service";

function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium text-neutral-500">{label}</p>
      <p className="mt-0.5 break-all text-sm text-neutral-900">{value}</p>
    </div>
  );
}

function MetricStat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number | string;
  tone?: "default" | "success" | "danger" | "muted";
}) {
  const valueCls =
    tone === "success"
      ? "text-emerald-700"
      : tone === "danger"
        ? "text-red-700"
        : tone === "muted"
          ? "text-neutral-500"
          : "text-neutral-900";
  return (
    <div className="rounded-xl border border-neutral-100 bg-neutral-50 px-4 py-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-neutral-500">
        {label}
      </p>
      <p
        className={`mt-1 text-2xl font-semibold tabular-nums tracking-tight ${valueCls}`}
      >
        {typeof value === "number" ? value.toLocaleString() : value}
      </p>
    </div>
  );
}

function StepIcon({ status }: { status: OnDemandChecklistStep["status"] }) {
  const cls = `inline-flex size-6 shrink-0 items-center justify-center rounded-full border ${onDemandStepStatusClass(status)}`;
  if (status === "done") {
    return (
      <span className={cls}>
        <Check className="size-3.5" strokeWidth={2.5} />
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className={cls}>
        <X className="size-3.5" strokeWidth={2.5} />
      </span>
    );
  }
  if (status === "active") {
    return (
      <span className={cls}>
        <Loader2 className="size-3.5 animate-spin" strokeWidth={2.5} />
      </span>
    );
  }
  return (
    <span className={cls}>
      <Circle className="size-2.5 fill-current" strokeWidth={0} />
    </span>
  );
}

function Checklist({ steps }: { steps: OnDemandChecklistStep[] }) {
  const list = Array.isArray(steps) ? steps : [];
  return (
    <ol className="relative space-y-0">
      {list.map((step, i) => {
        const last = i === list.length - 1;
        return (
          <li key={step.id || `step-${i}`} className="relative flex gap-3 pb-5 last:pb-0">
            {!last ? (
              <span
                className="absolute top-6 bottom-0 left-[11px] w-px bg-neutral-200"
                aria-hidden
              />
            ) : null}
            <StepIcon status={step.status || "pending"} />
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-medium text-neutral-900">
                  {step.label}
                </p>
                <p className="text-[11px] tabular-nums text-neutral-400">
                  {formatWhen(step.at)}
                </p>
              </div>
              {step.detail ? (
                <p className="mt-0.5 text-xs text-neutral-500">{step.detail}</p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function TemplatePreviewCard({
  run,
  onOpen,
}: {
  run: OnDemandRun;
  onOpen: () => void;
}) {
  const body = String(run.bodyPreview || "");
  const snippet = body.replace(/\s+/g, " ").trim().slice(0, 120);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group w-full rounded-2xl border border-neutral-200 bg-gradient-to-br from-white to-neutral-50 p-4 text-left shadow-sm transition hover:border-neutral-300 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/20"
    >
      <div className="flex items-start gap-3">
        <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl bg-neutral-900 text-white shadow-sm">
          <Mail className="size-5" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-semibold text-neutral-900 group-hover:underline">
              {run.templateName || "Inline content"}
            </p>
            <span className="rounded-full border border-neutral-200 bg-white px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-neutral-500">
              {run.channel}
            </span>
          </div>
          {run.templateId ? (
            <p className="mt-0.5 truncate text-[11px] text-neutral-400">
              {run.templateId}
            </p>
          ) : (
            <p className="mt-0.5 text-[11px] text-neutral-400">
              Written for this run (no library template)
            </p>
          )}
          <p className="mt-2 truncate text-xs font-medium text-neutral-700">
            {run.subject || "—"}
          </p>
          <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-neutral-500">
            {snippet}
            {body.length > 120 ? "…" : ""}
          </p>
          <p className="mt-3 text-[11px] font-medium text-neutral-900 opacity-70 group-hover:opacity-100">
            Click to preview full template →
          </p>
        </div>
      </div>
    </button>
  );
}

function TemplatePopup({
  run,
  open,
  onClose,
}: {
  run: OnDemandRun;
  open: boolean;
  onClose: () => void;
}) {
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex max-h-[min(90vh,40rem)] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-neutral-100 px-5 py-4">
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-wide text-neutral-400">
              Template preview
            </p>
            <h2
              id={titleId}
              className="mt-0.5 truncate text-base font-semibold text-neutral-900"
            >
              {run.templateName || "Inline content"}
            </h2>
            {run.templateId ? (
              <p className="mt-0.5 text-xs text-neutral-500">{run.templateId}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900"
            aria-label="Close"
          >
            <X className="size-4" strokeWidth={1.75} />
          </button>
        </div>
        <div className="chat-scroll-xs min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="rounded-xl border border-neutral-200 bg-[#fafafa] p-4">
            <div className="flex items-center gap-2 border-b border-neutral-200/80 pb-3">
              <FileText className="size-4 text-neutral-400" strokeWidth={1.75} />
              <span className="text-[11px] font-medium uppercase tracking-wide text-neutral-400">
                Email
              </span>
            </div>
            <p className="mt-3 text-xs font-medium text-neutral-500">Subject</p>
            <p className="mt-1 text-sm font-semibold text-neutral-900">
              {run.subject}
            </p>
            <p className="mt-4 text-xs font-medium text-neutral-500">Body</p>
            <pre className="mt-1 whitespace-pre-wrap font-sans text-sm leading-relaxed text-neutral-800">
              {run.bodyPreview}
            </pre>
          </div>
        </div>
        <div className="border-t border-neutral-100 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-full items-center justify-center rounded-lg bg-neutral-900 text-sm font-medium text-white hover:bg-neutral-800"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/** In-pane or full-page on-demand detail body (no layout chrome). */
export function OnDemandSendDetailBody({
  runId,
  embedded = false,
}: {
  runId: string;
  /** Hide top back link when parent pane already provides one. */
  embedded?: boolean;
}) {
  const [run, setRun] = useState<OnDemandRun | null>(null);
  const [loading, setLoading] = useState(Boolean(runId));
  const [templateOpen, setTemplateOpen] = useState(false);
  useEmbedPageReady(!loading);

  useEffect(() => {
    if (!runId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const apiRun = await getOnDemandRunApi(runId);
        if (cancelled) return;
        if (apiRun) {
          setRun(mapApiRunToOnDemandRun(apiRun));
        } else {
          setRun(null);
        }
      } catch {
        if (!cancelled) setRun(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [runId]);

  if (loading) {
    return (
      <div
        className={`flex min-h-[16rem] flex-col items-center justify-center gap-2 px-6 ${
          embedded ? "" : "h-full bg-[#f3f4f6]"
        }`}
      >
        <Loader2 className="size-5 animate-spin text-neutral-400" />
        <p className="text-sm text-neutral-500">Loading on-demand send…</p>
      </div>
    );
  }

  if (!run) {
    return (
      <div
        className={`flex flex-col items-center justify-center gap-3 px-6 ${
          embedded ? "min-h-[16rem]" : "h-full bg-[#f3f4f6]"
        }`}
      >
        <p className="text-sm font-medium text-neutral-900">
          On-demand send not found
        </p>
        {!embedded ? (
          <Link
            to="/campaigns?tab=on-demand"
            className="text-sm font-medium text-neutral-600 underline hover:text-neutral-900"
          >
            Back to On-demand
          </Link>
        ) : null}
      </div>
    );
  }

  const deliveredLabel =
    (Number(run.audienceCount) || 0) > 0
      ? `${(Number(run.sent) || 0).toLocaleString()} / ${(Number(run.audienceCount) || 0).toLocaleString()}`
      : String(Number(run.sent) || 0);

  return (
    <div
      className={
        embedded
          ? "flex min-h-0 flex-col"
          : "flex h-full min-h-0 flex-col overflow-y-auto bg-[#f3f4f6]"
      }
    >
      <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
        {!embedded ? (
          <Link
            to="/campaigns?tab=on-demand"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-neutral-600 hover:text-neutral-900"
          >
            <ArrowLeft className="size-4" strokeWidth={1.75} />
            On-demand
          </Link>
        ) : null}

        <ContentFadeIn className={embedded ? "space-y-4" : "mt-4 space-y-4"}>
          <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h1 className="text-xl font-semibold tracking-tight text-neutral-900">
                  {run.title}
                </h1>
                <p className="mt-1 text-xs text-neutral-500">Run id {run.id}</p>
              </div>
              <span
                className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${onDemandStatusClass(run.status)}`}
              >
                {onDemandStatusLabel(run.status)}
              </span>
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Source" value={onDemandSourceLabel(run.source)} />
              <Field label="Channel" value={run.channel} />
              <Field
                label="Audience"
                value={`${(Number(run.audienceCount) || 0).toLocaleString()} · ${run.audienceHint || "—"}`}
              />
              <Field
                label="Schedule"
                value={
                  run.scheduledAt
                    ? formatWhen(run.scheduledAt)
                    : "Send as soon as ready"
                }
              />
              <Field label="Created" value={formatWhen(run.createdAt)} />
              <Field label="Updated" value={formatWhen(run.updatedAt)} />
            </div>
          </div>

          <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-neutral-900">
              Template
            </h2>
            <p className="mt-1 text-xs text-neutral-500">
              Content used for this send — open the card to preview
            </p>
            <div className="mt-3">
              <TemplatePreviewCard
                run={run}
                onOpen={() => setTemplateOpen(true)}
              />
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
            <div className="space-y-4">
              <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
                <h2 className="text-sm font-semibold text-neutral-900">
                  Checklist
                </h2>
                <p className="mt-1 text-xs text-neutral-500">
                  Request → agent → contacts → content → plan → send
                </p>
                <div className="mt-4">
                  <Checklist steps={run.checklist} />
                </div>
              </div>

              <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
                <h2 className="text-sm font-semibold text-neutral-900">
                  What the agent thought
                </h2>
                <p className="mt-1 text-xs text-neutral-500">
                  Decisions the agent made for this run
                </p>
                <ul className="mt-4 space-y-2.5">
                  {(run.agentThought || []).map((line) => (
                    <li key={line} className="flex items-start gap-2.5">
                      <span className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700">
                        <Check className="size-3" strokeWidth={2.5} />
                      </span>
                      <span className="text-sm leading-snug text-neutral-800">
                        {line}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm lg:sticky lg:top-4">
              <h2 className="text-sm font-semibold text-neutral-900">
                Performance
              </h2>
              <p className="mt-1 text-xs text-neutral-500">
                Outcomes for this launched send — numbers only
              </p>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <MetricStat label="Audience" value={run.audienceCount} />
                <MetricStat
                  label="Sent"
                  value={run.sent}
                  tone="success"
                />
                <MetricStat
                  label="Failed"
                  value={run.failed}
                  tone={run.failed > 0 ? "danger" : "default"}
                />
                <MetricStat
                  label="Pending"
                  value={run.pending}
                  tone="muted"
                />
                {run.openRate != null ? (
                  <MetricStat
                    label="Open rate"
                    value={`${(run.openRate * 100).toFixed(1)}%`}
                  />
                ) : null}
                {run.clickRate != null ? (
                  <MetricStat
                    label="Click rate"
                    value={`${(run.clickRate * 100).toFixed(1)}%`}
                  />
                ) : null}
                <MetricStat label="Opens" value={run.opens ?? 0} />
                <MetricStat label="Clicks" value={run.clicks ?? 0} />
              </div>
              {(run.channelMetrics || []).length > 0 ? (
                <ul className="mt-4 space-y-2 border-t border-neutral-100 pt-4">
                  {(run.channelMetrics || []).map((c) => (
                    <li
                      key={c.channel}
                      className="flex flex-wrap items-baseline justify-between gap-2 text-xs text-neutral-600"
                    >
                      <span className="font-medium capitalize text-neutral-800">
                        {c.channel}
                      </span>
                      <span>
                        {c.openRate != null
                          ? `${(c.openRate * 100).toFixed(1)}% open`
                          : "opens n/a"}
                        {" · "}
                        {c.clickRate != null
                          ? `${(c.clickRate * 100).toFixed(1)}% click`
                          : "clicks n/a"}
                        {` · ${c.delivered} delivered`}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="mt-3 rounded-xl border border-neutral-100 bg-white px-4 py-3">
                <p className="text-[11px] font-medium uppercase tracking-wide text-neutral-500">
                  Delivered
                </p>
                <p className="mt-1 text-lg font-semibold tabular-nums text-neutral-900">
                  {deliveredLabel}
                </p>
                <p className="mt-0.5 text-xs text-neutral-500">
                  Sent of total audience
                </p>
              </div>
            </div>
          </div>
        </ContentFadeIn>
      </div>

      <TemplatePopup
        run={run}
        open={templateOpen}
        onClose={() => setTemplateOpen(false)}
      />
    </div>
  );
}

/** On-demand send detail — request, template card, checklist, agent thought. */
export function OnDemandSendDetailPage() {
  const { runId } = useParams();
  if (!runId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-[#f3f4f6] px-6">
        <p className="text-sm font-medium text-neutral-900">
          On-demand send not found
        </p>
        <Link
          to="/campaigns?tab=on-demand"
          className="text-sm font-medium text-neutral-600 underline hover:text-neutral-900"
        >
          Back to On-demand
        </Link>
      </div>
    );
  }
  return <OnDemandSendDetailBody runId={runId} />;
}
