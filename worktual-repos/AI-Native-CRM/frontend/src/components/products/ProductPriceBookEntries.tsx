import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import type { ProductDetail } from "@/services/products";
import {
  fetchPriceBookEntries,
  fetchPriceBooks,
  upsertPriceBookEntry,
  type PriceBook,
  type PriceBookEntry,
} from "@/services/price-books";

type TargetOption = {
  value: string;
  label: string;
  kind: "product" | "offer" | "addon";
  id: string;
};

export function ProductPriceBookEntries({
  product,
}: {
  product: ProductDetail;
}) {
  const [books, setBooks] = useState<PriceBook[]>([]);
  const [bookId, setBookId] = useState("");
  const [entries, setEntries] = useState<PriceBookEntry[]>([]);
  const [target, setTarget] = useState("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const targets: TargetOption[] = [
    {
      value: `product:${product.id}`,
      label: `Product base · ${product.name}`,
      kind: "product",
      id: product.id,
    },
    ...(product.offers ?? []).map((o) => ({
      value: `offer:${o.id}`,
      label: `Offer · ${o.name}`,
      kind: "offer" as const,
      id: o.id,
    })),
    ...(product.addons ?? []).map((a) => ({
      value: `addon:${a.id}`,
      label: `Addon · ${a.name}`,
      kind: "addon" as const,
      id: a.id,
    })),
  ];

  const reloadEntries = useCallback(async (priceBookId: string) => {
    if (!priceBookId) {
      setEntries([]);
      return;
    }
    const result = await fetchPriceBookEntries({
      priceBookId,
      productId: product.id,
    });
    if (result.ok) setEntries(result.items);
  }, [product.id]);

  useEffect(() => {
    void (async () => {
      const result = await fetchPriceBooks();
      setBooks(result.items);
      const def =
        result.items.find((b) => b.isDefault) ?? result.items[0] ?? null;
      if (def) {
        setBookId(def.id);
        await reloadEntries(def.id);
      }
    })();
  }, [reloadEntries]);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const selected = targets.find((t) => t.value === target);
    if (!bookId || !selected) {
      setError("Select a price book and target.");
      return;
    }
    const n = Number(amount);
    if (!Number.isFinite(n) || n < 0) {
      setError("Enter a valid amount.");
      return;
    }
    setPending(true);
    const result = await upsertPriceBookEntry({
      priceBookId: bookId,
      productId: selected.kind === "product" ? selected.id : null,
      offerId: selected.kind === "offer" ? selected.id : null,
      addonId: selected.kind === "addon" ? selected.id : null,
      amount: n,
    });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setAmount("");
    await reloadEntries(bookId);
  }

  function labelForEntry(entry: PriceBookEntry): string {
    if (entry.productId) return "Product base";
    const offer = product.offers?.find((o) => o.id === entry.offerId);
    if (offer) return `Offer · ${offer.name}`;
    const addon = product.addons?.find((a) => a.id === entry.addonId);
    if (addon) return `Addon · ${addon.name}`;
    return "Entry";
  }

  if (books.length === 0) {
    return (
      <section className="rounded-xl border border-border-default bg-surface p-5 sm:p-6">
        <h2 className="text-base font-semibold tracking-tight text-text-primary">
          Price book entries
        </h2>
        <p className="mt-3 text-sm text-text-caption">
          No price books yet.{" "}
          <Link
            to="/configuration/price-books"
            className="font-medium text-text-secondary underline-offset-2 hover:text-text-primary hover:underline"
          >
            Create a price book
          </Link>{" "}
          for regional list prices.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-border-default bg-surface p-5 sm:p-6">
      <h2 className="text-base font-semibold tracking-tight text-text-primary">
        Price book entries
      </h2>
      <p className="mt-1 text-sm text-text-caption">
        Override list price for this product, an offer, or an addon in a selected
        book.
      </p>

      <div className="mt-4 max-w-xs">
        <Select
          label="Price book"
          value={bookId}
          onChange={(e) => {
            const next = e.target.value;
            setBookId(next);
            void reloadEntries(next);
          }}
          options={books.map((b) => ({
            value: b.id,
            label: `${b.name} (${b.currency})${b.isDefault ? " · default" : ""}`,
          }))}
        />
      </div>

      {error ? (
        <p className="mt-3 text-sm text-text-danger" role="alert">
          {error}
        </p>
      ) : null}

      <ul className="mt-4 divide-y divide-border-default overflow-hidden rounded-lg border border-border-default">
        {entries.length === 0 ? (
          <li className="px-4 py-6 text-sm text-text-caption">
            No entries in this book for this product yet.
          </li>
        ) : (
          entries.map((entry) => (
            <li
              key={entry.id}
              className="flex items-center justify-between gap-3 px-4 py-3 text-sm"
            >
              <span className="text-text-primary">{labelForEntry(entry)}</span>
              <span className="tabular-nums text-text-secondary">
                {entry.amount}
              </span>
            </li>
          ))
        )}
      </ul>

      <form
        onSubmit={onSave}
        className="mt-4 grid gap-3 sm:grid-cols-[1fr_140px_auto]"
      >
        <Select
          label="Target"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          options={[
            { value: "", label: "Select…" },
            ...targets.map((t) => ({ value: t.value, label: t.label })),
          ]}
        />
        <Input
          label="Amount"
          type="number"
          min="0"
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <div className="flex items-end">
          <Button type="submit" disabled={pending}>
            Save entry
          </Button>
        </div>
      </form>
    </section>
  );
}
