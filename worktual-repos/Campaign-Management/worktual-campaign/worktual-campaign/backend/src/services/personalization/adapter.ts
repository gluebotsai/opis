import type { DynamicRecipientContext } from "./types.js";

/**
 * Pluggable source of per-recipient dynamic context (offers, custom fields).
 * Swap via PERSONALIZATION_ADAPTER env without changing send workers.
 */
export interface PersonalizationAdapter {
  readonly name: string;
  /** Single contact lookup. Null = no dynamic context (identity-only merge). */
  getContext(contactId: string): Promise<DynamicRecipientContext | null>;
  /** Batch lookup — preferred by send workers. */
  getContexts(
    contactIds: string[],
  ): Promise<Map<string, DynamicRecipientContext>>;
}
