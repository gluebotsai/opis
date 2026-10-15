import type { PersonalizationAdapter } from "./adapter.js";
import type { DynamicRecipientContext } from "./types.js";

/** Production-safe default — no dynamic offers; identity comes from CRM only. */
export class NoopPersonalizationAdapter implements PersonalizationAdapter {
  readonly name = "noop";

  async getContext(
    _contactId: string,
  ): Promise<DynamicRecipientContext | null> {
    return null;
  }

  async getContexts(
    _contactIds: string[],
  ): Promise<Map<string, DynamicRecipientContext>> {
    return new Map();
  }
}
