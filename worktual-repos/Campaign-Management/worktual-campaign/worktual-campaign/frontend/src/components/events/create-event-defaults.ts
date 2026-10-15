import type { OpportunityKind } from "@/lib/opportunity-events-store";

export const CREATE_EVENT_KINDS: OpportunityKind[] = [
  "form",
  "webinar",
  "coupon",
  "seasonal",
  "lifecycle_segment",
  "product",
  "external",
];

export const DEFAULT_EVENT_TITLES: Record<OpportunityKind, string> = {
  form: "Untitled form",
  coupon: "Untitled coupon",
  webinar: "Untitled webinar",
  lifecycle_segment: "Untitled lifecycle event",
  product: "Untitled product event",
  external: "Untitled external event",
  seasonal: "Untitled seasonal event",
};

export const DEFAULT_EVENT_DESCRIPTIONS: Record<OpportunityKind, string> = {
  form: "Design this form with the co-worker or Manual tab — live preview on the right.",
  webinar: "Plan a webinar — set dates and details, then launch for tracking.",
  coupon: "Define a coupon or offer window for campaign timing.",
  lifecycle_segment: "Lifecycle moment to anchor proactive campaigns.",
  product: "Product launch or update event for campaigns.",
  external: "External calendar event used for campaign planning.",
  seasonal: "Seasonal moment (festive, sale window, etc.).",
};
