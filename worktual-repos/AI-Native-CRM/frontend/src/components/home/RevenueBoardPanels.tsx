import { ReportChartCard } from "@/components/home/ReportDashboardLayout";
import {
  formatLakhMoney,
  formatQuarterChange,
} from "@/lib/format-lakh-money";
import type { AdminOpsData } from "@/services/home";

type Board = AdminOpsData["revenueBoard"];

function money(amount: number, currency: string): string {
  return formatLakhMoney(amount, currency);
}

function companyQuarterLine(board: Board, currency: string): string {
  const change = formatQuarterChange(
    board.companyChangePct,
    board.companyPrevious,
    board.companyCurrent,
  );
  const prior =
    board.companyPrevious > 0
      ? `${money(board.companyPrevious, currency)} in ${board.previousQuarterLabel}`
      : null;
  return [change, prior].filter(Boolean).join(" · ") || "No prior quarter";
}

function repQuarterLine(
  changePct: number | null,
  previous: number,
  current: number,
  currency: string,
): string {
  const change = formatQuarterChange(changePct, previous, current);
  if (change) return change;
  if (previous > 0) return money(previous, currency);
  return "No prior quarter";
}

function MoneyBars({
  rows,
  currency,
}: {
  rows: Array<{ id: string; label: string; amount: number }>;
  currency: string;
}) {
  const max = Math.max(1, ...rows.map((row) => row.amount));
  if (rows.length === 0) {
    return <p className="text-sm text-text-caption">No paid invoices this quarter.</p>;
  }
  return (
    <ul className="space-y-3">
      {rows.map((row) => {
        const pct = Math.max(4, Math.round((row.amount / max) * 100));
        return (
          <li key={row.id} className="space-y-1">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="truncate text-text-secondary">{row.label}</span>
              <span className="shrink-0 tabular-nums font-medium text-text-primary">
                {money(row.amount, currency)}
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-neutral-100">
              <div
                className="h-1.5 rounded-full bg-neutral-900"
                style={{ width: `${pct}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function CompanyRevenueSection({ board }: { board: Board }) {
  const currency = board.currency;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <ReportChartCard
          title="Company top line"
          subtitle={`Paid invoices · ${board.quarterLabel}`}
          headline={money(board.companyCurrent, currency)}
        >
          <p className="text-sm text-text-secondary">
            {companyQuarterLine(board, currency)}
          </p>
        </ReportChartCard>
        <ReportChartCard
          title="Employee vs company"
          subtitle={board.quarterLabel}
        >
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border-default text-xs text-text-caption">
                <th className="pb-2 font-medium">Level</th>
                <th className="pb-2 text-right font-medium">Top line</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-border-default">
                <td className="py-2.5">Employee total</td>
                <td className="py-2.5 text-right tabular-nums font-medium">
                  {money(board.employeeCurrent, currency)}
                </td>
              </tr>
              <tr>
                <td className="py-2.5">Company total</td>
                <td className="py-2.5 text-right tabular-nums font-medium">
                  {money(board.companyCurrent, currency)}
                </td>
              </tr>
            </tbody>
          </table>
        </ReportChartCard>
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <ReportChartCard
          title="Revenue by customer"
          subtitle={board.quarterLabel}
        >
          <MoneyBars rows={board.byCustomer} currency={currency} />
        </ReportChartCard>
        <ReportChartCard
          title="Revenue by product"
          subtitle={board.quarterLabel}
        >
          <MoneyBars rows={board.byProduct} currency={currency} />
        </ReportChartCard>
      </div>
    </div>
  );
}

export function RepRevenueSection({ board }: { board: Board }) {
  const currency = board.currency;
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <ReportChartCard
        title="Collected revenue by rep"
        subtitle={`Paid invoices · ${board.quarterLabel}`}
      >
        <MoneyBars
          rows={board.reps.map((row) => ({
            id: row.userId,
            label: row.name,
            amount: row.current,
          }))}
          currency={currency}
        />
      </ReportChartCard>
      <ReportChartCard
        title="Employee collected top line"
        subtitle={`${board.quarterLabel} vs ${board.previousQuarterLabel}`}
      >
        {board.reps.length === 0 ? (
          <p className="text-sm text-text-caption">No paid invoices this quarter.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border-default text-xs text-text-caption">
                <th className="pb-2 font-medium">Rep</th>
                <th className="pb-2 text-right font-medium">Top line</th>
                <th className="pb-2 pl-3 text-right font-medium">Vs last quarter</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-default">
              {board.reps.map((row) => (
                <tr key={row.userId}>
                  <td className="py-2.5 font-medium">{row.name}</td>
                  <td className="py-2.5 text-right tabular-nums">
                    {money(row.current, currency)}
                  </td>
                  <td className="py-2.5 pl-3 text-right text-xs text-text-secondary">
                    {repQuarterLine(row.changePct, row.previous, row.current, currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </ReportChartCard>
    </div>
  );
}
