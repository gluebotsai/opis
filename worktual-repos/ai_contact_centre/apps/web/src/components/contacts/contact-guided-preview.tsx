import { ArrowRight, Check, Circle, PanelRightClose, Sparkles } from "lucide-react";

import { PanelExpandButton } from "@/components/assistant/copilot-workspace";
import { IconButton } from "@/components/ui/button";
import { PanelScrollArea } from "@/components/ui/panel-scroll-area";
import { StatusBanner } from "@/components/ui/status-banner";
import { contentPanel } from "@/lib/panel-chrome";
import type {
  ContactDraftField,
  ContactGuidedDraft,
} from "@/features/assistant/assistant-api";
import {
  coerceContactActive,
  listContactUpdateChanges,
  type ContactDraftSnapshot,
} from "@/features/assistant/contact-guided-draft";

const CREATE_CONTACT_FIELDS: Array<{ key: ContactDraftField; label: string }> = [
  { key: "firstName", label: "First name" },
  { key: "lastName", label: "Last name" },
  { key: "primaryEmail", label: "Primary email" },
  { key: "primaryPhone", label: "Primary phone" },
  { key: "secondaryPhone", label: "WhatsApp number" },
  { key: "gender", label: "Gender" },
  { key: "city", label: "City" },
  { key: "country", label: "Country" },
];

const UPDATE_CONTACT_FIELDS: Array<{ key: ContactDraftField; label: string }> = [
  { key: "firstName", label: "First name" },
  { key: "lastName", label: "Last name" },
  { key: "primaryEmail", label: "Primary email" },
  { key: "primaryPhone", label: "Primary phone" },
  { key: "secondaryEmail", label: "Secondary email" },
  { key: "secondaryPhone", label: "WhatsApp number" },
  { key: "gender", label: "Gender" },
  { key: "dateOfBirth", label: "Date of birth" },
  { key: "company", label: "Company" },
  { key: "industry", label: "Industry" },
  { key: "city", label: "City" },
  { key: "region", label: "Region" },
  { key: "country", label: "Country" },
  { key: "language", label: "Language" },
  { key: "timezone", label: "Timezone" },
  { key: "customFields", label: "Custom fields" },
  { key: "isActive", label: "Status" },
];

function hasValue(value: unknown): boolean {
  return value !== undefined && value !== null && value !== "";
}

function displayScalar(value: unknown): string {
  if (!hasValue(value) || typeof value === "object") return "";
  return String(value);
}

function displayValue(key: ContactDraftField, value: unknown): string {
  if (key === "isActive") {
    const active = coerceContactActive(value);
    if (active === null) return "—";
    return active ? "Active" : "Inactive";
  }
  if (!hasValue(value)) return "—";
  if (Array.isArray(value)) {
    const items = value.map(displayScalar).filter(Boolean);
    return items.length ? items.join(", ") : "—";
  }
  if (typeof value === "object") {
    const items = Object.entries(value as Record<string, unknown>)
      .map(([name, item]) => {
        const shown = displayScalar(item);
        return shown ? `${name}: ${shown}` : "";
      })
      .filter(Boolean);
    return items.length ? items.join(", ") : "—";
  }
  return String(value);
}

export function ContactGuidedPreview({
  draft,
  currentContact,
  onClose,
}: {
  draft: ContactGuidedDraft;
  currentContact?: ContactDraftSnapshot | null;
  onClose: () => void;
}) {
  const isUpdate = draft.mode === "update";
  const fieldDefs = isUpdate ? UPDATE_CONTACT_FIELDS : CREATE_CONTACT_FIELDS;
  const skipped = new Set(draft.skippedFields ?? []);
  const collected = fieldDefs.filter(({ key }) => hasValue(draft.fields[key]));
  const remaining =
    draft.ready || !draft.nextField
      ? []
      : fieldDefs.filter(
          ({ key }) =>
            key !== draft.nextField &&
            !hasValue(draft.fields[key]) &&
            !skipped.has(key),
        );
  const next = fieldDefs.find(({ key }) => key === draft.nextField);
  const completedCount = collected.length + fieldDefs.filter(({ key }) => skipped.has(key)).length;
  const progress = Math.round((completedCount / fieldDefs.length) * 100);
  const changes = isUpdate
    ? listContactUpdateChanges(draft.fields, currentContact, fieldDefs).filter(
        (change) => change.key !== draft.nextField,
      )
    : [];

  return (
    <div className={contentPanel("animate-in fade-in duration-500")}>
      <div className="shrink-0 border-b-[0.6px] border-[#bfbfbf] bg-gradient-to-br from-white via-white to-neutral-50 px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[18px] font-semibold text-neutral-900">
              {isUpdate ? "Contact update" : "Contact setup"}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <PanelExpandButton side="right" />
            <IconButton onClick={onClose} aria-label={isUpdate ? "Close contact update" : "Close contact setup"}>
              <PanelRightClose className="size-4" />
            </IconButton>
          </div>
        </div>
        {isUpdate ? (
          <p className="mt-3 text-sm text-neutral-600">
            {changes.length === 1 ? "1 change ready to review" : `${changes.length} changes ready to review`}
          </p>
        ) : (
          <div className="mt-3">
            <div className="mb-1.5 flex items-center justify-between text-sm text-neutral-600">
              <span className="font-medium text-neutral-700">{progress}% complete</span>
              <span>{completedCount} of {fieldDefs.length} fields collected</span>
            </div>
            <div className="relative h-2 overflow-hidden rounded-full bg-neutral-200">
              {progress < 100 ? (
                <div className="guided-progress-remaining pointer-events-none absolute inset-0" aria-hidden />
              ) : null}
              <div
                className="relative h-full bg-[#111111] transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}
      </div>

      <div className="shrink-0 px-5 py-4">
        <p className="mb-2 text-base font-semibold capitalize text-neutral-700">
          Up next
        </p>
        {next ? (
          <div className="flex items-start gap-2.5 rounded-xl border border-neutral-900/15 bg-white px-3.5 py-3">
            <span className="relative mt-0.5 flex size-4 shrink-0 items-center justify-center">
              <span className="absolute inset-0 animate-ping rounded-full bg-neutral-900/25" />
              <span className="relative size-4 rounded-full border-2 border-neutral-900 bg-white" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-neutral-900">{next.label}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-neutral-600">
                {draft.nextQuestion || "Answer this field in the conversation."}
              </p>
            </div>
          </div>
        ) : (
          <StatusBanner tone="success" icon={Sparkles}>
            Ready for confirmation.
          </StatusBanner>
        )}
      </div>

      <PanelScrollArea className="min-h-0 flex-1 px-5 py-4">
        {isUpdate ? (
          <section>
            <div className="mb-2 flex items-center gap-2">
              <p className="text-base font-semibold capitalize text-neutral-700">
                Changes
              </p>
              <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-900">
                {changes.length}
              </span>
            </div>
            {changes.length ? (
              <ul className="space-y-2">
                {changes.map(({ id, key, label, from, to }, index) => (
                  <li
                    key={id}
                    className="animate-in fade-in slide-in-from-bottom-1 flex items-start gap-2.5 rounded-xl border-[0.6px] border-[#bfbfbf] bg-white px-3 py-2.5 shadow-none duration-300"
                    style={{ animationDelay: `${index * 45}ms`, animationFillMode: "both" }}
                  >
                    <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">
                      <Check className="size-2.5" strokeWidth={3} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-neutral-600">{label}</p>
                      <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-sm">
                        <span className="min-w-0 truncate text-neutral-400">
                          {displayValue(key, from)}
                        </span>
                        <ArrowRight className="size-3.5 shrink-0 text-neutral-400" />
                        <span className="min-w-0 break-words font-medium text-neutral-900">
                          {displayValue(key, to)}
                        </span>
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-neutral-400">No field changes yet.</p>
            )}
          </section>
        ) : (
          <>
            <section>
              <div className="mb-2 flex items-center gap-2">
                <p className="text-base font-semibold capitalize text-neutral-700">
                  Collected
                </p>
                <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-900">
                  {collected.length}
                </span>
              </div>
              {collected.length ? (
                <ul className="space-y-2">
                  {collected.map(({ key, label }, index) => (
                    <li
                      key={key}
                      className="animate-in fade-in slide-in-from-bottom-1 flex items-start gap-2.5 rounded-xl border-[0.6px] border-[#bfbfbf] bg-white px-3 py-2.5 shadow-none duration-300"
                      style={{ animationDelay: `${index * 45}ms`, animationFillMode: "both" }}
                    >
                      <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">
                        <Check className="size-2.5" strokeWidth={3} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-neutral-600">{label}</p>
                        <p className="break-words text-sm font-medium text-neutral-900">
                          {displayValue(key, draft.fields[key])}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-neutral-400">No fields collected yet.</p>
              )}
            </section>

            {remaining.length > 0 ? (
              <section className="mt-5">
                <p className="mb-2 text-base font-semibold capitalize text-neutral-700">
                  Remaining fields
                </p>
                <ul className="grid grid-cols-2 gap-x-3 gap-y-1">
                  {remaining.map(({ key, label }) => (
                    <li key={key} className="flex min-w-0 items-center gap-2 py-1 text-sm text-neutral-600">
                      <Circle className="size-3.5 shrink-0" />
                      <span className="truncate">{label}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        )}
      </PanelScrollArea>
    </div>
  );
}
