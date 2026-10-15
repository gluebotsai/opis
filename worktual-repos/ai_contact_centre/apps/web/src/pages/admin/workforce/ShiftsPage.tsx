import { useEffect, useState } from "react";
import { apiV1 } from "@/config/api-paths";
import { LoaderCircle } from "lucide-react";

import { StatusBanner } from "@/components/ui/status-banner";
import { ccCoreHttp } from "@/services/http";

type ShiftSchedule = {
  id: string;
  name: string;
  timezone: string;
  status: "active" | "inactive";
  openTime: string | null;
  closeTime: string | null;
  workingDays: string[];
  shifts: Array<{
    id: string;
    shiftType: string;
    dayOfWeek: string;
    startTime: string;
    endTime: string;
  }>;
};

export default function ShiftsPage() {
  const [schedules, setSchedules] = useState<ShiftSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const { data } = await ccCoreHttp.get<{ schedules: ShiftSchedule[] }>(
          apiV1("/setup/workforce/shifts"),
        );
        setSchedules(data.schedules);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load shifts");
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-6">
      <div>
        <h1 className="text-xl font-semibold text-neutral-900">Shifts & business hours</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Schedules inherited by teams and queues. Create new schedules via Organization setup or API.
        </p>
      </div>

      {error ? (
        <StatusBanner tone="error">{error}</StatusBanner>
      ) : null}

      {loading ? (
        <div className="flex items-center gap-2 py-12 text-sm text-neutral-600">
          <LoaderCircle className="size-4 animate-spin" />
          Loading schedules…
        </div>
      ) : (
        <div className="space-y-3">
          {schedules.map((schedule) => (
            <div key={schedule.id} className="bg-white p-4 xl:rounded-2xl xl:border-[0.6px] xl:border-[#bfbfbf]">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-neutral-900">{schedule.name}</h2>
                  <p className="mt-1 text-xs text-neutral-600">
                    {schedule.timezone} · {schedule.openTime?.slice(0, 5) ?? "—"} –{" "}
                    {schedule.closeTime?.slice(0, 5) ?? "—"} · {schedule.workingDays.join(", ")}
                  </p>
                </div>
                <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] capitalize text-neutral-600">
                  {schedule.status}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {[...new Set(schedule.shifts.map((shift) => shift.shiftType))].map((shiftType) => (
                  <span
                    key={shiftType}
                    className="rounded-full border-[0.6px] border-[#bfbfbf] px-2.5 py-1 text-xs text-neutral-700"
                  >
                    {shiftType}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
