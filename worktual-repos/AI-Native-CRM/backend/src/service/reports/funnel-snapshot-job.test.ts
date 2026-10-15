import { describe, expect, it } from "vitest";
import { funnelSnapshotSweepIntervalMs } from "./funnel-snapshot-job";

describe("funnelSnapshotSweepIntervalMs", () => {
  it("defaults to 24 hours", () => {
    const prev = process.env.FUNNEL_SNAPSHOT_CRON_HOURS;
    delete process.env.FUNNEL_SNAPSHOT_CRON_HOURS;
    expect(funnelSnapshotSweepIntervalMs()).toBe(24 * 60 * 60 * 1000);
    if (prev !== undefined) process.env.FUNNEL_SNAPSHOT_CRON_HOURS = prev;
  });
});
