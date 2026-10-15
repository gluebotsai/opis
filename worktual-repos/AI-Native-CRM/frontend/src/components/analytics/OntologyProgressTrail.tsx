import type { OntologyProgressStep } from "@/services/agent-stream";

function statusTone(status: string | undefined): string {
  const s = (status || "").toLowerCase();
  if (s === "completed" || s === "success") return "bg-emerald-500";
  if (s === "failed" || s === "error") return "bg-rose-500";
  return "bg-neutral-400";
}

/** Collapsible trail of ontology SSE progress (status / activity / tool blocks). */
export function OntologyProgressTrail({
  steps,
}: {
  steps: OntologyProgressStep[];
}) {
  if (!steps.length) return null;
  const compact = steps.filter((step, index) => {
    if (step.kind !== "status") return true;
    const prev = steps[index - 1];
    return !(prev && prev.kind === "status" && prev.label === step.label);
  });
  const shown = compact.slice(-12);

  return (
    <details className="w-full max-w-full rounded-xl border border-neutral-200 bg-white px-3.5 py-2.5 text-left shadow-2xs">
      <summary className="cursor-pointer list-none text-sm font-medium text-neutral-800 [&::-webkit-details-marker]:hidden">
        Analysis steps
        <span className="ml-2 text-xs font-normal text-neutral-500">
          {shown.length} shown
        </span>
      </summary>
      <ol className="mt-2 space-y-1.5 border-t border-neutral-100 pt-2">
        {shown.map((step, index) => (
          <li key={`${step.kind}-${step.stepId || step.label}-${index}`} className="flex gap-2">
            <span
              className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${statusTone(step.status)}`}
              aria-hidden
            />
            <div className="min-w-0">
              <p className="text-xs font-medium leading-4 text-neutral-800">{step.label}</p>
              {step.detail ? (
                <p className="mt-0.5 text-[11px] leading-4 text-neutral-500">{step.detail}</p>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </details>
  );
}
