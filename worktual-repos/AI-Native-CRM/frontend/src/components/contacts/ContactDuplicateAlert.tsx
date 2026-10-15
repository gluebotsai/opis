import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/Button";
import { MergeContactsWizard } from "@/components/contacts/MergeContactsWizard";
import type { DuplicateCandidateView } from "@/services/contacts";

export function ContactDuplicateAlert({
  contactId,
  duplicates,
  onMerged,
}: {
  contactId: string;
  duplicates: DuplicateCandidateView[];
  onMerged?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  if (!duplicates.length) return null;

  const top = duplicates[0]!;

  return (
    <>
      <div className="mb-4 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-text-primary">
              Possible duplicate contacts detected
            </p>
            <p className="mt-1 text-xs text-text-secondary">
              Top match: {top.displayName} ({top.email}) — {top.confidence}%
              confidence. {top.reasons[0]?.label}
              {duplicates.length > 1 ? ` · ${duplicates.length - 1} more` : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen((v) => !v)}>
              {open ? "Hide duplicates" : "View duplicates"}
            </Button>
            <Button type="button" variant="primary" onClick={() => setMergeOpen(true)}>
              Merge…
            </Button>
          </div>
        </div>
        {open ? (
          <ul className="mt-3 space-y-2 border-t border-amber-500/20 pt-3">
            {duplicates.map((d) => (
              <li
                key={d.id}
                className="flex flex-wrap items-center justify-between gap-2 text-sm"
              >
                <div>
                  <Link
                    to={`/contact/${d.id}`}
                    className="font-medium text-text-link hover:underline"
                  >
                    {d.displayName}
                  </Link>
                  <p className="text-xs text-text-caption">
                    {d.email}
                    {d.companyName ? ` · ${d.companyName}` : ""} · {d.confidence}
                    % · {d.reasons.map((r) => r.label).join("; ")}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {mergeOpen ? (
        <MergeContactsWizard
          contactIds={[contactId, ...duplicates.map((d) => d.id)]}
          onClose={() => setMergeOpen(false)}
          onMerged={onMerged}
        />
      ) : null}
    </>
  );
}
