import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Plus,
  Video,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { DropdownSelect } from "@/components/ui/DropdownSelect";
import { ScheduleMeetingDialog } from "@/components/contacts/ContactQuickActions";
import { AgentModuleShell } from "@/components/coworker/AgentModuleShell";
import { useAppSelector } from "@/store";
import {
  fetchCalendarContacts,
  fetchCalendarEvents,
  type CalendarContact,
  type UnifiedCalendarEvent,
} from "@/services/calendar";
import { applySameDayRescheduleDisplay } from "@/lib/calendar-reschedule-display";
import { calendarEventMatchesId } from "@/lib/activity-href";
import { SkeletonText } from "@/components/skeleton/SkeletonText";
import {
  SalesCalendarAsideSkeleton,
  SalesCalendarGridSkeleton,
} from "./SalesCalendarPageSkeleton";

type CalView = "week" | "month";

const HOUR_START = 0;
const HOUR_END = 24;
const HOUR_HEIGHT = 56;
const HOURS = Array.from({ length: HOUR_END - HOUR_START }, (_, i) => HOUR_START + i);

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function startOfWeek(d: Date): Date {
  const x = startOfDay(d);
  const day = x.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  x.setDate(x.getDate() + diff);
  return x;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function dayKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Fetch range covers the full 6-week grid shown for a given month (also spans the week/agenda views). */
function monthFetchRange(anchor: Date): { timeMin: Date; timeMax: Date } {
  const first = startOfMonth(anchor);
  const start = startOfWeek(first);
  const last = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
  const endSunday = addDays(startOfWeek(last), 6);
  endSunday.setHours(23, 59, 59, 999);
  return { timeMin: start, timeMax: new Date(endSunday.getTime() + 1) };
}

function formatHourLabel(hour: number): string {
  if (hour === 0) return "12 AM";
  if (hour < 12) return `${hour} AM`;
  if (hour === 12) return "12 PM";
  return `${hour - 12} PM`;
}

function formatTime(iso: string, allDay: boolean): string {
  if (allDay) return "All day";
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatRange(ev: UnifiedCalendarEvent): string {
  if (ev.allDay) return "All day";
  const start = formatTime(ev.startAt, false);
  if (!ev.endAt) return start;
  return `${start} – ${formatTime(ev.endAt, false)}`;
}

function eventChipClassName(ev: UnifiedCalendarEvent): string {
  if (ev.superseded) {
    return "border-slate-200 bg-slate-50 text-slate-500";
  }
  if (ev.rescheduled) {
    return "border-amber-200 bg-amber-50 text-amber-950";
  }
  return "border-[#D4B8F8] bg-[#F3EBFF] text-[#5B21B6]";
}

function eventAccentClassName(ev: UnifiedCalendarEvent): string {
  if (ev.superseded) return "bg-slate-400";
  if (ev.rescheduled) return "bg-amber-500";
  return "bg-brand";
}

function formatWeekRange(weekStart: Date): string {
  const end = addDays(weekStart, 6);
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  const y = end.getFullYear();
  return `${weekStart.toLocaleDateString(undefined, opts)} – ${end.toLocaleDateString(undefined, opts)}, ${y}`;
}

function minutesFromDayStart(d: Date): number {
  return d.getHours() * 60 + d.getMinutes() - HOUR_START * 60;
}

function eventLayout(ev: UnifiedCalendarEvent): {
  top: number;
  height: number;
} | null {
  if (ev.allDay) return null;
  const start = new Date(ev.startAt);
  const end = ev.endAt ? new Date(ev.endAt) : new Date(start.getTime() + 30 * 60_000);
  const dayStartMin = HOUR_START * 60;
  const dayEndMin = HOUR_END * 60;
  const startMin = start.getHours() * 60 + start.getMinutes();
  let endMin = end.getHours() * 60 + end.getMinutes();
  if (endMin <= startMin) endMin = startMin + 30;
  if (endMin <= dayStartMin || startMin >= dayEndMin) return null;
  const clippedStart = Math.max(startMin, dayStartMin);
  const clippedEnd = Math.min(endMin, dayEndMin);
  const top = ((clippedStart - dayStartMin) / 60) * HOUR_HEIGHT;
  const height = Math.max(((clippedEnd - clippedStart) / 60) * HOUR_HEIGHT, 22);
  return { top, height };
}

export function SalesCalendarPage() {
  const [searchParams] = useSearchParams();
  const user = useAppSelector((s) => s.auth.user);
  const userName = user?.name?.trim() || "Me";

  const [view, setView] = useState<CalView>("week");
  const [ownerScope, setOwnerScope] = useState<"mine" | "all">("mine");
  const [canViewTeam, setCanViewTeam] = useState(false);
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [monthCursor, setMonthCursor] = useState(() => startOfMonth(new Date()));
  const [showWeekends, setShowWeekends] = useState(true);
  const [events, setEvents] = useState<UnifiedCalendarEvent[]>([]);
  const [contacts, setContacts] = useState<CalendarContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [selectedEvent, setSelectedEvent] = useState<UnifiedCalendarEvent | null>(null);

  const [pickContactOpen, setPickContactOpen] = useState(false);
  const [contactQuery, setContactQuery] = useState("");
  const [scheduleContact, setScheduleContact] = useState<CalendarContact | null>(null);

  const loadAround = useCallback(
    (anchor: Date, scope: "mine" | "all" = ownerScope) => {
      const range = monthFetchRange(anchor);
      setPending(true);
      void fetchCalendarEvents({
        timeMin: range.timeMin.toISOString(),
        timeMax: range.timeMax.toISOString(),
        ownerScope: scope,
      })
        .then((result) => {
          setEvents(result.events);
          setOwnerScope(result.ownerScope);
          setCanViewTeam(result.canViewTeam);
        })
        .catch(() => setError("Failed to load calendar."))
        .finally(() => {
          setPending(false);
          setLoading(false);
        });
    },
    [ownerScope],
  );

  useEffect(() => {
    const dateRaw = searchParams.get("date");
    const parsed = dateRaw ? new Date(`${dateRaw}T12:00:00`) : null;
    const valid = parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
    const anchor = valid ?? new Date();
    if (valid) {
      setWeekStart(startOfWeek(valid));
      setMonthCursor(startOfMonth(valid));
    }
    loadAround(anchor);
    void fetchCalendarContacts().then((result) => setContacts(result.contacts));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const wanted = searchParams.get("event");
    if (!wanted || events.length === 0) return;
    const match = events.find((ev) => calendarEventMatchesId(ev.id, wanted));
    if (match) setSelectedEvent(match);
  }, [events, searchParams]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const eventsByDay = useMemo(() => {
    const marked = applySameDayRescheduleDisplay(events);
    const map = new Map<string, UnifiedCalendarEvent[]>();
    for (const ev of marked) {
      const key = dayKey(new Date(ev.startAt));
      const list = map.get(key) ?? [];
      list.push(ev);
      map.set(key, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => {
        const t = new Date(a.startAt).getTime() - new Date(b.startAt).getTime();
        if (t !== 0) return t;
        const rank = (e: UnifiedCalendarEvent) =>
          e.superseded ? 2 : e.rescheduled ? 1 : 0;
        return rank(a) - rank(b);
      });
    }
    return map;
  }, [events]);

  const weekDays = useMemo(() => {
    const all = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
    return showWeekends ? all : all.filter((d) => d.getDay() !== 0 && d.getDay() !== 6);
  }, [weekStart, showWeekends]);

  const todayEvents = eventsByDay.get(dayKey(now)) ?? [];
  const tomorrowEvents = eventsByDay.get(dayKey(addDays(now, 1))) ?? [];

  const filteredContacts = useMemo(() => {
    const q = contactQuery.trim().toLowerCase();
    if (!q) return contacts.slice(0, 40);
    return contacts
      .filter(
        (c) =>
          c.displayName.toLowerCase().includes(q) || c.email.toLowerCase().includes(q),
      )
      .slice(0, 40);
  }, [contacts, contactQuery]);

  const gridHeight = (HOUR_END - HOUR_START) * HOUR_HEIGHT;
  const nowDayIndex = weekDays.findIndex((d) => sameDay(d, now));
  const nowMins = minutesFromDayStart(now);
  const nowTop =
    nowDayIndex >= 0 && nowMins >= 0 && nowMins <= (HOUR_END - HOUR_START) * 60
      ? (nowMins / 60) * HOUR_HEIGHT
      : null;

  function goToday() {
    const w = startOfWeek(new Date());
    setWeekStart(w);
    setMonthCursor(startOfMonth(new Date()));
    setSelectedEvent(null);
    loadAround(new Date());
  }

  function shiftWeek(delta: number) {
    const next = addDays(weekStart, delta * 7);
    setWeekStart(next);
    setMonthCursor(startOfMonth(next));
    setSelectedEvent(null);
    loadAround(next);
  }

  function shiftMonth(delta: number) {
    const next = new Date(monthCursor.getFullYear(), monthCursor.getMonth() + delta, 1);
    setMonthCursor(next);
    setWeekStart(startOfWeek(next));
    setSelectedEvent(null);
    loadAround(next);
  }

  function selectMiniDay(day: Date) {
    setWeekStart(startOfWeek(day));
    setMonthCursor(startOfMonth(day));
    setView("week");
    loadAround(day);
  }

  function openSchedule() {
    setContactQuery("");
    setPickContactOpen(true);
  }

  const workspace = (
    <div className="mx-auto flex h-[calc(100dvh-3.5rem)] max-w-[1600px] flex-col px-3 py-4 sm:px-5 sm:py-5">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-text-primary">Calendar</h1>
          <p className="mt-0.5 text-sm text-text-caption">
            Plan your day, week and never miss important activities.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="secondary" className="h-9 px-3" onClick={goToday}>
            Today
          </Button>
          <div className="inline-flex items-center rounded-lg border border-border-default bg-surface">
            <button
              type="button"
              className="inline-flex size-9 items-center justify-center text-text-caption hover:bg-subtle"
              onClick={() => (view === "week" ? shiftWeek(-1) : shiftMonth(-1))}
              aria-label="Previous"
            >
              <ChevronLeft className="size-4" />
            </button>
            <span className="min-w-[10.5rem] px-2 text-center text-sm font-medium text-text-primary">
              {view === "week"
                ? formatWeekRange(weekStart)
                : monthCursor.toLocaleDateString(undefined, {
                    month: "long",
                    year: "numeric",
                  })}
            </span>
            <button
              type="button"
              className="inline-flex size-9 items-center justify-center text-text-caption hover:bg-subtle"
              onClick={() => (view === "week" ? shiftWeek(1) : shiftMonth(1))}
              aria-label="Next"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>

          <DropdownSelect
            value={view}
            options={[
              { value: "week", label: "Week" },
              { value: "month", label: "Month" },
            ]}
            onChange={(value) => setView(value as CalView)}
            aria-label="Calendar view"
          />

          <Button
            type="button"
            variant="primary"
            className="h-9 px-3"
            onClick={openSchedule}
          >
            <Plus className="size-4" />
            Schedule meeting
          </Button>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2 sm:gap-3">
        {canViewTeam ? (
          <div className="inline-flex h-9 overflow-hidden rounded-lg border border-border-default bg-surface text-sm">
            <button
              type="button"
              className={`px-3 ${
                ownerScope === "mine"
                  ? "bg-brand font-medium text-white"
                  : "text-text-primary hover:bg-subtle"
              }`}
              onClick={() => {
                if (ownerScope === "mine") return;
                setOwnerScope("mine");
                loadAround(view === "month" ? monthCursor : weekStart, "mine");
              }}
            >
              Me ({userName})
            </button>
            <button
              type="button"
              className={`border-l border-border-default px-3 ${
                ownerScope === "all"
                  ? "bg-brand font-medium text-white"
                  : "text-text-primary hover:bg-subtle"
              }`}
              onClick={() => {
                if (ownerScope === "all") return;
                setOwnerScope("all");
                loadAround(view === "month" ? monthCursor : weekStart, "all");
              }}
            >
              Team
            </button>
          </div>
        ) : (
          <span className="inline-flex h-9 items-center rounded-lg border border-border-default bg-surface px-3 text-sm text-text-primary">
            Me ({userName})
          </span>
        )}
        <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg px-1 text-sm text-text-secondary">
          <input
            type="checkbox"
            className="size-4 accent-brand"
            checked={showWeekends}
            onChange={(e) => setShowWeekends(e.target.checked)}
          />
          Show weekends
        </label>
        {pending ? <SkeletonText width={72} height={12} /> : null}
      </div>

      {error ? (
        <p className="mb-3 text-sm text-text-danger" role="alert">
          {error}
        </p>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col gap-4 xl:flex-row">
        <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-border-default bg-surface">
          {loading ? (
            <SalesCalendarGridSkeleton />
          ) : view === "week" ? (
            <div className="crm-fade-in flex min-h-0 flex-1 flex-col">
              <WeekGrid
                weekDays={weekDays}
                eventsByDay={eventsByDay}
                gridHeight={gridHeight}
                nowTop={nowDayIndex >= 0 ? nowTop : null}
                nowDayIndex={nowDayIndex}
                nowLabel={now.toLocaleTimeString(undefined, {
                  hour: "numeric",
                  minute: "2-digit",
                })}
                onSelectEvent={setSelectedEvent}
              />
            </div>
          ) : (
            <div className="crm-fade-in flex min-h-0 flex-1 flex-col">
              <MonthGrid
                month={monthCursor}
                eventsByDay={eventsByDay}
                showWeekends={showWeekends}
                onSelectDay={selectMiniDay}
                onSelectEvent={setSelectedEvent}
              />
            </div>
          )}
        </section>

        <aside className="flex w-full shrink-0 flex-col gap-4 overflow-y-auto xl:w-[300px]">
          {loading ? (
            <SalesCalendarAsideSkeleton />
          ) : (
            <div className="crm-fade-in flex flex-col gap-4">
              <MiniCalendar
                month={monthCursor}
                eventsByDay={eventsByDay}
                selectedWeekStart={weekStart}
                onMonthChange={(m) => {
                  setMonthCursor(m);
                  loadAround(m);
                }}
                onSelectDay={selectMiniDay}
              />

              <div className="rounded-xl border border-border-default bg-surface p-4">
                <AgendaSection
                  label={`Today — ${now.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}`}
                  events={todayEvents}
                  onSelect={setSelectedEvent}
                />
                <div className="mt-4 border-t border-border-default pt-4">
                  <AgendaSection
                    label={`Tomorrow — ${addDays(now, 1).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}`}
                    events={tomorrowEvents}
                    onSelect={setSelectedEvent}
                  />
                </div>

                <Button
                  type="button"
                  variant="secondary"
                  className="mt-4 h-10 w-full"
                  onClick={openSchedule}
                >
                  <Plus className="size-4" />
                  Schedule item
                </Button>
              </div>

              <div className="rounded-xl border border-border-default bg-surface p-4">
                <p className="text-sm font-semibold text-text-primary">
                  Meeting emails
                </p>
                <p className="mt-1 text-xs text-text-caption">
                  Invites plus CRM reminders at 24 hours and 1 hour before (owner
                  AI brief + CRM participants) are sent with your connected email
                  account (Configuration → Email).
                </p>
                <Link
                  to="/configuration/email"
                  className="mt-3 inline-flex text-sm font-medium text-text-link hover:underline"
                >
                  Email settings
                </Link>
              </div>
            </div>
          )}
        </aside>
      </div>

      {selectedEvent ? (
        <EventModal event={selectedEvent} onClose={() => setSelectedEvent(null)} />
      ) : null}

      {pickContactOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setPickContactOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-border-default bg-surface p-5 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="text-base font-semibold text-text-primary">
                  Schedule meeting
                </h3>
                <p className="mt-1 text-sm text-text-caption">
                  Choose a contact to schedule with.
                </p>
              </div>
              <button
                type="button"
                className="inline-flex size-8 items-center justify-center rounded-lg text-text-caption hover:bg-subtle"
                onClick={() => setPickContactOpen(false)}
              >
                <X className="size-4" />
              </button>
            </div>
            <input
              type="search"
              value={contactQuery}
              onChange={(e) => setContactQuery(e.target.value)}
              placeholder="Search contacts…"
              className="mt-4 w-full rounded-lg border border-border-default bg-surface px-3 py-2 text-sm outline-none focus:border-brand"
            />
            <ul className="mt-3 max-h-64 overflow-y-auto rounded-lg border border-border-default">
              {filteredContacts.length === 0 ? (
                <li className="px-3 py-6 text-center text-sm text-text-caption">
                  No contacts found.
                </li>
              ) : (
                filteredContacts.map((c) => (
                  <li key={c.id} className="border-b border-border-default last:border-0">
                    <button
                      type="button"
                      className="flex w-full flex-col px-3 py-2.5 text-left hover:bg-subtle"
                      onClick={() => {
                        setScheduleContact(c);
                        setPickContactOpen(false);
                        setContactQuery("");
                      }}
                    >
                      <span className="text-sm font-medium text-text-primary">
                        {c.displayName}
                      </span>
                      <span className="text-xs text-text-caption">{c.email}</span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>
        </div>
      ) : null}

      {scheduleContact ? (
        <ScheduleMeetingDialog
          contactId={scheduleContact.id}
          displayName={scheduleContact.displayName}
          email={scheduleContact.email}
          onClose={() => setScheduleContact(null)}
          onChanged={() =>
            loadAround(view === "month" ? monthCursor : weekStart)
          }
        />
      ) : null}
    </div>
  );

  return (
    <AgentModuleShell
      moduleId="sales"
      title="Calendar"
      welcome="I'm your **calendar agent**. Ask me to schedule a meeting or find your next open slot — the calendar stays fully usable on the right."
      chips={[
        {
          id: "chip-schedule",
          label: "Schedule a meeting",
          prompt: "Help me schedule a meeting with a contact",
        },
      ]}
      surface="list"
      workspace={workspace}
      collapseChatToFab
      onAfterTool={() =>
        loadAround(view === "month" ? monthCursor : weekStart)
      }
    />
  );
}

function WeekGrid({
  weekDays,
  eventsByDay,
  gridHeight,
  nowTop,
  nowDayIndex,
  nowLabel,
  onSelectEvent,
}: {
  weekDays: Date[];
  eventsByDay: Map<string, UnifiedCalendarEvent[]>;
  gridHeight: number;
  nowTop: number | null;
  nowDayIndex: number;
  nowLabel: string;
  onSelectEvent: (ev: UnifiedCalendarEvent) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Land near "now" (or 8 AM) so a 24h grid doesn't start at midnight.
    const focusTop =
      nowTop != null ? Math.max(0, nowTop - HOUR_HEIGHT) : 8 * HOUR_HEIGHT;
    el.scrollTop = focusTop;
  }, [weekDays, nowTop]);
  const today = new Date();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        className="grid shrink-0 border-b border-border-default"
        style={{ gridTemplateColumns: `56px repeat(${weekDays.length}, minmax(0, 1fr))` }}
      >
        <div className="border-r border-border-default" />
        {weekDays.map((day) => {
          const isToday = sameDay(day, today);
          return (
            <div
              key={dayKey(day)}
              className={`border-r border-border-default px-1 py-2 text-center last:border-r-0 ${
                isToday ? "bg-violet-0/50" : ""
              }`}
            >
              <p className="text-[11px] font-medium tracking-wide text-text-caption uppercase">
                {day.toLocaleDateString(undefined, { weekday: "short" })}
              </p>
              <p
                className={`mt-0.5 text-sm font-semibold ${
                  isToday ? "text-brand" : "text-text-primary"
                }`}
              >
                {day.getDate()}
              </p>
            </div>
          );
        })}
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
        <div
          className="grid"
          style={{
            gridTemplateColumns: `56px repeat(${weekDays.length}, minmax(0, 1fr))`,
            minHeight: gridHeight,
          }}
        >
          <div className="relative border-r border-border-default">
            {HOURS.map((hour) => (
              <div
                key={hour}
                className="relative border-b border-border-default"
                style={{ height: HOUR_HEIGHT }}
              >
                <span className="absolute -top-2 right-2 text-[10px] text-text-caption">
                  {formatHourLabel(hour)}
                </span>
              </div>
            ))}
          </div>

          {weekDays.map((day, dayIdx) => {
            const key = dayKey(day);
            const dayEvents = eventsByDay.get(key) ?? [];
            const isToday = sameDay(day, today);
            return (
              <div
                key={key}
                className={`relative border-r border-border-default last:border-r-0 ${
                  isToday ? "bg-violet-0/20" : ""
                }`}
                style={{ height: gridHeight }}
              >
                {HOURS.map((hour) => (
                  <div
                    key={hour}
                    className="border-b border-border-default"
                    style={{ height: HOUR_HEIGHT }}
                  />
                ))}

                {dayEvents.map((ev) => {
                  const layout = eventLayout(ev);
                  if (!layout) {
                    return (
                      <button
                        key={ev.id}
                        type="button"
                        className={`absolute top-1 right-1 left-1 z-10 truncate rounded-md border px-1.5 py-0.5 text-left text-[10px] font-medium ${eventChipClassName(ev)} ${ev.superseded ? "line-through" : ""}`}
                        onClick={() => onSelectEvent(ev)}
                      >
                        All day · {ev.title}
                      </button>
                    );
                  }
                  return (
                    <button
                      key={ev.id}
                      type="button"
                      className={`absolute right-1 left-1 overflow-hidden rounded-md border px-1.5 py-1 text-left shadow-sm ${eventChipClassName(ev)} ${ev.superseded ? "z-20 line-through" : ev.rescheduled ? "z-20" : "z-10"}`}
                      style={{ top: layout.top, height: layout.height }}
                      onClick={() => onSelectEvent(ev)}
                      title={`${formatRange(ev)} · ${ev.title}${ev.rescheduled ? " · Rescheduled" : ev.superseded ? " · Previous time" : ""}`}
                    >
                      <span className={`absolute top-0 bottom-0 left-0 w-0.5 ${eventAccentClassName(ev)}`} />
                      <p className="truncate pl-1 text-[10px] font-semibold leading-tight sm:text-[11px]">
                        {formatTime(ev.startAt, false)}
                        {ev.rescheduled
                          ? " · Rescheduled"
                          : ev.superseded
                            ? " · Previous"
                            : ev.endAt
                              ? ` – ${formatTime(ev.endAt, false)}`
                              : ""}
                      </p>
                      <p className="truncate pl-1 text-[11px] font-medium leading-tight sm:text-xs">
                        {ev.title}
                      </p>
                      {ev.rescheduled ? (
                        <p className="truncate pl-1 text-[10px] font-semibold uppercase tracking-wide">
                          Rescheduled
                        </p>
                      ) : ev.superseded && layout.height > 44 ? (
                        <p className="truncate pl-1 text-[10px] font-medium uppercase tracking-wide">
                          Previous time
                        </p>
                      ) : ev.contactName && layout.height > 44 ? (
                        <p className="truncate pl-1 text-[10px] opacity-80">
                          {ev.contactName}
                        </p>
                      ) : null}
                    </button>
                  );
                })}

                {nowTop != null && dayIdx === nowDayIndex ? (
                  <div
                    className="pointer-events-none absolute right-0 left-0 z-20"
                    style={{ top: nowTop }}
                  >
                    <div className="relative border-t-2 border-red-500">
                      <span className="absolute -top-2.5 -left-1 rounded bg-red-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                        {nowLabel}
                      </span>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function MonthGrid({
  month,
  eventsByDay,
  showWeekends,
  onSelectDay,
  onSelectEvent,
}: {
  month: Date;
  eventsByDay: Map<string, UnifiedCalendarEvent[]>;
  showWeekends: boolean;
  onSelectDay: (d: Date) => void;
  onSelectEvent: (ev: UnifiedCalendarEvent) => void;
}) {
  const first = startOfMonth(month);
  const gridStart = startOfWeek(first);
  const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const labels = showWeekends
    ? ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    : ["Mon", "Tue", "Wed", "Thu", "Fri"];
  const visible = showWeekends
    ? cells
    : cells.filter((d) => d.getDay() !== 0 && d.getDay() !== 6);
  const cols = showWeekends ? 7 : 5;
  const today = new Date();

  return (
    <div className="flex min-h-0 flex-1 flex-col p-2 sm:p-3">
      <div
        className="mb-1 grid gap-1"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      >
        {labels.map((l) => (
          <div
            key={l}
            className="px-1 py-1 text-center text-[11px] font-medium text-text-caption uppercase"
          >
            {l}
          </div>
        ))}
      </div>
      <div
        className="grid min-h-0 flex-1 gap-1"
        style={{
          gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
          gridAutoRows: "minmax(72px, 1fr)",
        }}
      >
        {visible.map((day) => {
          const inMonth = day.getMonth() === month.getMonth();
          const key = dayKey(day);
          const dayEvents = eventsByDay.get(key) ?? [];
          const isToday = sameDay(day, today);
          return (
            <div
              key={key}
              role="button"
              tabIndex={0}
              onClick={() => onSelectDay(day)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelectDay(day);
                }
              }}
              className={`flex flex-col rounded-lg border border-border-default p-1.5 text-left ${
                inMonth ? "bg-surface" : "bg-subtle/40"
              } ${isToday ? "ring-1 ring-brand" : ""}`}
            >
              <span
                className={`mb-1 inline-flex size-6 items-center justify-center rounded-full text-xs font-medium ${
                  isToday
                    ? "bg-brand text-white"
                    : inMonth
                      ? "text-text-primary"
                      : "text-text-caption"
                }`}
                style={isToday ? { color: "#FFFFFF" } : undefined}
              >
                {day.getDate()}
              </span>
              <div className="flex flex-col gap-0.5 overflow-hidden">
                {dayEvents.slice(0, 3).map((ev) => (
                  <button
                    key={ev.id}
                    type="button"
                    className={`truncate rounded px-1 py-0.5 text-left text-[10px] font-medium ${eventChipClassName(ev)} ${ev.superseded ? "line-through" : ""}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectEvent(ev);
                    }}
                  >
                    {ev.rescheduled ? "Rescheduled · " : ev.superseded ? "Previous · " : ""}
                    {ev.title}
                  </button>
                ))}
                {dayEvents.length > 3 ? (
                  <span className="px-1 text-[10px] text-text-caption">
                    +{dayEvents.length - 3}
                  </span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MiniCalendar({
  month,
  eventsByDay,
  selectedWeekStart,
  onMonthChange,
  onSelectDay,
}: {
  month: Date;
  eventsByDay: Map<string, UnifiedCalendarEvent[]>;
  selectedWeekStart: Date;
  onMonthChange: (m: Date) => void;
  onSelectDay: (d: Date) => void;
}) {
  const first = startOfMonth(month);
  const gridStart = startOfWeek(first);
  const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const today = new Date();
  const weekEnd = addDays(selectedWeekStart, 6);

  return (
    <div className="rounded-xl border border-border-default bg-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-semibold text-text-primary">
          {month.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
        </p>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            className="inline-flex size-7 items-center justify-center rounded-md text-text-caption hover:bg-subtle"
            onClick={() => onMonthChange(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
          >
            <ChevronLeft className="size-4" />
          </button>
          <button
            type="button"
            className="inline-flex size-7 items-center justify-center rounded-md text-text-caption hover:bg-subtle"
            onClick={() => onMonthChange(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
      </div>
      <div className="mb-1 grid grid-cols-7 gap-0.5">
        {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
          <div
            key={`${d}-${i}`}
            className="py-1 text-center text-[10px] font-medium text-text-caption"
          >
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((day) => {
          const inMonth = day.getMonth() === month.getMonth();
          const isToday = sameDay(day, today);
          const inWeek = day >= selectedWeekStart && day <= weekEnd;
          const hasEvents = (eventsByDay.get(dayKey(day))?.length ?? 0) > 0;
          return (
            <button
              key={dayKey(day)}
              type="button"
              onClick={() => onSelectDay(day)}
              className={`relative flex size-8 items-center justify-center rounded-full text-xs ${
                isToday
                  ? "bg-brand font-semibold text-white"
                  : inWeek
                    ? "bg-violet-0 font-medium text-brand"
                    : inMonth
                      ? "text-text-primary hover:bg-subtle"
                      : "text-text-caption hover:bg-subtle"
              }`}
              style={isToday ? { color: "#FFFFFF" } : undefined}
            >
              {day.getDate()}
              {hasEvents && !isToday ? (
                <span className="absolute bottom-0.5 size-1 rounded-full bg-brand" />
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function AgendaSection({
  label,
  events,
  onSelect,
}: {
  label: string;
  events: UnifiedCalendarEvent[];
  onSelect: (ev: UnifiedCalendarEvent) => void;
}) {
  return (
    <div>
      <p className="text-sm font-semibold text-text-primary">{label}</p>
      {events.length === 0 ? (
        <p className="mt-2 text-xs text-text-caption">No meetings scheduled</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {events.map((ev) => (
            <li key={ev.id}>
              <button
                type="button"
                className="flex w-full items-start gap-2 rounded-lg px-1 py-1 text-left hover:bg-subtle"
                onClick={() => onSelect(ev)}
              >
                <span className={`mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-md ${ev.superseded ? "bg-slate-100 text-slate-500" : ev.rescheduled ? "bg-amber-50 text-amber-900" : "bg-[#F3EBFF] text-[#5B21B6]"}`}>
                  <CalendarDays className="size-3.5" />
                </span>
                <span className="min-w-0">
                  <span className={`block truncate text-sm font-medium text-text-primary ${ev.superseded ? "line-through text-text-caption" : ""}`}>
                    {ev.title}
                  </span>
                  <span className={`block text-xs text-text-caption ${ev.superseded ? "line-through" : ""}`}>
                    {formatRange(ev)}
                    {ev.contactName ? ` · ${ev.contactName}` : ""}
                    {ev.rescheduled ? " · Rescheduled" : ev.superseded ? " · Previous time" : ""}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EventModal({
  event,
  onClose,
}: {
  event: UnifiedCalendarEvent;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="max-h-[min(85dvh,40rem)] w-full min-w-0 max-w-md overflow-x-hidden overflow-y-auto rounded-2xl border border-border-default bg-surface p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className={`min-w-0 break-words text-base font-semibold text-text-primary ${event.superseded ? "line-through text-text-caption" : ""}`}>
                {event.title}
              </h3>
              {event.rescheduled ? (
                <span className="rounded-md bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-900">
                  Rescheduled
                </span>
              ) : event.superseded ? (
                <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                  Previous time
                </span>
              ) : (
                <span className="rounded-md bg-violet-0 px-2 py-0.5 text-[11px] font-medium text-brand">
                  Worktual
                </span>
              )}
            </div>
            {event.previousStartAt && event.rescheduled ? (
              <p className="mt-1 text-sm text-text-caption line-through">
                {new Date(event.previousStartAt).toLocaleString(undefined, {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </p>
            ) : null}
            <p className={`mt-1 text-sm text-text-secondary ${event.superseded ? "line-through" : ""}`}>
              {formatRange(event)}
            </p>
          </div>
          <button
            type="button"
            className="inline-flex size-8 items-center justify-center rounded-lg text-text-caption hover:bg-subtle"
            onClick={onClose}
          >
            <X className="size-4" />
          </button>
        </div>
        {event.contactName ? (
          <p className="mt-3 break-words text-sm text-text-primary">
            <span className="font-medium">Contact:</span>{" "}
            {event.contactId ? (
              <Link to={`/contact/${event.contactId}`} className="text-text-link hover:underline">
                {event.contactName}
              </Link>
            ) : (
              event.contactName
            )}
          </p>
        ) : null}
        {event.location ? (
          <p className="mt-1 break-words text-sm text-text-caption">{event.location}</p>
        ) : null}
        {event.description ? (
          <p className="mt-2 break-words text-sm whitespace-pre-line text-text-secondary [overflow-wrap:anywhere]">
            {event.description}
          </p>
        ) : null}
        <div className="mt-4 flex flex-col gap-2">
          {event.meetLink ? (
            <a
              href={event.meetLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-border-default px-4 text-sm font-semibold hover:bg-subtle"
            >
              <Video className="size-4" />
              Join Meet
            </a>
          ) : null}
          {event.htmlLink ? (
            <a
              href={event.htmlLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-9 items-center justify-center gap-2 text-sm font-medium text-text-link hover:underline"
            >
              <ExternalLink className="size-4" />
              Open in Google Calendar
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
}
