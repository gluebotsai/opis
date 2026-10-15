import { useCallback, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { COWORKER_WORKSPACE_SCROLL } from "@/components/coworker/coworker-layout";
import { Plus, X } from "lucide-react";
import {
  INVOICE_STATUS_LABELS,
  invoiceStatusPillClass,
} from "@/lib/invoice-labels";
import type { InvoiceBarItem } from "@/services/finance";

const DISMISSED_TABS_KEY = "finance-invoice-bar-dismissed";

function readDismissedIds(): Set<string> {
  try {
    const raw = sessionStorage.getItem(DISMISSED_TABS_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is string => typeof id === "string"));
  } catch {
    return new Set();
  }
}

function writeDismissedIds(ids: Set<string>) {
  try {
    sessionStorage.setItem(DISMISSED_TABS_KEY, JSON.stringify([...ids]));
  } catch {
    /* ignore quota / private mode */
  }
}

export function FinanceShell({
  invoices,
  children,
  showNew = true,
  onNewInvoice,
  createActive = false,
}: {
  invoices: InvoiceBarItem[];
  children: React.ReactNode;
  showNew?: boolean;
  onNewInvoice?: () => void;
  createActive?: boolean;
}) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const isNew = pathname === "/finance/new";
  const [dismissedIds, setDismissedIds] = useState(readDismissedIds);

  const visibleInvoices = useMemo(
    () => invoices.filter((inv) => !dismissedIds.has(inv.id)),
    [invoices, dismissedIds],
  );

  const dismissTab = useCallback(
    (id: string) => {
      setDismissedIds((prev) => {
        const next = new Set(prev);
        next.add(id);
        writeDismissedIds(next);
        return next;
      });
      if (pathname === `/finance/${id}`) {
        void navigate("/finance");
      }
    },
    [navigate, pathname],
  );

  return (
    <div
      className={`mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8 ${COWORKER_WORKSPACE_SCROLL}`}
    >
      <div className="mb-6 overflow-x-auto rounded-xl border border-border-default bg-surface">
        <div className="flex min-w-max items-center gap-1.5 px-3 py-2.5">
          <Link
            to="/finance"
            className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              pathname === "/finance"
                ? "bg-subtle text-text-primary"
                : "text-text-caption hover:bg-subtle hover:text-text-primary"
            }`}
          >
            All invoices
          </Link>
          <span className="mx-1 h-4 w-px bg-border-default" aria-hidden />
          {visibleInvoices.map((inv) => {
            const href = `/finance/${inv.id}`;
            const active = pathname === href;
            return (
              <div
                key={inv.id}
                className={`inline-flex shrink-0 items-center gap-1 rounded-lg py-1 pl-3 pr-1 text-xs font-medium transition-colors ${
                  active
                    ? "bg-brand/10 text-brand ring-1 ring-brand/30"
                    : "text-text-secondary hover:bg-subtle hover:text-text-primary"
                }`}
              >
                <Link
                  to={href}
                  className="inline-flex items-center gap-2 py-0.5"
                >
                  <span>{inv.number}</span>
                  <span className={invoiceStatusPillClass(inv.displayStatus)}>
                    {INVOICE_STATUS_LABELS[inv.displayStatus] ?? inv.displayStatus}
                  </span>
                </Link>
                <button
                  type="button"
                  aria-label={`Close ${inv.number} tab`}
                  title="Close tab"
                  className="inline-flex size-6 items-center justify-center rounded-md text-text-caption transition hover:bg-black/5 hover:text-text-primary"
                  onClick={() => dismissTab(inv.id)}
                >
                  <X className="size-3.5" strokeWidth={2} />
                </button>
              </div>
            );
          })}
          {showNew ? (
            onNewInvoice ? (
              <button
                type="button"
                onClick={onNewInvoice}
                className={`ml-1 inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  createActive || isNew
                    ? "bg-neutral-900 text-text-on-dark"
                    : "bg-subtle text-text-primary hover:bg-neutral-200"
                }`}
              >
                <Plus className="size-3.5" strokeWidth={2} />
                New invoice
              </button>
            ) : (
              <Link
                to="/finance/new"
                className={`ml-1 inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  isNew
                    ? "bg-neutral-900 text-text-on-dark"
                    : "bg-subtle text-text-primary hover:bg-neutral-200"
                }`}
              >
                <Plus className="size-3.5" strokeWidth={2} />
                New invoice
              </Link>
            )
          ) : null}
        </div>
      </div>

      {children}
    </div>
  );
}
