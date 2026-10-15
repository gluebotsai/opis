import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  fetchCommerceOrder,
  type CommerceOrderDetail,
} from "@/services/commerce";
import { AgentModuleShell } from "@/components/coworker/AgentModuleShell";
import { BackLink } from "@/components/ui/BackLink";
import {
  CHIP_BASE,
  PAGE_H1_CLASS,
  SECTION_H2_CLASS,
  TONE_DANGER,
  TONE_MUTED,
  TONE_SUCCESS,
} from "@/lib/ui-tones";
import { invoiceStatusPillClass } from "@/lib/invoice-labels";

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

export function CommerceOrderDetailPage() {
  const { orderId } = useParams<{ orderId: string }>();
  const [order, setOrder] = useState<CommerceOrderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!orderId) return;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await fetchCommerceOrder(orderId);
        if (!result.ok) {
          setOrder(null);
          setError(result.error);
          return;
        }
        setOrder(result.order);
      } catch {
        setError("Failed to load order.");
      } finally {
        setLoading(false);
      }
    })();
  }, [orderId]);

  if (loading) {
    return (
      <AgentModuleShell
        moduleId="commerce"
        title="Order"
        welcome="I'm your **commerce agent**. Ask about this order while it loads on the right."
        surface="detail"
        entityId={orderId ?? null}
        workspace={
          <div className="px-6 py-10 text-sm text-text-caption">Loading…</div>
        }
      />
    );
  }

  if (!order) {
    return (
      <AgentModuleShell
        moduleId="commerce"
        title="Order"
        welcome="I'm your **commerce agent**. Ask about orders while you use the workspace on the right."
        surface="detail"
        entityId={orderId ?? null}
        workspace={
          <div className="px-6 py-10">
            <p className="text-sm text-text-danger">{error ?? "Not found"}</p>
            <BackLink to="/commerce" className="mt-3">
              Back to commerce
            </BackLink>
          </div>
        }
      />
    );
  }

  const workspace = (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
      <BackLink to="/commerce">Back to commerce</BackLink>
      <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className={PAGE_H1_CLASS}>{order.number}</h1>
          <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-text-caption">
            <span className={commerceOrderStatusTone(order.status)}>
              {order.status}
            </span>
            <span>
              {order.currency} {order.total}
            </span>
          </p>
        </div>
      </div>

      <dl className="mt-8 grid gap-4 rounded-xl border border-border-default bg-surface p-5 sm:grid-cols-2">
        <div>
          <dt className="text-xs font-medium tracking-wide text-text-caption uppercase">
            Contact
          </dt>
          <dd className="mt-1 text-sm text-text-primary">
            {order.contactId ? (
              <Link
                to={`/contact/${order.contactId}`}
                className="text-brand underline"
              >
                {order.contactName ?? "View contact"}
              </Link>
            ) : (
              "—"
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium tracking-wide text-text-caption uppercase">
            Company
          </dt>
          <dd className="mt-1 text-sm text-text-primary">
            {order.companyId ? (
              <Link
                to={`/company/${order.companyId}`}
                className="text-brand underline"
              >
                {order.companyName ?? "Company"}
              </Link>
            ) : (
              "—"
            )}
          </dd>
        </div>
        {order.dealId ? (
          <div className="sm:col-span-2">
            <dt className="text-xs font-medium tracking-wide text-text-caption uppercase">
              Related deal
            </dt>
            <dd className="mt-1 text-sm">
              <Link
                to={`/sales/${order.dealId}`}
                className="text-brand underline"
              >
                {order.dealTitle ?? "View deal"}
              </Link>
            </dd>
          </div>
        ) : null}
      </dl>

      <section className="mt-6 rounded-xl border border-border-default bg-surface p-5">
        <h2 className={SECTION_H2_CLASS}>Line items</h2>
        <ul className="mt-3 divide-y divide-border-default">
          {order.lines.map((line) => (
            <li
              key={line.id}
              className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"
            >
              <span className="font-medium text-text-primary">{line.name}</span>
              <span className="text-text-secondary">
                {line.quantity} × {line.unitPrice} = {line.amount}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {order.invoices.length > 0 ? (
        <section className="mt-4 rounded-xl border border-border-default bg-surface p-5">
          <h2 className={SECTION_H2_CLASS}>Invoices</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {order.invoices.map((inv) => (
              <li key={inv.id} className="flex flex-wrap items-center gap-2">
                <Link
                  to={`/finance/${inv.id}`}
                  className="text-brand underline"
                >
                  {inv.number}
                </Link>
                <span className={invoiceStatusPillClass(inv.status)}>
                  {inv.status}
                </span>
                <span className="text-text-caption">
                  {inv.currency} {inv.total}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );

  return (
    <AgentModuleShell
      moduleId="commerce"
      title={order.number}
      welcome={`I'm your **commerce agent** for order **${order.number}**. Ask me about this order — it stays fully usable on the right.`}
      chips={[
        {
          id: "chip-help",
          label: "What can you help with?",
          prompt: "What can you help me do with this order?",
        },
      ]}
      surface="detail"
      entityId={orderId ?? null}
      workspace={workspace}
    />
  );
}
