import {
  createPriceBook,
  deletePriceBook,
  deletePriceBookEntry,
  listPriceBookEntries,
  listPriceBooks,
  resolveListPrice,
  updatePriceBook,
  upsertPriceBookEntry,
  type PriceBookEntryInput,
  type PriceBookInput,
} from "@/dao/products/price-book-service";
import { canEditProducts } from "@/service/auth/rbac";
import { requireRole } from "@/service/auth/require-role";
import type { ProductBillingFrequency } from "@prisma/client";

function parseBillingFrequency(
  raw: unknown,
): ProductBillingFrequency | null {
  if (raw === "monthly" || raw === "quarterly" || raw === "annual") return raw;
  return null;
}

export async function listPriceBooksCommand() {
  const items = await listPriceBooks();
  return {
    items: items.map((b) => ({
      ...b,
      createdAt: b.createdAt.toISOString(),
      updatedAt: b.updatedAt.toISOString(),
    })),
  };
}

export async function createPriceBookCommand(body: Record<string, unknown>) {
  try {
    await requireRole(
      canEditProducts,
      "You do not have permission to manage price books.",
    );
    const input: PriceBookInput = {
      name: String(body.name ?? ""),
      code: body.code ? String(body.code) : null,
      currency: body.currency ? String(body.currency) : null,
      isDefault: Boolean(body.isDefault),
    };
    const book = await createPriceBook(input);
    return {
      ok: true as const,
      book: {
        ...book,
        createdAt: book.createdAt.toISOString(),
        updatedAt: book.updatedAt.toISOString(),
      },
    };
  } catch (e) {
    return {
      ok: false as const,
      error: e instanceof Error ? e.message : "Failed to create price book.",
      status: 400,
    };
  }
}

export async function updatePriceBookCommand(
  id: string,
  body: Record<string, unknown>,
) {
  try {
    await requireRole(
      canEditProducts,
      "You do not have permission to manage price books.",
    );
    const book = await updatePriceBook(id, {
      name: String(body.name ?? ""),
      code: body.code ? String(body.code) : null,
      currency: body.currency ? String(body.currency) : undefined,
      isDefault: Boolean(body.isDefault),
    });
    return {
      ok: true as const,
      book: {
        ...book,
        createdAt: book.createdAt.toISOString(),
        updatedAt: book.updatedAt.toISOString(),
      },
    };
  } catch (e) {
    return {
      ok: false as const,
      error: e instanceof Error ? e.message : "Failed to update price book.",
      status: 400,
    };
  }
}

export async function deletePriceBookCommand(id: string) {
  try {
    await requireRole(
      canEditProducts,
      "You do not have permission to manage price books.",
    );
    await deletePriceBook(id);
    return { ok: true as const };
  } catch (e) {
    return {
      ok: false as const,
      error: e instanceof Error ? e.message : "Failed to delete price book.",
      status: 400,
    };
  }
}

export async function listPriceBookEntriesCommand(query: {
  priceBookId: string;
  productId?: string;
}) {
  try {
    const items = await listPriceBookEntries(query);
    return { ok: true as const, items };
  } catch (e) {
    return {
      ok: false as const,
      error: e instanceof Error ? e.message : "Failed to list entries.",
      status: 400,
    };
  }
}

export async function upsertPriceBookEntryCommand(
  body: Record<string, unknown>,
) {
  try {
    await requireRole(
      canEditProducts,
      "You do not have permission to manage price books.",
    );
    const amount = Number(body.amount);
    const input: PriceBookEntryInput = {
      priceBookId: String(body.priceBookId ?? ""),
      productId: body.productId ? String(body.productId) : null,
      offerId: body.offerId ? String(body.offerId) : null,
      addonId: body.addonId ? String(body.addonId) : null,
      amount,
      billingFrequency: parseBillingFrequency(body.billingFrequency),
    };
    const entry = await upsertPriceBookEntry(input);
    return { ok: true as const, entry };
  } catch (e) {
    return {
      ok: false as const,
      error: e instanceof Error ? e.message : "Failed to save entry.",
      status: 400,
    };
  }
}

export async function deletePriceBookEntryCommand(id: string) {
  try {
    await requireRole(
      canEditProducts,
      "You do not have permission to manage price books.",
    );
    await deletePriceBookEntry(id);
    return { ok: true as const };
  } catch (e) {
    return {
      ok: false as const,
      error: e instanceof Error ? e.message : "Failed to delete entry.",
      status: 400,
    };
  }
}

export async function resolveListPriceCommand(query: {
  productId?: string;
  offerId?: string;
  addonId?: string;
  priceBookId?: string;
}) {
  try {
    const result = await resolveListPrice(query);
    return { ok: true as const, ...result };
  } catch (e) {
    return {
      ok: false as const,
      error: e instanceof Error ? e.message : "Failed to resolve price.",
      status: 400,
    };
  }
}
