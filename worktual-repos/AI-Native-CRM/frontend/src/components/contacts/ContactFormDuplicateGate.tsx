import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  findContactDuplicates,
  type DuplicateCandidateView,
} from "@/services/contacts";
import { MergeContactsWizard } from "@/components/contacts/MergeContactsWizard";

/**
 * Shown from create/update forms when potential duplicates are found
 * before saving. Mirrors src/components/contacts/ContactFormDuplicateGate.tsx (Next).
 */
export function ContactFormDuplicateGate({
  excludeContactId,
  draft,
  onContinueSave,
  onCancel,
}: {
  excludeContactId?: string | null;
  draft: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    companyId: string;
    companyName: string;
    city: string;
  };
  onContinueSave: () => void;
  onCancel: () => void;
}) {
  const [duplicates, setDuplicates] = useState<DuplicateCandidateView[] | null>(
    null,
  );
  const [mergeOpen, setMergeOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void findContactDuplicates({
      excludeContactId,
      firstName: draft.firstName,
      lastName: draft.lastName,
      email: draft.email,
      phone: draft.phone || null,
      companyId: draft.companyId || null,
      companyName: draft.companyName || null,
      city: draft.city || null,
    }).then((result) => {
      if (cancelled) return;
      if (!result.ok || !result.duplicates.length) {
        onContinueSave();
        return;
      }
      setDuplicates(result.duplicates);
    });
    return () => {
      cancelled = true;
    };
    // Gate opens once per submit draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!duplicates) {
    // Check silently. Chat/workspace already show saving; only interrupt if
    // real duplicates need a decision.
    return null;
  }

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4"
        role="dialog"
        aria-modal="true"
      >
        <div className="w-full max-w-lg rounded-2xl border border-border-default bg-surface p-5 shadow-lg">
          <h3 className="text-base font-semibold text-text-primary">
            Possible duplicates found
          </h3>
          <p className="mt-2 text-sm text-text-secondary">
            We found {duplicates.length} similar contact
            {duplicates.length === 1 ? "" : "s"}. Review before saving, or merge
            now.
          </p>
          <ul className="mt-3 max-h-48 space-y-2 overflow-y-auto text-sm">
            {duplicates.slice(0, 5).map((d) => (
              <li
                key={d.id}
                className="rounded-lg border border-border-default px-3 py-2"
              >
                <p className="font-medium text-text-primary">
                  {d.displayName}{" "}
                  <span className="text-xs font-normal text-text-caption">
                    {d.confidence}%
                  </span>
                </p>
                <p className="text-xs text-text-caption">
                  {d.email} · {d.reasons.map((r) => r.label).join("; ")}
                </p>
              </li>
            ))}
          </ul>
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onCancel}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setMergeOpen(true)}
              disabled={!excludeContactId}
              title={
                excludeContactId
                  ? "Open merge wizard"
                  : "Save the contact first, then merge from the detail page"
              }
            >
              Merge…
            </Button>
            <Button type="button" variant="primary" onClick={onContinueSave}>
              Save anyway
            </Button>
          </div>
        </div>
      </div>
      {mergeOpen && excludeContactId ? (
        <MergeContactsWizard
          contactIds={[excludeContactId, ...duplicates.map((d) => d.id)]}
          onClose={() => setMergeOpen(false)}
        />
      ) : null}
    </>
  );
}
