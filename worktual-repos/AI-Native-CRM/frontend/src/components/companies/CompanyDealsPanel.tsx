import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Skeleton } from "@/components/skeleton/Skeleton";
import { SkeletonText } from "@/components/skeleton/SkeletonText";
import {
  DEAL_STAGE_LABELS,
  formatMoneyFull,
  stageBadgeClass,
} from "@/lib/deal-stages";
import { fetchCompanyDeals, type PipelineDeal } from "@/services/sales";
import { CHIP_BASE } from "@/lib/ui-tones";

/**
 * One currency label for a set of deal amounts. Mixed currencies are never
 * added together — same rule the pipeline totals use.
 */
function dealTotal(deals: PipelineDeal[]): string | null {
  const priced = deals.filter((deal) => Number(deal.amount));
  if (priced.length === 0) return null;
  const codes = new Set(priced.map((deal) => deal.amountCurrency || ""));
  if (codes.size !== 1) return "Mixed currencies";
  const sum = priced.reduce((acc, deal) => acc + (Number(deal.amount) || 0), 0);
  return formatMoneyFull(String(sum), [...codes][0] || null);
}

/** Every deal raised against this company, across all of its locations. */
export function CompanyDealsPanel({ companyId }: { companyId: string }) {
  const [items, setItems] = useState<PipelineDeal[]>([]);
  const [total, setTotal] = useState(0);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const result = await fetchCompanyDeals(companyId);
      if (!result.ok) {
        setError(result.error);
        setItems([]);
        return;
      }
      setItems(result.items);
      setTotal(result.pagination.total);
    } catch {
      setError("Failed to load deals.");
      setItems([]);
    } finally {
      setReady(true);
    }
  }, [companyId]);

  useEffect(() => {
    setReady(false);
    void load();
  }, [load]);

  const open = items.filter(
    (deal) => deal.stage !== "closed_won" && deal.stage !== "closed_lost",
  ).length;
  const wonDeals = items.filter((deal) => deal.stage === "closed_won");
  const wonTotal = dealTotal(wonDeals);

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-text-primary">Deals</h2>
        {ready && items.length > 0 ? (
          <p className="text-xs text-text-caption">
            {open} open of {total}
          </p>
        ) : null}
      </div>

      {ready && !error && items.length > 0 ? (
        <dl className="mb-3 grid gap-2 sm:grid-cols-2">
          <div className="rounded-lg border border-border-default bg-surface px-4 py-3">
            <dt className="text-xs font-medium uppercase tracking-wide text-text-caption">
              Won
            </dt>
            <dd className="mt-1 text-base font-semibold text-text-success">
              {wonTotal ?? "—"}
            </dd>
            <dd className="text-xs text-text-caption">
              {wonDeals.length} {wonDeals.length === 1 ? "deal" : "deals"} won
            </dd>
          </div>
          <div className="rounded-lg border border-border-default bg-surface px-4 py-3">
            <dt className="text-xs font-medium uppercase tracking-wide text-text-caption">
              Open pipeline
            </dt>
            <dd className="mt-1 text-base font-semibold text-text-primary">
              {dealTotal(
                items.filter(
                  (deal) =>
                    deal.stage !== "closed_won" && deal.stage !== "closed_lost",
                ),
              ) ?? "—"}
            </dd>
            <dd className="text-xs text-text-caption">
              {open} {open === 1 ? "deal" : "deals"} open
            </dd>
          </div>
        </dl>
      ) : null}

      {!ready ? (
        <ul className="space-y-2">
          {Array.from({ length: 3 }).map((_, index) => (
            <li
              key={index}
              className="rounded-lg border border-border-default px-3 py-2.5"
            >
              <div className="flex items-center justify-between gap-3">
                <SkeletonText width="42%" height={14} />
                <Skeleton height={20} width={88} borderRadius={6} />
              </div>
              <div className="mt-2">
                <SkeletonText width="28%" height={12} />
              </div>
            </li>
          ))}
        </ul>
      ) : error ? (
        <p className="text-sm text-text-danger" role="alert">
          {error}
        </p>
      ) : items.length === 0 ? (
        <p className="text-sm text-text-caption">No deals for this company yet.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((deal) => (
            <li key={deal.id}>
              <Link
                to={`/sales/${deal.id}`}
                className="block rounded-lg border border-border-default px-3 py-2.5 transition-colors hover:border-brand/40 hover:bg-state-hover"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="min-w-0 truncate text-sm font-medium text-text-primary">
                    {deal.title}
                  </p>
                  <span className={`${CHIP_BASE} shrink-0 ${stageBadgeClass(deal.stage)}`}>
                    {DEAL_STAGE_LABELS[deal.stage] ?? deal.stage}
                  </span>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-caption">
                  <span className="font-medium text-text-secondary">
                    {formatMoneyFull(deal.amount, deal.amountCurrency)}
                  </span>
                  {deal.locationName ? <span>{deal.locationName}</span> : null}
                  {deal.contactName ? <span>{deal.contactName}</span> : null}
                  {deal.ownerName ? <span>Owner {deal.ownerName}</span> : null}
                  {deal.expectedCloseDate ? (
                    <span>
                      Closes{" "}
                      {new Date(deal.expectedCloseDate).toLocaleDateString()}
                    </span>
                  ) : null}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
