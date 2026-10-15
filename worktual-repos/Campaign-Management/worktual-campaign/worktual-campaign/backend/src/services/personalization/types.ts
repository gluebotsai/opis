/**
 * Canonical per-recipient context for dynamic send / merge tags.
 * Adapters (fixture, noop, future DB) all produce this shape.
 */
export type DynamicRecipientContext = {
  contact_id: string;
  identity: {
    email?: string;
    phone?: string;
    first_name?: string;
    last_name?: string;
    company?: string;
    city?: string;
    job_title?: string;
  };
  offer?: {
    product_id: string;
    name: string;
    description?: string;
    image_url?: string;
    product_url: string;
    price?: string;
    currency?: string;
  };
  custom?: Record<string, string>;
};

export type PersonalizationMode = "dynamic_offer" | "none";

export type LaunchPlanPersonalization = {
  mode: PersonalizationMode;
  /** Adapter name used at send time (fixture | noop | …). */
  adapter?: string;
};
