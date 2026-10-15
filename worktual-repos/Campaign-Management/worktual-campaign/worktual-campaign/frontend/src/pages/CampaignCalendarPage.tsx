import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Link } from "react-router-dom";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  CalendarDays,
  Loader2,
} from "lucide-react";
import {
  CALENDAR_COUNTRIES,
  getCalendarCountry,
  hasCalendarCountry,
} from "@/lib/campaign-calendar-countries";
import {
  addMonths,
  buildMonthGrid,
  countsByDay,
  dayTotal,
  formatDisplayDate,
  monthLabel,
  todayYmd,
  toCalendarCampaignRows,
} from "@/lib/campaign-calendar";
import {
  fetchCampaigns,
  type CampaignListItem,
} from "@/services/campaigns.service";
import {
  DEFAULT_PACK_ID,
  getActivePackId,
  subscribeActivePack,
} from "@/lib/industry-packs";

const COUNTRY_STORAGE_KEY = "worktual.campaign.calendar.country";
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function loadSavedCountry(): string {
  try {
    const raw = localStorage.getItem(COUNTRY_STORAGE_KEY);
    if (raw && hasCalendarCountry(raw)) return raw;
  } catch {
    /* ignore */
  }
  return "IN";
}

export function CampaignCalendarPage() {
  const [countryId, setCountryId] = useState(loadSavedCountry);
  const country = getCalendarCountry(countryId);
  const today = useMemo(() => todayYmd(country.timeZone), [country.timeZone]);

  const [monthAnchor, setMonthAnchor] = useState(() => {
    const t = todayYmd(getCalendarCountry(loadSavedCountry()).timeZone);
    return `${t.slice(0, 7)}-01`;
  });
  const [selectedYmd, setSelectedYmd] = useState(today);
  const [view, setView] = useState<"month" | "week" | "day">("month");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<CampaignListItem[]>([]);

  useEffect(() => {
    try {
      localStorage.setItem(COUNTRY_STORAGE_KEY, countryId);
    } catch {
      /* ignore */
    }
  }, [countryId]);

  useEffect(() => {
    const t = todayYmd(country.timeZone);
    setSelectedYmd(t);
    setMonthAnchor(`${t.slice(0, 7)}-01`);
  }, [country.timeZone]);

  const packId = useSyncExternalStore(
    subscribeActivePack,
    getActivePackId,
    () => DEFAULT_PACK_ID,
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await fetchCampaigns("calendar", { lite: true }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load campaigns");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [packId]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(
    () => toCalendarCampaignRows(items, country),
    [items, country],
  );

  const dayCounts = useMemo(() => countsByDay(rows), [rows]);
  const cells = useMemo(
    () => buildMonthGrid(monthAnchor, country, today, dayCounts),
    [monthAnchor, country, today, dayCounts],
  );

  const selectedRows = useMemo(
    () =>
      rows
        .filter((r) => r.ymd === selectedYmd)
        .sort((a, b) => a.timeLabel.localeCompare(b.timeLabel)),
    [rows, selectedYmd],
  );

  const selectedCounts = dayCounts.get(selectedYmd) || {
    running: 0,
    scheduled: 0,
    completed: 0,
  };
  const booked = dayTotal(selectedCounts) > 0;
  const selectedHoliday =
    country.holidays.find((h) => h.date === selectedYmd)?.name ?? null;

  const weekCells = useMemo(() => {
    const idx = cells.findIndex((c) => c.ymd === selectedYmd);
    if (idx < 0) return cells.slice(0, 7);
    const start = Math.floor(idx / 7) * 7;
    return cells.slice(start, start + 7);
  }, [cells, selectedYmd]);

  const visibleCells =
    view === "month" ? cells : view === "week" ? weekCells : cells.filter((c) => c.ymd === selectedYmd);

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-6xl flex-col gap-5 overflow-auto p-4 md:p-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-brand">
            <CalendarDays className="size-5" strokeWidth={1.75} />
            <h1 className="text-xl font-semibold tracking-tight text-text-primary">
              Calendar
            </h1>
          </div>
          <p className="mt-1 max-w-xl text-sm text-text-secondary">
            Running, scheduled, and ran campaigns by local date for{" "}
            <span className="font-medium text-text-primary">{country.name}</span>
            {" · "}
            {country.timeZone.replace(/_/g, " ")}
            {" · weekends "}
            {country.weekendDays
              .map((d) => WEEKDAYS[d])
              .join("–")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="cal-country">
            Country
          </label>
          <select
            id="cal-country"
            value={countryId}
            onChange={(e) => setCountryId(e.target.value)}
            className="max-w-[16rem] rounded-lg border border-border-default bg-surface px-3 py-2 text-sm text-text-primary"
          >
            {CALENDAR_COUNTRIES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.flagEmoji} {c.name}
              </option>
            ))}
          </select>
          <Link
            to="/campaigns/create"
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white hover:opacity-95"
          >
            <Plus className="size-4" strokeWidth={2} />
            Create Campaign
          </Link>
        </div>
      </header>

      <div className="rounded-xl border border-border-default bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-default px-4 py-3">
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label="Previous month"
              onClick={() => setMonthAnchor((m) => addMonths(m, -1))}
              className="rounded-md p-1.5 text-text-secondary hover:bg-subtle"
            >
              <ChevronLeft className="size-5" />
            </button>
            <h2 className="min-w-[10rem] text-center text-base font-semibold text-text-primary">
              {monthLabel(monthAnchor)}
            </h2>
            <button
              type="button"
              aria-label="Next month"
              onClick={() => setMonthAnchor((m) => addMonths(m, 1))}
              className="rounded-md p-1.5 text-text-secondary hover:bg-subtle"
            >
              <ChevronRight className="size-5" />
            </button>
            <button
              type="button"
              onClick={() => {
                setSelectedYmd(today);
                setMonthAnchor(`${today.slice(0, 7)}-01`);
              }}
              className="ml-2 rounded-md border border-border-default px-2.5 py-1 text-xs font-medium text-text-secondary hover:bg-subtle"
            >
              Today
            </button>
          </div>
          <div className="flex rounded-lg border border-border-default p-0.5 text-xs font-medium">
            {(["month", "week", "day"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                className={`rounded-md px-3 py-1.5 capitalize ${
                  view === v
                    ? "bg-brand text-white"
                    : "text-text-secondary hover:bg-subtle"
                }`}
              >
                {v}
              </button>
            ))}
          </div>
          {loading ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-text-caption">
              <Loader2 className="size-3.5 animate-spin" />
              Updating campaigns…
            </span>
          ) : null}
        </div>

        {error ? (
          <div className="px-4 py-10 text-center text-sm text-red-600">
            {error}
            <button
              type="button"
              onClick={() => void load()}
              className="mt-2 block w-full text-brand underline"
            >
              Retry
            </button>
          </div>
        ) : (
          <div className="p-3 md:p-4">
            {view !== "day" && (
              <div className="mb-1 grid grid-cols-7 gap-1 text-center text-[11px] font-semibold uppercase tracking-wide text-text-caption">
                {WEEKDAYS.map((d) => (
                  <div key={d} className="py-1">
                    {d}
                  </div>
                ))}
              </div>
            )}
            <div
              className={`grid gap-1 ${
                view === "day" ? "grid-cols-1" : "grid-cols-7"
              }`}
            >
              {visibleCells.map((cell) => {
                const selected = cell.ymd === selectedYmd;
                const hasBookings =
                  cell.running + cell.scheduled + cell.completed > 0;
                return (
                  <button
                    key={cell.ymd + (cell.inMonth ? "" : "-o")}
                    type="button"
                    onClick={() => {
                      setSelectedYmd(cell.ymd);
                      if (!cell.inMonth) {
                        setMonthAnchor(`${cell.ymd.slice(0, 7)}-01`);
                      }
                    }}
                    className={`flex min-h-[5.5rem] flex-col items-stretch rounded-lg border p-2 text-left transition ${
                      selected
                        ? "border-brand bg-brand/5 ring-1 ring-brand/30"
                        : "border-border-default hover:bg-subtle"
                    } ${!cell.inMonth && view === "month" ? "opacity-40" : ""} ${
                      cell.isWeekend ? "bg-subtle/60" : "bg-surface"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-1">
                      <span
                        className={`inline-flex size-7 items-center justify-center rounded-full text-sm font-semibold ${
                          cell.isToday
                            ? "bg-brand text-white"
                            : "text-text-primary"
                        }`}
                      >
                        {cell.day}
                      </span>
                      {cell.holiday ? (
                        <span
                          className="truncate text-[10px] font-medium text-amber-700"
                          title={cell.holiday}
                        >
                          {cell.holiday}
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-auto flex flex-col gap-0.5 pt-1">
                      {cell.running > 0 ? (
                        <span className="truncate rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800">
                          {cell.running} Running
                        </span>
                      ) : null}
                      {cell.scheduled > 0 ? (
                        <span className="truncate rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold text-sky-800">
                          {cell.scheduled} Scheduled
                        </span>
                      ) : null}
                      {cell.completed > 0 ? (
                        <span className="truncate rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-800">
                          {cell.completed} Ran
                        </span>
                      ) : null}
                      {!hasBookings && cell.inMonth ? (
                        <span className="text-[10px] text-text-caption">—</span>
                      ) : null}
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-text-caption">
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-emerald-500" /> Running
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-sky-500" /> Scheduled
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-violet-500" /> Ran
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-amber-500" /> Holiday
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-border-default" /> Weekend (
                {country.weekendDays.map((d) => WEEKDAYS[d]).join("/")}
                )
              </span>
            </div>
          </div>
        )}
      </div>

      <section className="rounded-xl border border-border-default bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-default px-4 py-3">
          <div>
            <h3 className="text-sm font-semibold text-text-primary">
              {formatDisplayDate(selectedYmd)}
            </h3>
            <p className="text-xs text-text-caption">
              {booked
                ? `${dayTotal(selectedCounts)} campaign${
                    dayTotal(selectedCounts) === 1 ? "" : "s"
                  } booked`
                : "No campaigns booked"}
              {selectedHoliday ? ` · Holiday: ${selectedHoliday}` : ""}
            </p>
          </div>
          <Link
            to="/campaigns/create"
            className="text-xs font-medium text-brand hover:underline"
          >
            + Create Campaign
          </Link>
        </div>
        {selectedRows.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-text-caption">
            Nothing scheduled, running, or ran on this date in {country.name}.
          </p>
        ) : (
          <ul className="divide-y divide-border-default">
            {selectedRows.map((row) => (
              <li key={row.id}>
                <Link
                  to={`/campaigns/${row.id}?from=calendar`}
                  state={{ navLabel: row.name, campaignName: row.name }}
                  className="flex flex-col gap-1 px-4 py-3 hover:bg-subtle sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                          row.status === "running"
                            ? "bg-emerald-100 text-emerald-800"
                            : row.status === "scheduled"
                              ? "bg-sky-100 text-sky-800"
                              : "bg-violet-100 text-violet-800"
                        }`}
                      >
                        {row.statusLabel}
                      </span>
                      <span className="truncate font-medium text-text-primary">
                        {row.name}
                      </span>
                    </div>
                    {row.description ? (
                      <p className="mt-0.5 truncate text-xs text-text-secondary">
                        {row.description}
                      </p>
                    ) : null}
                  </div>
                  <div className="shrink-0 text-xs text-text-caption sm:text-right">
                    <div>
                      {row.typeLabel}
                      {row.audienceCount > 0
                        ? ` · ${row.audienceCount.toLocaleString()} audience`
                        : ""}
                    </div>
                    <div>{row.timeLabel}</div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
