import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import {
  createCommerceOrder,
  fetchCommerceCreateOptions,
  fetchCommerceOrders,
  type CommerceOrderRow,
} from "@/services/commerce";
import { AgentModuleShell } from "@/components/coworker/AgentModuleShell";
import { MODULE_WORKSPACE_DESCRIPTION } from "@/lib/module-workspace-copy";
import {
  CHIP_BASE,
  TONE_DANGER,
  TONE_MUTED,
  TONE_SUCCESS,
} from "@/lib/ui-tones";

function commerceOrderStatusTone(status: string): string {
  switch (status.toLowerCase()) {
    case "confirmed":
    case "fulfilled":
    case "completed":
      return `${CHIP_BASE} ${TONE_SUCCESS}`;
    case "cancelled":
    case "canceled":
      return `${CHIP_BASE} ${TONE_DANGER}`;
    default:
      return `${CHIP_BASE} ${TONE_MUTED}`;
  }
}

export function CommerceOrdersPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const defaultContactId = searchParams.get("contactId") ?? undefined;

  const [orders, setOrders] = useState<CommerceOrderRow[]>([]);
  const [title, setTitle] = useState("Orders");
  const [canEdit, setCanEdit] = useState(false);
  const [contacts, setContacts] = useState<
    Array<{ id: string; displayName: string }>
  >([]);
  const [products, setProducts] = useState<
    Array<{ id: string; name: string; price: string | null }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(Boolean(defaultContactId));
  const [contactId, setContactId] = useState("");
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [busy, setBusy] = useState(false);

  const reload = async () => {
    setLoading(true);
    setError(null);
    try {
      const [list, opts] = await Promise.all([
        fetchCommerceOrders({ page: 1 }),
        fetchCommerceCreateOptions(),
      ]);
      setOrders(list.items);
      setTitle(list.title);
      setCanEdit(list.canEdit && opts.canEdit);
      setContacts(opts.contacts);
      setProducts(opts.products);
      const preferred =
        defaultContactId &&
        opts.contacts.some((c) => c.id === defaultContactId)
          ? defaultContactId
          : (opts.contacts[0]?.id ?? "");
      setContactId((prev) => prev || preferred);
      setProductId((prev) => prev || opts.products[0]?.id || "");
    } catch {
      setError("Failed to load commerce orders.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultContactId]);

  const onCreate = async () => {
    setError(null);
    if (!contactId) {
      setError("Select a contact.");
      return;
    }
    if (!productId) {
      setError("Select a product (add products in Product catalog first).");
      return;
    }
    setBusy(true);
    const result = await createCommerceOrder({
      contactId,
      productId,
      quantity: Number.parseFloat(quantity) || 1,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setShowCreate(false);
    navigate(`/commerce/${result.id}`);
  };

  const workspace = (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      {error ? (
        <p className="text-sm text-text-danger" role="alert">
          {error}
        </p>
      ) : null}

      {showCreate && canEdit ? (
        <div className="mt-6 grid gap-3 rounded-xl border border-border-default bg-surface p-4 sm:grid-cols-3">
          <Select
            label="Contact"
            value={contactId}
            onChange={(e) => setContactId(e.target.value)}
            options={[
              { value: "", label: "Select contact" },
              ...contacts.map((c) => ({
                value: c.id,
                label: c.displayName,
              })),
            ]}
          />
          <Select
            label="Product"
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
            options={[
              { value: "", label: "Select product" },
              ...products.map((p) => ({
                value: p.id,
                label: `${p.name}${p.price ? ` ($${p.price})` : ""}`,
              })),
            ]}
          />
          <Input
            label="Quantity"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
          <div className="sm:col-span-3">
            <Button type="button" disabled={busy} onClick={() => void onCreate()}>
              {busy ? "Creating…" : "Create order"}
            </Button>
          </div>
        </div>
      ) : null}

      <div className="mt-6 overflow-hidden rounded-xl border border-border-default bg-surface">
        {loading ? (
          <p className="px-6 py-10 text-sm text-text-caption">Loading…</p>
        ) : orders.length === 0 ? (
          <div className="px-6 py-16 text-center text-sm text-text-caption">
            No orders yet. Create one from a contact and product.
          </div>
        ) : (
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-border-default bg-subtle text-text-caption">
              <tr>
                <th className="px-4 py-3 font-medium">Order</th>
                <th className="px-4 py-3 font-medium">Contact</th>
                <th className="px-4 py-3 font-medium">Company</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Total</th>
                <th className="px-4 py-3 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr
                  key={o.id}
                  className="border-b border-border-default/70 last:border-0"
                >
                  <td className="px-4 py-3 font-medium">
                    <Link
                      to={`/commerce/${o.id}`}
                      className="text-brand underline"
                    >
                      {o.number}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-text-secondary">
                    {o.contactId ? (
                      <Link
                        to={`/contact/${o.contactId}`}
                        className="text-brand underline"
                      >
                        {o.contactName ?? "Contact"}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-3 text-text-secondary">
                    {o.companyId ? (
                      <Link
                        to={`/company/${o.companyId}`}
                        className="text-brand underline"
                      >
                        {o.companyName ?? "Company"}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={commerceOrderStatusTone(o.status)}>
                      {o.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-text-secondary">
                    {o.currency} {o.total}
                  </td>
                  <td className="px-4 py-3 text-text-caption">
                    {new Date(o.createdAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );

  return (
    <AgentModuleShell
      moduleId="commerce"
      title={title}
      welcome="I'm your **commerce agent**. Ask me to create a new order — the order list stays fully usable on the right."
      chips={[
        {
          id: "chip-new-order",
          label: "Create a new order",
          prompt: "Help me create a new commerce order",
        },
      ]}
      surface="list"
      workspaceTitle={title}
      workspaceSubtitle={MODULE_WORKSPACE_DESCRIPTION.commerce}
      workspaceHeaderActions={
        canEdit ? (
          <Button
            type="button"
            disabled={!contacts.length || !products.length}
            onClick={() => setShowCreate((v) => !v)}
          >
            <Plus className="size-4" strokeWidth={2} />
            New order
          </Button>
        ) : undefined
      }
      workspace={workspace}
      onAfterTool={() => void reload()}
    />
  );
}
