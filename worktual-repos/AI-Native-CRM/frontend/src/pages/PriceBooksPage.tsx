import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { ConfigurationShell } from "@/components/configuration/ConfigurationShell";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Checkbox } from "@/components/ui/Checkbox";
import { PAGE_H1_CLASS, SUCCESS_FLASH_CLASS } from "@/lib/ui-tones";
import {
  createPriceBook,
  deletePriceBook,
  fetchPriceBooks,
  updatePriceBook,
  type PriceBook,
} from "@/services/price-books";

const CURRENCY_OPTIONS = [
  { value: "", label: "Tenant default" },
  { value: "USD", label: "USD" },
  { value: "EUR", label: "EUR" },
  { value: "GBP", label: "GBP" },
  { value: "INR", label: "INR" },
  { value: "AED", label: "AED" },
];

export function PriceBooksPage() {
  const [items, setItems] = useState<PriceBook[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [currency, setCurrency] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [pending, setPending] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchPriceBooks();
      setItems(result.items);
    } catch {
      setError("Failed to load price books.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    setMessage(null);
    const result = await createPriceBook({
      name,
      code: code || null,
      currency,
      isDefault,
    });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setName("");
    setCode("");
    setIsDefault(false);
    setMessage("Price book created.");
    await reload();
  }

  async function onSetDefault(book: PriceBook) {
    setPending(true);
    setError(null);
    const result = await updatePriceBook(book.id, {
      name: book.name,
      code: book.code,
      currency: book.currency,
      isDefault: true,
    });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setMessage(`“${book.name}” is now the default price book.`);
    await reload();
  }

  async function onDelete(book: PriceBook) {
    if (!window.confirm(`Delete price book “${book.name}”?`)) return;
    setPending(true);
    setError(null);
    const result = await deletePriceBook(book.id);
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setMessage("Price book deleted.");
    await reload();
  }

  return (
    <ConfigurationShell>
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
        <h1 className={PAGE_H1_CLASS}>Price books</h1>
        <p className="mt-1 text-sm text-text-caption">
          Region or market rate cards. Product list prices fall back to the
          product base price when no entry exists in the default book.
        </p>
        <p className="mt-2 text-sm text-text-secondary">
          Set amounts on a product detail page under{" "}
          <span className="font-medium text-text-primary">Price book entries</span>
          .
        </p>

        {error ? (
          <p className="mt-4 text-sm text-text-danger" role="alert">
            {error}
          </p>
        ) : null}
        {message ? (
          <p className={`mt-4 ${SUCCESS_FLASH_CLASS}`} role="status">
            {message}
          </p>
        ) : null}

        <form
          onSubmit={onCreate}
          className="mt-6 rounded-xl border border-border-default bg-surface p-5"
        >
          <h2 className="text-base font-semibold tracking-tight text-text-primary">
            New price book
          </h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Input
              label="Name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="India"
            />
            <Input
              label="Code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="IN"
            />
            <Select
              label="Currency"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              options={CURRENCY_OPTIONS}
            />
            <div className="flex items-end pb-2">
              <Checkbox
                id="price-book-default"
                checked={isDefault}
                onChange={(e) => setIsDefault(e.target.checked)}
                label="Set as default"
              />
            </div>
          </div>
          <Button type="submit" className="mt-4" disabled={pending}>
            <Plus className="size-4" strokeWidth={2} />
            Create price book
          </Button>
        </form>

        <div className="mt-8 overflow-hidden rounded-xl border border-border-default bg-surface">
          {loading ? (
            <p className="px-4 py-8 text-sm text-text-caption">Loading…</p>
          ) : items.length === 0 ? (
            <p className="px-4 py-8 text-sm text-text-caption">
              No price books yet. Create one for each region or currency market.
            </p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border-default bg-subtle text-text-caption">
                <tr>
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Currency</th>
                  <th className="px-4 py-3 font-medium">Entries</th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((book) => (
                  <tr
                    key={book.id}
                    className="border-b border-border-default last:border-0"
                  >
                    <td className="px-4 py-3">
                      <p className="font-medium text-text-primary">
                        {book.name}
                        {book.isDefault ? (
                          <span className="ml-2 text-xs font-medium text-brand">
                            Default
                          </span>
                        ) : null}
                      </p>
                      {book.code ? (
                        <p className="font-mono text-xs text-text-caption">
                          {book.code}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-text-secondary">
                      {book.currency}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-text-secondary">
                      {book.entryCount}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        {!book.isDefault ? (
                          <Button
                            type="button"
                            variant="secondary"
                            className="h-8"
                            disabled={pending}
                            onClick={() => void onSetDefault(book)}
                          >
                            Make default
                          </Button>
                        ) : null}
                        <button
                          type="button"
                          className="inline-flex size-8 items-center justify-center rounded-lg text-text-caption hover:bg-subtle hover:text-text-danger"
                          aria-label={`Delete ${book.name}`}
                          disabled={pending}
                          onClick={() => void onDelete(book)}
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </ConfigurationShell>
  );
}
