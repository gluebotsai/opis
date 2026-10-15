import { describe, expect, it } from "vitest";

import { queueDraftToGuidedDraft, queueGuidedDraftToQueueDraft } from "./queue-guided-draft";

describe("queueGuidedDraftToQueueDraft", () => {
  it("keeps a staged status even when nextField is still status", () => {
    const draft = queueGuidedDraftToQueueDraft({
      mode: "create",
      fields: {
        name: "sales queue",
        teamName: "Sales Team",
        status: "active",
      },
      nextField: "status",
      nextQuestion: "What should the status of this queue be?",
      ready: false,
    });

    expect(draft.status).toBe("active");
    expect(draft.question).toBe("status");
  });

  it("moves the preview question to hours after status is staged", () => {
    const draft = queueGuidedDraftToQueueDraft({
      mode: "create",
      fields: {
        name: "sales queue",
        teamName: "Sales Team",
        status: "active",
      },
      nextField: "businessHours",
      nextQuestion: "Which schedule should we use for this queue?",
      ready: false,
    });

    expect(draft.status).toBe("active");
    expect(draft.question).toBe("business-hours");
    expect(draft.ready).toBe(false);
    expect(draft.step).toBe("hours");
  });

  it("does not invent review when the server omits nextField", () => {
    const draft = queueGuidedDraftToQueueDraft({
      mode: "create",
      fields: {
        name: "sales queue",
        staffingSkipped: true,
      },
      nextField: null,
      ready: false,
    });

    expect(draft.question).toBeUndefined();
    expect(draft.step).toBeUndefined();
    expect(draft.ready).toBe(false);
  });

  it("marks ready only when the server says the draft is ready", () => {
    const draft = queueGuidedDraftToQueueDraft({
      mode: "create",
      fields: {
        name: "sales queue",
        teamName: "Sales Team",
        status: "active",
        staffingSkipped: true,
      },
      nextField: "review",
      ready: true,
    });

    expect(draft.question).toBe("review");
    expect(draft.step).toBe("review");
    expect(draft.ready).toBe(true);
  });
});

describe("queueDraftToGuidedDraft", () => {
  it("does not default a partial draft to review or ready", () => {
    const guided = queueDraftToGuidedDraft({
      guided: true,
      name: "sales queue",
      staffingSkipped: true,
      staffingComplete: true,
    });

    expect(guided?.nextField).toBeNull();
    expect(guided?.ready).toBe(false);
  });
});
