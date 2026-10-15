import { describe, expect, it } from "vitest";
import { shouldReplayLifecycleAfterTrigger } from "@/service/ai/lead-lifecycle-job";

describe("shouldReplayLifecycleAfterTrigger", () => {
  it("replays when a newer score revision arrives during analysis", () => {
    expect(
      shouldReplayLifecycleAfterTrigger(
        "score:summary_refreshed:revision-1",
        "score:summary_refreshed:revision-2",
      ),
    ).toBe(true);
  });

  it("does not replay an unchanged trigger or a cron sweep", () => {
    expect(
      shouldReplayLifecycleAfterTrigger(
        "score:summary_refreshed:revision-1",
        "score:summary_refreshed:revision-1",
      ),
    ).toBe(false);
    expect(
      shouldReplayLifecycleAfterTrigger(
        "score:summary_refreshed:revision-1",
        "cron_sweep",
      ),
    ).toBe(false);
  });
});
