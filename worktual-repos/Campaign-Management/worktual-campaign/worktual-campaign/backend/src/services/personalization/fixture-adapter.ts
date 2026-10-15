import type { PersonalizationAdapter } from "./adapter.js";
import type { DynamicRecipientContext } from "./types.js";
import fixtureRaw from "./fixture-recipients.json" with { type: "json" };

function asContext(row: unknown): DynamicRecipientContext | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  const contactId = String(r.contact_id || "").trim();
  if (!contactId) return null;
  const identity =
    r.identity && typeof r.identity === "object"
      ? (r.identity as DynamicRecipientContext["identity"])
      : {};
  const offerRaw =
    r.offer && typeof r.offer === "object"
      ? (r.offer as Record<string, unknown>)
      : null;
  const offer =
    offerRaw &&
    String(offerRaw.product_id || "").trim() &&
    String(offerRaw.name || "").trim() &&
    String(offerRaw.product_url || "").trim()
      ? {
          product_id: String(offerRaw.product_id).trim(),
          name: String(offerRaw.name).trim(),
          description: offerRaw.description
            ? String(offerRaw.description)
            : undefined,
          image_url: offerRaw.image_url
            ? String(offerRaw.image_url)
            : undefined,
          product_url: String(offerRaw.product_url).trim(),
          price: offerRaw.price != null ? String(offerRaw.price) : undefined,
          currency: offerRaw.currency
            ? String(offerRaw.currency)
            : undefined,
        }
      : undefined;
  const custom =
    r.custom && typeof r.custom === "object"
      ? Object.fromEntries(
          Object.entries(r.custom as Record<string, unknown>).map(([k, v]) => [
            k,
            String(v ?? ""),
          ]),
        )
      : undefined;
  return { contact_id: contactId, identity, offer, custom };
}

const FIXTURE_ROWS: DynamicRecipientContext[] = (
  Array.isArray(fixtureRaw) ? fixtureRaw : []
)
  .map(asContext)
  .filter((c): c is DynamicRecipientContext => Boolean(c));

const BY_ID = new Map(FIXTURE_ROWS.map((r) => [r.contact_id, r]));

/** Stable non-crypto hash → index into fixture offers for unknown CRM ids. */
function stableIndex(contactId: string, modulo: number): number {
  if (modulo <= 0) return 0;
  let h = 0;
  for (let i = 0; i < contactId.length; i += 1) {
    h = (h * 31 + contactId.charCodeAt(i)) >>> 0;
  }
  return h % modulo;
}

function contextForContactId(contactId: string): DynamicRecipientContext {
  const exact = BY_ID.get(contactId);
  if (exact) {
    return { ...exact, contact_id: contactId };
  }
  // Demo: assign a varied offer by hashing real CRM ids onto fixture catalog.
  const seed =
    FIXTURE_ROWS[stableIndex(contactId, FIXTURE_ROWS.length)] ||
    FIXTURE_ROWS[0];
  if (!seed) {
    return { contact_id: contactId, identity: {} };
  }
  return {
    contact_id: contactId,
    identity: { ...seed.identity },
    offer: seed.offer ? { ...seed.offer } : undefined,
    custom: seed.custom ? { ...seed.custom } : undefined,
  };
}

/** Demo adapter — different product offers per contact_id (JSON fixture). */
export class FixturePersonalizationAdapter implements PersonalizationAdapter {
  readonly name = "fixture";

  async getContext(
    contactId: string,
  ): Promise<DynamicRecipientContext | null> {
    const id = String(contactId || "").trim();
    if (!id) return null;
    return contextForContactId(id);
  }

  async getContexts(
    contactIds: string[],
  ): Promise<Map<string, DynamicRecipientContext>> {
    const out = new Map<string, DynamicRecipientContext>();
    for (const raw of contactIds) {
      const id = String(raw || "").trim();
      if (!id) continue;
      out.set(id, contextForContactId(id));
    }
    return out;
  }
}

export function listFixtureRecipients(): DynamicRecipientContext[] {
  return FIXTURE_ROWS.map((r) => ({
    ...r,
    identity: { ...r.identity },
    offer: r.offer ? { ...r.offer } : undefined,
    custom: r.custom ? { ...r.custom } : undefined,
  }));
}
