import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/Button";
import { MERGEABLE_FIELDS } from "@/lib/contact-merge-fields";
import {
  executeMerge,
  previewMerge,
  type MergePreview,
} from "@/services/contacts";

type Step = "select" | "primary" | "fields" | "summary" | "done";

export function MergeContactsWizard({
  contactIds,
  onClose,
  onMerged,
  title = "Merge contacts",
}: {
  contactIds: string[];
  onClose: () => void;
  onMerged?: () => void;
  title?: string;
}) {
  const [pending, setPending] = useState(false);
  const [step, setStep] = useState<Step>("primary");
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<MergePreview | null>(null);
  const [primaryId, setPrimaryId] = useState("");
  const [fieldSources, setFieldSources] = useState<Record<string, string>>({});
  const [mergedId, setMergedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPending(true);
    setError(null);
    void previewMerge(contactIds)
      .then((result) => {
        if (cancelled) return;
        setPending(false);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        // Support both flattened `{ contacts, … }` and nested `{ preview }` payloads.
        const payload =
          "preview" in result &&
          result.preview &&
          typeof result.preview === "object"
            ? (result.preview as MergePreview)
            : result;
        if (!payload.contacts?.length) {
          setError("Merge preview did not return any contacts.");
          return;
        }
        setPreview(payload);
        setPrimaryId(payload.recommendedPrimaryId);
        setFieldSources(payload.suggestedFieldSources ?? {});
        setStep("primary");
      })
      .catch((err) => {
        if (cancelled) return;
        setPending(false);
        setError(
          err instanceof Error ? err.message : "Failed to load merge preview.",
        );
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const duplicates = useMemo(
    () => (preview ? preview.contacts.filter((c) => c.id !== primaryId) : []),
    [preview, primaryId],
  );

  const conflictingFields = useMemo(() => {
    if (!preview) return [];
    return MERGEABLE_FIELDS.filter((field) => {
      const values = new Set(
        preview.contacts
          .map((c) => (c.values[field.key] ?? "").trim())
          .filter(Boolean),
      );
      return values.size > 1;
    });
  }, [preview]);

  const runMerge = () => {
    if (!primaryId || !preview) return;
    setError(null);
    setPending(true);
    void executeMerge({
      primaryContactId: primaryId,
      duplicateContactIds: duplicates.map((d) => d.id),
      fieldSources,
    }).then((result) => {
      setPending(false);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setMergedId(result.id);
      setStep("done");
      onMerged?.();
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="merge-contacts-title"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border-default bg-surface shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-border-default px-5 py-4">
          <h2
            id="merge-contacts-title"
            className="text-base font-semibold text-text-primary"
          >
            {title}
          </h2>
          <p className="mt-1 text-xs text-text-caption">
            Review suggested matches and field values, then confirm the merge.
            Related deals, activities, emails, calls, tasks, and orders will be
            reassigned to the primary contact. Duplicate records will be
            archived.
          </p>
          <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-medium tracking-wide text-text-caption uppercase">
            {(
              [
                ["primary", "Primary"],
                ["fields", "Fields"],
                ["summary", "Summary"],
              ] as const
            ).map(([key, label]) => (
              <span
                key={key}
                className={
                  step === key || (step === "done" && key === "summary")
                    ? "text-text-primary"
                    : undefined
                }
              >
                {label}
              </span>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {error ? (
            <p className="mb-3 rounded-lg border border-text-danger/30 bg-text-danger/5 px-3 py-2 text-sm text-text-danger">
              {error}
            </p>
          ) : null}

          {!preview && !error ? (
            <p className="text-sm text-text-caption">Loading merge preview…</p>
          ) : null}

          {preview && step === "primary" ? (
            <div className="space-y-3">
              <p className="text-sm text-text-secondary">
                Choose the primary (master) record. Suggested:{" "}
                <span className="font-medium text-text-primary">
                  {
                    preview.contacts.find(
                      (c) => c.id === preview.recommendedPrimaryId,
                    )?.displayName
                  }
                </span>
              </p>
              <ul className="space-y-2">
                {preview.contacts.map((c) => (
                  <li key={c.id}>
                    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border-default px-3 py-3 hover:bg-subtle/50">
                      <input
                        type="radio"
                        className="mt-1"
                        name="primary"
                        checked={primaryId === c.id}
                        onChange={() => setPrimaryId(c.id)}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-text-primary">
                            {c.displayName}
                          </span>
                          {c.id === preview.recommendedPrimaryId ? (
                            <span className="rounded-md bg-brand/10 px-1.5 py-0.5 text-[10px] font-medium text-brand">
                              Suggested
                            </span>
                          ) : null}
                        </span>
                        <span className="mt-0.5 block text-xs text-text-caption">
                          {c.values.email || "—"}
                          {c.companyName ? ` · ${c.companyName}` : ""}
                        </span>
                        <span className="mt-1 block text-[11px] text-text-caption">
                          {c.related?.deals ?? 0} deals ·{" "}
                          {c.related?.activities ?? 0} activities ·{" "}
                          {c.related?.orders ?? 0} orders ·{" "}
                          {c.related?.emails ?? 0} emails ·{" "}
                          {c.related?.calls ?? 0} calls
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {preview && step === "fields" ? (
            <div className="space-y-4">
              <p className="text-sm text-text-secondary">
                For each conflicting field, pick which contact’s value to
                keep. Non-conflicting fields use the suggested value
                automatically.
              </p>
              {conflictingFields.length === 0 ? (
                <p className="text-sm text-text-caption">
                  No conflicting field values — you can continue.
                </p>
              ) : (
                <ul className="space-y-4">
                  {conflictingFields.map((field) => (
                    <li
                      key={field.key}
                      className="rounded-xl border border-border-default p-3"
                    >
                      <p className="text-sm font-medium text-text-primary">
                        {field.label}
                      </p>
                      <div className="mt-2 space-y-2">
                        {preview.contacts.map((c) => {
                          const value = c.values[field.key];
                          if (value == null || String(value).trim() === "") {
                            return null;
                          }
                          const suggested =
                            preview.suggestedFieldSources[field.key] === c.id;
                          return (
                            <label
                              key={`${field.key}-${c.id}`}
                              className="flex cursor-pointer items-start gap-2 text-sm"
                            >
                              <input
                                type="radio"
                                className="mt-1"
                                name={`field-${field.key}`}
                                checked={
                                  (fieldSources[field.key] || primaryId) ===
                                  c.id
                                }
                                onChange={() =>
                                  setFieldSources((prev) => ({
                                    ...prev,
                                    [field.key]: c.id,
                                  }))
                                }
                              />
                              <span>
                                <span className="font-medium text-text-primary">
                                  {c.displayName}
                                </span>
                                {suggested ? (
                                  <span className="ml-2 text-[10px] font-medium text-brand">
                                    Suggested
                                  </span>
                                ) : null}
                                <span className="mt-0.5 block whitespace-pre-wrap text-text-secondary">
                                  {String(value)}
                                </span>
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}

          {preview && step === "summary" ? (
            <div className="space-y-3 text-sm">
              <p className="text-text-secondary">
                Confirm merge into{" "}
                <span className="font-medium text-text-primary">
                  {preview.contacts.find((c) => c.id === primaryId)?.displayName}
                </span>
                . The following duplicates will be archived:
              </p>
              <ul className="list-disc space-y-1 pl-5 text-text-primary">
                {duplicates.map((d) => (
                  <li key={d.id}>
                    {d.displayName} ({d.values.email})
                  </li>
                ))}
              </ul>
              <div className="rounded-xl border border-border-default bg-subtle/40 px-3 py-2 text-xs text-text-caption">
                Related data to re-associate:{" "}
                {preview.totalRelated?.deals ?? 0} deals,{" "}
                {preview.totalRelated?.activities ?? 0} activities,{" "}
                {preview.totalRelated?.orders ?? 0} orders. Secondary
                emails/phones will be unioned onto the primary. An audit log
                entry will be written.
              </div>
            </div>
          ) : null}

          {step === "done" && mergedId ? (
            <div className="space-y-3 text-sm">
              <p className="text-text-success font-medium">
                Contacts merged successfully.
              </p>
              <p className="text-text-secondary">
                Duplicates were archived. Open the primary contact to
                continue.
              </p>
              <Link
                to={`/contact/${mergedId}`}
                className="font-medium text-text-link hover:underline"
              >
                View primary contact →
              </Link>
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-border-default px-5 py-4">
          {step !== "done" ? (
            <Button
              type="button"
              variant="secondary"
              onClick={onClose}
              disabled={pending}
            >
              Cancel
            </Button>
          ) : (
            <Button type="button" variant="secondary" onClick={onClose}>
              Close
            </Button>
          )}
          {step === "primary" ? (
            <Button
              type="button"
              variant="primary"
              disabled={pending || !primaryId}
              onClick={() => setStep("fields")}
            >
              Continue
            </Button>
          ) : null}
          {step === "fields" ? (
            <>
              <Button
                type="button"
                variant="secondary"
                disabled={pending}
                onClick={() => setStep("primary")}
              >
                Back
              </Button>
              <Button
                type="button"
                variant="primary"
                disabled={pending}
                onClick={() => setStep("summary")}
              >
                Review summary
              </Button>
            </>
          ) : null}
          {step === "summary" ? (
            <>
              <Button
                type="button"
                variant="secondary"
                disabled={pending}
                onClick={() => setStep("fields")}
              >
                Back
              </Button>
              <Button
                type="button"
                variant="primary"
                disabled={pending}
                onClick={runMerge}
              >
                {pending ? "Merging…" : "Confirm merge"}
              </Button>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
