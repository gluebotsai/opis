import React, { useEffect, useState } from 'react';
import { AlertTriangle, Star } from 'lucide-react';
import { useSetPageTitle } from './layout/PageTitleContext';
import PageShell from './layout/PageShell';

type CsatReport = {
  range: string;
  ratings: number;
  avgScore: number | null;
  ratedResolved: number;
  lowScores: number;
  reopenRate: string;
  byAssignee: Array<{ name: string; ratings: number; avgScore: number | null }>;
  byTeam: Array<{ name: string; ratings: number; avgScore: number | null }>;
  trend: Array<{ day: string; avgScore: number | null; ratings: number }>;
};

interface CsatReportsViewProps {
  embedded?: boolean;
  listRefreshToken?: number;
  /** Chat date preset — same picker the UI uses (7days | 30days | 90days). */
  externalRange?: string;
}

function formatAvg(score: number | null | undefined): string {
  if (score == null || !Number.isFinite(score)) return '—';
  return `${score.toFixed(1)}/5`;
}

export default function CsatReportsView({
  embedded = false,
  listRefreshToken = 0,
  externalRange,
}: CsatReportsViewProps) {
  useSetPageTitle('CSAT reports');
  const [range, setRange] = useState('30days');
  const [data, setData] = useState<CsatReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async (r = range) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/csat-reports?range=${encodeURIComponent(r)}`, {
        credentials: 'include',
      });
      if (res.status === 403) {
        setError('You do not have access to CSAT reports.');
        setData(null);
        return;
      }
      if (!res.ok) throw new Error('Failed');
      setData((await res.json()) as CsatReport);
    } catch {
      setError('Could not load CSAT report.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const r = String(externalRange || '').trim();
    if (r === '7days' || r === '30days' || r === '90days') {
      setRange(r);
    }
  }, [externalRange]);

  useEffect(() => {
    void load(range);
  }, [range]);

  useEffect(() => {
    if (!listRefreshToken) return;
    void load(range);
  }, [listRefreshToken]);

  const body = (
    <div className="flex h-full min-h-0 min-w-0 w-full flex-col gap-4 overflow-x-hidden">
      <div className="flex shrink-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-neutral-900 text-white">
              <Star className="h-3.5 w-3.5" strokeWidth={2.25} />
            </span>
            <h2 className="text-base font-semibold text-neutral-900">CSAT reports</h2>
          </div>
          <p className="mt-1 text-[13px] leading-relaxed text-neutral-500">
            Customer satisfaction from resolved-ticket ratings, by team and assignee.
          </p>
        </div>
        <select
          value={range}
          onChange={(e) => setRange(e.target.value)}
          aria-label="Date range"
          className="h-9 shrink-0 rounded-xl border border-neutral-200 bg-white px-2.5 text-xs font-medium text-neutral-800 outline-none focus:border-neutral-900"
        >
          <option value="7days">Last 7 days</option>
          <option value="30days">Last 30 days</option>
          <option value="90days">Last 90 days</option>
        </select>
      </div>

      {error && (
        <div className="flex shrink-0 items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading || !data ? (
        <div className="py-12 text-center text-sm text-neutral-400">
          {loading ? 'Loading…' : 'No data'}
        </div>
      ) : (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
          <div className="grid grid-cols-2 gap-2.5">
            {[
              { label: 'Ratings', value: String(data.ratings) },
              { label: 'Avg CSAT', value: formatAvg(data.avgScore) },
              { label: 'Rated resolved', value: String(data.ratedResolved) },
              {
                label: 'Low scores',
                value:
                  data.ratings > 0
                    ? `${data.lowScores} · ${Math.round(
                        (data.lowScores / Math.max(data.ratings, 1)) * 100
                      )}%`
                    : '—',
              },
            ].map((k) => (
              <div
                key={k.label}
                className="rounded-xl border border-neutral-200 bg-neutral-50/80 px-3 py-2.5"
              >
                <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
                  {k.label}
                </p>
                <p className="mt-1 truncate text-lg font-semibold tabular-nums text-neutral-900">
                  {k.value}
                </p>
              </div>
            ))}
          </div>

          {data.ratings === 0 && (
            <div className="rounded-xl border border-dashed border-neutral-200 bg-white px-3.5 py-3 text-[13px] leading-relaxed text-neutral-500">
              No CSAT ratings in this range yet. Scores appear after a resolved ticket
              is rated (1–5). Once ratings exist, averages and breakdowns show here.
            </div>
          )}

          <div className="flex min-w-0 flex-col gap-3">
            <BreakdownCard
              title="By assignee"
              emptyLabel="No assignee ratings in range"
              rows={data.byAssignee}
              nameHeader="Name"
            />
            <BreakdownCard
              title="By team"
              emptyLabel="No team ratings in range"
              rows={data.byTeam}
              nameHeader="Team"
            />
          </div>

          {data.trend.length > 0 && (
            <div className="rounded-xl border border-neutral-200 bg-white p-3.5">
              <p className="mb-3 text-xs font-semibold text-neutral-800">Daily trend</p>
              <div className="flex h-24 items-end gap-1">
                {data.trend.map((d) => {
                  const h = d.avgScore != null ? (d.avgScore / 5) * 100 : 0;
                  return (
                    <div
                      key={d.day}
                      className="flex min-w-0 flex-1 flex-col items-center gap-1"
                      title={`${d.day}: ${formatAvg(d.avgScore)} (${d.ratings})`}
                    >
                      <div
                        className="w-full max-w-[14px] rounded-t bg-neutral-900/80"
                        style={{ height: `${Math.max(h, 4)}%` }}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );

  return (
    <PageShell embedded={embedded} fillHeight>
      {body}
    </PageShell>
  );
}

function BreakdownCard({
  title,
  nameHeader,
  emptyLabel,
  rows,
}: {
  title: string;
  nameHeader: string;
  emptyLabel: string;
  rows: Array<{ name: string; ratings: number; avgScore: number | null }>;
}) {
  return (
    <div className="min-w-0 overflow-hidden rounded-xl border border-neutral-200 bg-white">
      <div className="border-b border-neutral-100 px-3 py-2.5 text-xs font-semibold text-neutral-900">
        {title}
      </div>
      {rows.length === 0 ? (
        <p className="px-3 py-5 text-center text-[12px] text-neutral-400">{emptyLabel}</p>
      ) : (
        <table className="w-full table-fixed border-collapse text-[12px]">
          <colgroup>
            <col className="w-[50%]" />
            <col className="w-[25%]" />
            <col className="w-[25%]" />
          </colgroup>
          <thead>
            <tr className="border-b border-neutral-50 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
              <th className="px-3 py-2 text-left">{nameHeader}</th>
              <th className="px-2 py-2 text-right">Ratings</th>
              <th className="px-3 py-2 text-right">Avg</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name} className="border-t border-neutral-50">
                <td className="truncate px-3 py-2 font-medium text-neutral-800">{r.name}</td>
                <td className="px-2 py-2 text-right tabular-nums text-neutral-700">
                  {r.ratings}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-neutral-700">
                  {formatAvg(r.avgScore)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
