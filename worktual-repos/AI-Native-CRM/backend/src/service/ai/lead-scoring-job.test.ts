import { describe, expect, it } from "vitest";
import {
  scoreSignalFingerprint,
  shouldRescoreAfterTrigger,
} from "@/service/ai/lead-scoring-job";
import { omniChannelHash } from "@/service/ai/lead-summary-agent";

describe("scoreSignalFingerprint", () => {
  it("changes when omni-channel summary appears", () => {
    const empty = scoreSignalFingerprint({
      omniChannelSummary: null,
      recentActivityCount: 0,
      inboundEmailCount: 0,
      callOrMeetingCount: 0,
      demoOrQuoteRequests: 0,
      schedulingReplies: 0,
    });
    const omniText = "Demo Request. Interested in Cognitive CDP.";
    const withOmni = scoreSignalFingerprint({
      omniChannelSummary: omniText,
      recentActivityCount: 0,
      inboundEmailCount: 0,
      callOrMeetingCount: 0,
      demoOrQuoteRequests: 0,
      schedulingReplies: 0,
    });
    expect(withOmni).not.toBe(empty);
    expect(withOmni.startsWith(omniChannelHash(omniText)!)).toBe(true);
  });

  it("changes when company is attached", () => {
    const before = scoreSignalFingerprint({
      omniChannelSummary: null,
      recentActivityCount: 0,
      inboundEmailCount: 0,
      callOrMeetingCount: 0,
      demoOrQuoteRequests: 0,
      schedulingReplies: 0,
    });
    const after = scoreSignalFingerprint({
      omniChannelSummary: null,
      recentActivityCount: 0,
      inboundEmailCount: 0,
      callOrMeetingCount: 0,
      demoOrQuoteRequests: 0,
      schedulingReplies: 0,
      companyName: "Adidas",
      title: "Manager",
      hasPhone: true,
    });
    expect(after).not.toBe(before);
  });

  it("changes when a call is logged", () => {
    const before = scoreSignalFingerprint({
      omniChannelSummary: null,
      recentActivityCount: 0,
      inboundEmailCount: 0,
      callOrMeetingCount: 0,
      demoOrQuoteRequests: 0,
      schedulingReplies: 0,
    });
    const after = scoreSignalFingerprint({
      omniChannelSummary: null,
      recentActivityCount: 1,
      inboundEmailCount: 0,
      callOrMeetingCount: 1,
      demoOrQuoteRequests: 0,
      schedulingReplies: 0,
    });
    expect(after).not.toBe(before);
  });

  it("changes when BANT evidence is persisted", () => {
    const base = {
      omniChannelSummary: "Customer discussed a support platform.",
      recentActivityCount: 1,
      inboundEmailCount: 0,
      callOrMeetingCount: 1,
      demoOrQuoteRequests: 0,
      schedulingReplies: 0,
    };
    const before = scoreSignalFingerprint(base);
    const after = scoreSignalFingerprint({
      ...base,
      bantBudget: true,
      bantNeed: true,
      bantTimeline: true,
    });
    expect(after).not.toBe(before);
  });
});

describe("shouldRescoreAfterTrigger", () => {
  it("replays an in-flight score for a newer summary revision", () => {
    expect(
      shouldRescoreAfterTrigger(
        "summary_refreshed:2026-10-09T07:24:06.000Z",
        "summary_refreshed:2026-10-09T07:28:50.000Z",
      ),
    ).toBe(true);
  });

  it("does not replay the same summary revision", () => {
    const trigger = "summary_refreshed:2026-10-09T07:28:50.000Z";
    expect(shouldRescoreAfterTrigger(trigger, trigger)).toBe(false);
  });
});
