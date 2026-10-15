import { Check, Circle, PanelRightClose, Sparkles } from "lucide-react";
import { PanelExpandButton } from "@/components/assistant/copilot-workspace";
import { IconButton } from "@/components/ui/IconButton";
import { PanelScrollArea } from "@/components/ui/PanelScrollArea";
import {
  computeFieldProgress,
  createGuidedFields,
  displayDraftValue,
  draftIsCreateReady,
  guidedDraftTitle,
  nextEmptyGuidedKey,
  type GuidedFieldKey,
} from "@/lib/contact-guided-fields";
import type { ContactCandidate, ContactDraftFields } from "@/services/agents.socket";

type ContactGuidedPreviewProps = {
  draft: ContactDraftFields;
  b2c: boolean;
  candidates?: ContactCandidate[];
  onClose: () => void;
  onSelectCandidate?: (candidate: ContactCandidate) => void;
  title?: string;
  nextQuestion?: string | null;
};

function hintMatchesField(key: GuidedFieldKey, question: string): boolean {
  const q = question.toLowerCase();
  if (key === "first_name") return q.includes("first name");
  if (key === "last_name") {
    return q.includes("last name") || q.includes("surname") || q.includes("family name");
  }
  if (key === "email") {
    return q.includes("email");
  }
  if (key === "phone") {
    return q.includes("phone") || q.includes("country code") || q.includes("mobile");
  }
  if (key === "company_name") return q.includes("company");
  if (key === "city") return q.includes("city") || q.includes("town");
  return false;
}

export function ContactGuidedPreview({
  draft,
  b2c,
  candidates = [],
  onClose,
  onSelectCandidate,
  title,
  nextQuestion,
}: ContactGuidedPreviewProps) {
  const fieldDefs = createGuidedFields(b2c);
  const progress = computeFieldProgress(draft, b2c);
  const ready = draftIsCreateReady(draft);
  const chatQ = (nextQuestion || "").trim();

  const nextKey: GuidedFieldKey | null = (() => {
    if (chatQ) {
      for (const { key } of fieldDefs) {
        if (!displayDraftValue(key, draft) && hintMatchesField(key, chatQ)) {
          return key;
        }
      }
    }
    return nextEmptyGuidedKey(draft, b2c);
  })();

  const completed = fieldDefs.filter(({ key }) => Boolean(displayDraftValue(key, draft)));
  const upNextList = fieldDefs.filter(({ key }) => !displayDraftValue(key, draft));

  const nextHint = (key: GuidedFieldKey | null): string => {
    if (key && chatQ && hintMatchesField(key, chatQ)) return chatQ;
    return "Answer in the conversation.";
  };

  return (
    <div className="animate-in fade-in flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-[0_8px_30px_rgba(15,23,42,0.06)] duration-500">
      <div className="shrink-0 border-b border-neutral-100 px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
              {title || "Contact setup"}
            </p>
            <h2 className="mt-1 truncate text-xl font-semibold tracking-tight text-neutral-900">
              {guidedDraftTitle(draft)}
            </h2>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <PanelExpandButton side="right" />
            <IconButton onClick={onClose} aria-label="Close contact setup">
              <PanelRightClose className="size-4" />
            </IconButton>
          </div>
        </div>

        <div className="mt-3">
          <div className="mb-1.5 flex items-center justify-between text-[11px] text-neutral-500">
            <span className="font-medium text-neutral-800">
              {progress.percent}% complete
            </span>
            <span>
              {progress.done} done · {progress.left} left
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-neutral-100">
            <div
              className="h-full rounded-full bg-neutral-900 transition-all duration-500"
              style={{ width: `${progress.percent}%` }}
            />
          </div>
        </div>

        {ready ? (
          <div className="mt-3 flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-3 text-xs text-emerald-900">
            <Sparkles className="mt-0.5 size-3.5 shrink-0" />
            <div>
              <p className="font-semibold">Ready to create</p>
              <p className="mt-0.5 text-emerald-800/90">
                Just tell me when you&apos;re ready — optional details can wait.
              </p>
            </div>
          </div>
        ) : null}
      </div>

      <PanelScrollArea className="min-h-0 flex-1 px-5 py-4">
        {upNextList.length > 0 ? (
          <section>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
              Up next
            </p>
            <ul className="space-y-1.5">
              {upNextList.map(({ key, label, required, optional }) => {
                const active = key === nextKey;
                const requiredMark = required ? (
                  <span className="ml-0.5 text-neutral-900" aria-hidden="true">
                    *
                  </span>
                ) : null;
                const labelClass = required ? "text-neutral-900" : "text-neutral-500";
                return (
                  <li
                    key={key}
                    className={
                      active
                        ? "rounded-xl border border-neutral-900/15 bg-neutral-50 px-3.5 py-3 shadow-sm"
                        : "flex items-center gap-2 px-1 py-1.5 text-xs"
                    }
                  >
                    {active ? (
                      <div className="flex items-start gap-2.5">
                        <span className="relative mt-0.5 flex size-4 shrink-0 items-center justify-center">
                          <span className="absolute inset-0 animate-ping rounded-full bg-neutral-900/10" />
                          <span className="relative size-4 rounded-full border-2 border-neutral-900 bg-white" />
                        </span>
                        <div className="min-w-0">
                          <p className={`text-sm font-semibold ${labelClass}`}>
                            {label}
                            {requiredMark}
                            {optional ? (
                              <span className="ml-1 font-normal text-neutral-400">
                                (optional)
                              </span>
                            ) : null}
                          </p>
                          <p className="mt-0.5 text-xs text-neutral-500">
                            {nextHint(key)}
                          </p>
                        </div>
                      </div>
                    ) : (
                      <>
                        <Circle className="size-3.5 shrink-0 text-neutral-500" />
                        <span className={labelClass}>
                          {label}
                          {requiredMark}
                        </span>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        <section className={upNextList.length > 0 ? "mt-5" : undefined}>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
              Completed
            </p>
            <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-500">
              {completed.length}
            </span>
          </div>
          {completed.length ? (
            <ul className="space-y-2">
              {completed.map(({ key, label, required }, index) => (
                <li
                  key={key}
                  className="animate-in fade-in slide-in-from-bottom-1 flex items-start gap-2.5 rounded-xl border border-neutral-100 bg-neutral-50/80 px-3 py-2.5 duration-300"
                  style={{
                    animationDelay: `${index * 45}ms`,
                    animationFillMode: "both",
                  }}
                >
                  <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">
                    <Check className="size-2.5" strokeWidth={3} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p
                      className={`text-[11px] ${required ? "text-neutral-900" : "text-neutral-500"}`}
                    >
                      {label}
                      {required ? (
                        <span className="ml-0.5 text-neutral-900" aria-hidden="true">
                          *
                        </span>
                      ) : null}
                    </p>
                    <p className="break-words text-sm font-medium text-neutral-900">
                      {displayDraftValue(key, draft)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-neutral-400">No fields collected yet.</p>
          )}
        </section>

        {candidates.length > 0 ? (
          <section className="mt-5">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
              Existing match
            </p>
            <ul className="space-y-2">
              {candidates.map((c, idx) => (
                <li key={c.id || `${idx}`}>
                  <button
                    type="button"
                    onClick={() => c.id && onSelectCandidate?.(c)}
                    className="w-full rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-2.5 text-left text-sm transition hover:border-amber-300 hover:bg-amber-50"
                  >
                    <p className="font-medium text-neutral-900">
                      {[c.first_name, c.last_name].filter(Boolean).join(" ") ||
                        c.email ||
                        c.phone ||
                        "Match"}
                    </p>
                    <p className="mt-0.5 text-xs text-neutral-500">
                      {[c.email, c.phone].filter(Boolean).join(" · ") || "—"}
                    </p>
                    <p className="mt-1 text-[11px] font-medium text-amber-800">
                      Tap to open this contact
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </PanelScrollArea>
    </div>
  );
}
