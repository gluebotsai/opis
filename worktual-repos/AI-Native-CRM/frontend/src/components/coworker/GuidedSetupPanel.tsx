import { Check } from "lucide-react";
import { BackLink } from "@/components/ui/BackLink";
import { Button } from "@/components/ui/Button";
import type { ResolvedSetupStep } from "@/lib/coworker/guided-setup-steps";
import { setupProgress } from "@/lib/coworker/guided-setup-steps";

/**
 * Queue-setup-style progress panel for chat-driven create.
 * No form fields — chat owns answers; this mirrors draft state.
 */
export function GuidedSetupPanel({
  setupTitle,
  headline,
  steps,
  createLabel = "Create",
  createDisabled = false,
  createBusy = false,
  error = null,
  onCreate,
  onClear,
  onCancel,
  secondaryAction,
  /** Override step-flag ready (e.g. contact email OR phone). */
  essentialsReady,
}: {
  setupTitle: string;
  headline: string;
  steps: ResolvedSetupStep[];
  createLabel?: string;
  createDisabled?: boolean;
  createBusy?: boolean;
  error?: string | null;
  onCreate?: () => void;
  onClear?: () => void;
  onCancel?: () => void;
  /** Optional extra footer action (e.g. open full invoice builder). */
  secondaryAction?: { label: string; onClick: () => void };
  essentialsReady?: boolean;
}) {
  const progress = setupProgress(steps);
  const current = steps.find((s) => s.status === "current") ?? null;
  const pending = steps.filter((s) => s.status === "pending");
  const completed = steps.filter((s) => s.status === "completed").reverse();
  const requiredReady =
    typeof essentialsReady === "boolean" ? essentialsReady : progress.ready;
  const allDone = !current && pending.length === 0;

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-2xl border-[0.6px] border-[#bfbfbf] bg-white shadow-none">
      <header className="shrink-0 border-b border-[#bfbfbf]/80 px-5 py-4">
        {onCancel ? (
          <BackLink onClick={onCancel} className="mb-2">
            Back
          </BackLink>
        ) : null}
        <p className="text-[11px] font-semibold tracking-[0.14em] text-neutral-400 uppercase">
          {setupTitle}
        </p>
        <h2 className="mt-1 truncate text-xl font-semibold tracking-tight text-neutral-900">
          {headline || setupTitle}
        </h2>
        <p className="mt-1.5 text-xs font-medium text-neutral-500">
          <span className="tabular-nums text-neutral-800">
            {progress.percent}%
          </span>
          <span className="text-neutral-400"> complete</span>
          <span className="text-neutral-300"> · </span>
          <span className="tabular-nums">
            {progress.filled} done · {progress.left} left
          </span>
        </p>
      </header>

      <div className="h-2 w-full shrink-0 bg-neutral-100">
        <div
          className="h-full bg-neutral-900 transition-[width] duration-500 ease-out"
          style={{ width: `${progress.percent}%` }}
        />
      </div>

      <div className="scrollbar-hover flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-5">
        {requiredReady ? (
          <section className="crm-fade-in rounded-xl border border-emerald-200/80 bg-emerald-50/60 px-4 py-4">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">
                <Check className="size-3.5" strokeWidth={2.5} />
              </span>
              <div>
                <p className="text-sm font-semibold text-neutral-900">
                  Ready to create
                </p>
                <p className="mt-0.5 text-xs text-neutral-600">
                  Just tell me when you're ready
                  {allDone ? "." : " — optional details can wait."}
                </p>
              </div>
            </div>
          </section>
        ) : null}

        {!allDone ? (
          <section>
            <p className="mb-3 text-[10px] font-semibold tracking-[0.14em] text-neutral-400 uppercase">
              Up next
            </p>
            <ul className="flex flex-col gap-2">
              {current ? (
                <li className="crm-fade-in rounded-xl border border-neutral-200 bg-neutral-50 px-3.5 py-3 transition-all duration-200">
                  <div className="flex items-start gap-3">
                    <span
                      className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border-2 border-neutral-900"
                      aria-hidden
                    >
                      <span className="size-1.5 rounded-full bg-neutral-900" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-neutral-900">
                        {current.label}
                        {current.required ? null : (
                          <span className="ml-1.5 text-[10px] font-normal text-neutral-400">
                            optional
                          </span>
                        )}
                      </p>
                      <p className="mt-0.5 text-xs text-neutral-500">
                        Answer in the conversation.
                      </p>
                    </div>
                  </div>
                </li>
              ) : null}
              {pending.map((step) => (
                <li
                  key={step.id}
                  className="flex items-start gap-3 px-3.5 py-2 opacity-60"
                >
                  <span
                    className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-neutral-300"
                    aria-hidden
                  />
                  <p className="pt-0.5 text-sm font-medium text-neutral-400">
                    {step.label}
                    {step.required ? null : (
                      <span className="ml-1.5 text-[10px] font-normal">
                        optional
                      </span>
                    )}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {completed.length > 0 ? (
          <section>
            <p className="mb-3 text-[10px] font-semibold tracking-[0.14em] text-neutral-400 uppercase">
              Completed
            </p>
            <ul className="flex flex-col gap-2">
              {completed.map((step) => (
                <li
                  key={step.id}
                  className="crm-fade-in flex items-start gap-3 px-1 py-1.5"
                >
                  <span
                    className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white"
                    aria-hidden
                  >
                    <Check className="size-3" strokeWidth={2.5} />
                  </span>
                  <div className="min-w-0 pt-0.5">
                    <p className="text-sm font-medium text-neutral-900">
                      {step.label}
                    </p>
                    {step.value ? (
                      <p className="mt-0.5 truncate text-xs text-neutral-500">
                        {step.value}
                      </p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {error ? (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </p>
        ) : null}

        {onCreate || onClear || secondaryAction ? (
          <div className="mt-auto flex flex-wrap gap-2 border-t border-neutral-200/60 pt-4">
            {onCreate ? (
              <Button
                type="button"
                variant="primary"
                className="h-9"
                disabled={createDisabled || !progress.ready || createBusy}
                onClick={onCreate}
              >
                {createBusy ? "Creating…" : createLabel}
              </Button>
            ) : null}
            {secondaryAction ? (
              <Button
                type="button"
                variant="secondary"
                className="h-9"
                onClick={secondaryAction.onClick}
              >
                {secondaryAction.label}
              </Button>
            ) : null}
            {onClear ? (
              <Button
                type="button"
                variant="secondary"
                className="h-9"
                onClick={onClear}
              >
                Clear
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
