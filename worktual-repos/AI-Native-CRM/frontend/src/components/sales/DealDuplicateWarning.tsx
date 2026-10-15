import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  checkDuplicateDeals,
  type OpenDuplicateDeal,
} from "@/services/sales";

/** Debounced open-deal duplicate check for create flows (matches Next DealForm). */
export function useDealDuplicateCheck(input: {
  enabled: boolean;
  companyId: string;
  contactId: string;
}) {
  const [checking, setChecking] = useState(false);
  const [duplicates, setDuplicates] = useState<OpenDuplicateDeal[]>([]);
  const [acknowledged, setAcknowledged] = useState(false);

  useEffect(() => {
    if (!input.enabled || (!input.companyId && !input.contactId)) {
      setDuplicates([]);
      setAcknowledged(false);
      setChecking(false);
      return;
    }

    let cancelled = false;
    setChecking(true);
    setAcknowledged(false);
    void checkDuplicateDeals({
      companyId: input.companyId || null,
      contactId: input.contactId || null,
    }).then((result) => {
      if (cancelled) return;
      setChecking(false);
      if (!result.ok) {
        setDuplicates([]);
        return;
      }
      setDuplicates(result.matches);
    });

    return () => {
      cancelled = true;
    };
  }, [input.enabled, input.companyId, input.contactId]);

  const blocked = input.enabled && duplicates.length > 0 && !acknowledged;

  return {
    checking,
    duplicates,
    acknowledged,
    setAcknowledged,
    blocked,
  };
}

export function DealDuplicateWarning({
  checking,
  duplicates,
  acknowledged,
  onAcknowledge,
  onNavigateAway,
}: {
  checking: boolean;
  duplicates: OpenDuplicateDeal[];
  acknowledged: boolean;
  onAcknowledge: () => void;
  onNavigateAway?: () => void;
}) {
  if (!checking && duplicates.length === 0) return null;

  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 p-4">
      {checking ? (
        <p className="text-sm text-amber-950">Checking for open deals…</p>
      ) : (
        <div className="space-y-3">
          <div>
            <p className="text-sm font-semibold text-amber-950">
              Possible duplicate
            </p>
            <p className="mt-1 text-sm text-amber-900/90">
              Open deal{duplicates.length === 1 ? "" : "s"} already{" "}
              {duplicates.length === 1 ? "exists" : "exist"} for this{" "}
              {duplicates[0]?.matchOn === "contact"
                ? "contact"
                : duplicates[0]?.matchOn === "both"
                  ? "company and contact"
                  : "company"}
              . Creating another may mean two reps working the same account.
            </p>
          </div>
          <ul className="space-y-2">
            {duplicates.slice(0, 3).map((d) => (
              <li
                key={d.id}
                className="rounded-lg border border-amber-200 bg-white/70 px-3 py-2 text-sm"
              >
                <Link
                  to={`/sales/${d.id}`}
                  className="font-medium text-text-link hover:underline"
                  onClick={() => onNavigateAway?.()}
                >
                  {d.title}
                </Link>
                <p className="text-xs text-amber-900/80">
                  {d.companyName} · {d.stageLabel}
                  {d.ownerName ? ` · ${d.ownerName}` : null}
                  {d.amount ? ` · $${d.amount}` : null}
                </p>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Link
              to={`/sales/${duplicates[0]!.id}`}
              className="inline-flex h-8 items-center rounded-md border border-amber-300 bg-white px-3 text-xs font-medium text-amber-950"
              onClick={() => onNavigateAway?.()}
            >
              View existing
            </Link>
            <button
              type="button"
              className="inline-flex h-8 items-center rounded-md bg-amber-800 px-3 text-xs font-medium text-white"
              onClick={onAcknowledge}
            >
              {acknowledged ? "Acknowledged — continue" : "Continue anyway"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
