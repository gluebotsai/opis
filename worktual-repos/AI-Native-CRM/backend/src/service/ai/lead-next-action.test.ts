import { describe, expect, it } from "vitest";
import { deriveProcessNextAction } from "@/service/ai/lead-next-action";
import type { LeadSummaryContext } from "@/service/ai/lead-summary-agent";

function baseCtx(over: Partial<LeadSummaryContext> = {}): LeadSummaryContext {
  return {
    contactId: "c1",
    organizationId: "1000",
    displayName: "Hansa Solanki",
    firstName: "Hansa",
    contactType: "lead",
    leadStatus: "qualified",
    status: "active",
    leadSource: "web",
    title: "Director",
    companyName: "Acme",
    industry: null,
    companyDescription: null,
    products: null,
    domain: null,
    linkedinUrl: null,
    employeeCount: null,
    notes: null,
    orderCount: 0,
    bant: { budget: true, authority: true, need: true, timeline: false },
    deals: [],
    activities: [],
    score: 55,
    fitScore: 20,
    intentScore: 35,
    band: "warm",
    nextBestAction:
      "Book the confirmed demo on the assigned rep's calendar and log the meeting.",
    scoreBreakdown: null,
    ownerUserId: "42",
    hasEmail: true,
    hasPhone: true,
    omniChannelSummary: null,
    ...over,
  };
}

function act(
  over: Partial<LeadSummaryContext["activities"][number]> &
    Pick<LeadSummaryContext["activities"][number], "type" | "subject">,
): LeadSummaryContext["activities"][number] {
  return {
    id: over.id ?? "a1",
    body: null,
    transcriptText: null,
    createdAt: new Date().toISOString(),
    dueAt: null,
    completedAt: null,
    taskStatus: null,
    ...over,
  };
}

describe("deriveProcessNextAction", () => {
  it("returns quote follow-up for converted lead with quotation sent", () => {
    const action = deriveProcessNextAction(
      baseCtx({
        leadStatus: "converted",
        contactType: "customer",
        activities: [
          act({
            id: "e1",
            type: "email",
            subject: "Quotation for Worktual CRM",
            body: "Please find attached our quotation.",
          }),
          act({
            id: "m1",
            type: "meeting",
            subject: "Product demo",
            createdAt: new Date(Date.now() - 3 * 86400000).toISOString(),
            dueAt: new Date(Date.now() - 2 * 86400000).toISOString(),
          }),
        ],
      }),
    );
    expect(action).toMatch(/quotation/i);
    expect(action).not.toMatch(/Book the confirmed demo/i);
  });

  it("prep for upcoming meeting instead of booking demo", () => {
    const upcoming = new Date(Date.now() + 2 * 86400000).toISOString();
    const action = deriveProcessNextAction(
      baseCtx({
        activities: [
          act({
            id: "m2",
            type: "meeting",
            subject: "Discovery call",
            dueAt: upcoming,
          }),
          act({
            id: "e2",
            type: "email",
            subject: "Re: demo",
            body: "Today 10.45 am works for me",
          }),
        ],
      }),
    );
    expect(action).toMatch(/upcoming meeting/i);
    expect(action).not.toMatch(/Book the confirmed demo/i);
  });

  it("books demo only when scheduling signal exists and no meeting logged", () => {
    const action = deriveProcessNextAction(
      baseCtx({
        activities: [
          act({
            id: "e3",
            type: "email",
            subject: "Re: Product demo",
            body: "Yes, schedule a call — today 10.45 am works for me",
          }),
        ],
      }),
    );
    expect(action).toMatch(/Book the confirmed demo/i);
  });

  it("follows up on sent quote for active lead", () => {
    const action = deriveProcessNextAction(
      baseCtx({
        activities: [
          act({
            id: "e4",
            type: "email",
            subject: "Proposal PROP-1042",
            body: "Attached is our proposal for your review.",
          }),
        ],
      }),
    );
    expect(action).toMatch(/quote or proposal/i);
  });

  it("rewrites WhatsApp NBA to email when the contact has email", () => {
    const action = deriveProcessNextAction(
      baseCtx({
        score: 0,
        ownerUserId: null,
        hasEmail: true,
        hasPhone: true,
        nextBestAction: "Follow up on WhatsApp regarding demo",
      }),
      "Follow up on WhatsApp regarding demo",
    );
    expect(action).toMatch(/email/i);
    expect(action).not.toMatch(/whatsapp/i);
  });

  it("rewrites Instagram NBA to a call when only phone exists", () => {
    const action = deriveProcessNextAction(
      baseCtx({
        score: 0,
        ownerUserId: null,
        hasEmail: false,
        hasPhone: true,
        nextBestAction: "Follow up on Instagram about the demo",
      }),
      "Follow up on Instagram about the demo",
    );
    expect(action).toMatch(/call/i);
    expect(action).not.toMatch(/instagram/i);
  });
});
