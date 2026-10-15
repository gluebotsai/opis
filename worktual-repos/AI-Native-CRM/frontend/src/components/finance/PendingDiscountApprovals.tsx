import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/Button";
import {
  approveQuoteDiscount,
  fetchPendingDiscountApprovals,
  rejectQuoteDiscount,
  type PendingDiscountApproval,
} from "@/services/quotes";

function formatMoney(amount: string, currency: string): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) return `${currency} ${amount}`;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `${currency} ${n.toFixed(2)}`;
  }
}

/** Finance's discount-approval queue — quotes over a product's discount cap. */
export function PendingDiscountApprovals() {
  const [items, setItems] = useState<PendingDiscountApproval[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchPendingDiscountApprovals();
      if (data.ok) {
        setItems(data.items);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const onApprove = async (id: string) => {
    setBusyId(id);
    setError(null);
    const result = await approveQuoteDiscount(id);
    setBusyId(null);
    if (!result.ok) {
      setError(result.error ?? "Failed to approve discount.");
      return;
    }
    setRejectingId(null);
    setRejectReason("");
    await reload();
  };

  const onReject = async (id: string) => {
    const reason = rejectReason.trim();
    if (!reason) {
      setError("Enter a rejection reason.");
      return;
    }
    setBusyId(id);
    setError(null);
    const result = await rejectQuoteDiscount(id, reason);
    setBusyId(null);
    if (!result.ok) {
      setError(result.error ?? "Failed to reject discount.");
      return;
    }
    setRejectingId(null);
    setRejectReason("");
    await reload();
  };

  if (loading && items.length === 0) return null;
  if (items.length === 0) return null;

  return (
    <div className="mb-6 rounded-xl border border-amber-300 bg-amber-50 p-4">
      <p className="text-sm font-semibold text-amber-900">
        Discount approvals needed ({items.length})
      </p>
      <p className="mt-0.5 text-xs text-amber-800">
        These quotes discount a product beyond its configured limit and
        can&rsquo;t be sent to the customer until you approve or reject them.
      </p>
      {error ? (
        <p className="mt-2 text-sm text-text-danger" role="alert">
          {error}
        </p>
      ) : null}
      <div className="mt-3 space-y-2">
        {items.map((item) => (
          <div
            key={item.id}
            className="rounded-lg border border-amber-200 bg-surface px-3 py-2"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-medium text-text-primary">
                    {item.number}
                  </span>
                  <Link
                    to={`/sales/quotes/${item.id}`}
                    title="Open quote"
                    className="shrink-0 text-text-caption hover:text-brand"
                  >
                    <ExternalLink className="size-3.5" />
                  </Link>
                </div>
                <p className="truncate text-xs text-text-caption">
                  {item.dealTitle}
                  {item.contactName ? ` · ${item.contactName}` : ""}
                  {item.companyName ? ` · ${item.companyName}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-3 text-xs text-text-caption">
                <span>
                  {item.discountPct}% discount
                  {item.limitPct != null ? ` (limit ${item.limitPct}%)` : ""}
                </span>
                <span className="font-medium text-text-primary">
                  {formatMoney(item.total, item.currency)}
                </span>
                <Button
                  type="button"
                  variant="primary"
                  className="h-8 px-3 text-xs"
                  disabled={busyId === item.id}
                  onClick={() => void onApprove(item.id)}
                >
                  {busyId === item.id && rejectingId !== item.id
                    ? "Approving…"
                    : "Approve"}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  className="h-8 px-3 text-xs"
                  disabled={busyId === item.id}
                  onClick={() => {
                    setError(null);
                    setRejectingId((cur) => (cur === item.id ? null : item.id));
                    setRejectReason("");
                  }}
                >
                  Reject
                </Button>
              </div>
            </div>
            {rejectingId === item.id ? (
              <div className="mt-2 space-y-2 border-t border-amber-100 pt-2">
                <label className="block text-xs font-medium text-text-secondary">
                  Rejection reason
                  <textarea
                    className="mt-1 w-full rounded-md border border-border-default bg-surface px-2 py-1.5 text-sm text-text-primary"
                    rows={2}
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    placeholder="Explain what the salesperson should change…"
                  />
                </label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="primary"
                    className="h-8 px-3 text-xs"
                    disabled={busyId === item.id}
                    onClick={() => void onReject(item.id)}
                  >
                    {busyId === item.id ? "Rejecting…" : "Confirm reject"}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    className="h-8 px-3 text-xs"
                    disabled={busyId === item.id}
                    onClick={() => {
                      setRejectingId(null);
                      setRejectReason("");
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
