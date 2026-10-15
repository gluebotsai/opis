import { useEffect, useState, type ReactNode } from "react";
import { fetchCustomer360 } from "@/services/customer360";
import type {
  Customer360Score,
  Customer360Spend,
  Customer360View,
  Customer360Web,
} from "@/services/customer360";

const INSIGHT_LABELS: Record<string, string> = {
  attrition_risk: "Attrition risk",
  conversion_likelihood: "Conversion likelihood",
  future_value: "Future value",
  product_affinity: "Product affinity",
  next_purchase_timing: "Next purchase timing",
};

function labelFor(type: string): string {
  return INSIGHT_LABELS[type] ?? type.replaceAll("_", " ");
}

function formatWhen(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function formatNumber(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  if (Number.isInteger(value)) return String(value);
  return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function formatMoney(amount: number | null, currency: string | null): string {
  if (amount == null) return "—";
  const code = currency?.trim();
  return code ? `${code} ${formatNumber(amount)}` : formatNumber(amount);
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-text-caption">{label}</dt>
      <dd className="mt-1 text-sm font-medium text-text-primary">{value}</dd>
    </div>
  );
}

function Block({
  title,
  when,
  children,
}: {
  title: string;
  when?: string | null;
  children: ReactNode;
}) {
  return (
    <div className="border-t border-border-default pt-4 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
        {when ? <p className="text-xs text-text-caption">{when}</p> : null}
      </div>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function ScoreBlock({ scores }: { scores: Customer360Score }) {
  return (
    <Block title="Scores" when={formatWhen(scores.updatedAt)}>
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Stat label="Churn" value={formatNumber(scores.churn)} />
        <Stat label="Loyalty" value={formatNumber(scores.loyalty)} />
        <Stat label="Value" value={formatNumber(scores.value)} />
        <Stat label="Purchase probability" value={formatNumber(scores.purchaseProbability)} />
        <Stat label="Retention" value={formatNumber(scores.retention)} />
        <Stat label="Advocacy" value={formatNumber(scores.advocacy)} />
        <Stat label="Web engagement" value={formatNumber(scores.webEngagement)} />
        <Stat label="Predicted lifetime value" value={formatNumber(scores.predictedLtv)} />
        <Stat label="Days to next purchase" value={formatNumber(scores.nextPurchaseDays)} />
      </dl>
    </Block>
  );
}

function WebBlock({ web }: { web: Customer360Web }) {
  return (
    <Block title="Web activity" when={web.metricDate}>
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Stat label="Sessions" value={formatNumber(web.sessions)} />
        <Stat label="Page views" value={formatNumber(web.pageViews)} />
        <Stat label="Avg session (sec)" value={formatNumber(web.avgSessionDuration)} />
        <Stat label="Bounce rate" value={formatNumber(web.bounceRate)} />
        <Stat label="Scroll depth" value={formatNumber(web.scrollDepth)} />
        <Stat label="Conversions" value={formatNumber(web.conversions)} />
        <Stat label="Days since last seen" value={formatNumber(web.daysSinceLastSeen)} />
      </dl>
    </Block>
  );
}

function SpendBlock({ spend }: { spend: Customer360Spend }) {
  return (
    <Block title="Spending" when={formatWhen(spend.updatedAt)}>
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Stat label="Journey stage" value={spend.journeyStage ?? "—"} />
        <Stat label="Orders" value={formatNumber(spend.totalOrders)} />
        <Stat label="Total spend" value={formatNumber(spend.totalSpend)} />
        <Stat label="Average order" value={formatNumber(spend.avgOrderValue)} />
        <Stat label="Last purchase" value={formatWhen(spend.lastPurchaseAt) ?? "—"} />
      </dl>
    </Block>
  );
}

function hasVisibleProfile(view: Customer360View): boolean {
  return Boolean(
    view.scores ||
      view.web ||
      view.spend ||
      view.orders.length ||
      view.tickets.length ||
      view.events.length ||
      view.insights.length ||
      view.recommendations.length ||
      view.nextBestAction ||
      view.segments.length ||
      (view.campaigns ?? []).length,
  );
}

function Body({ view }: { view: Customer360View }) {
  return (
    <div className="mt-4 space-y-4">
      {view.scores ? <ScoreBlock scores={view.scores} /> : null}
      {view.web ? <WebBlock web={view.web} /> : null}
      {view.spend ? <SpendBlock spend={view.spend} /> : null}
      {view.orders.length ? (
        <Block title="CDP orders" when={formatWhen(view.orders[0]?.createdAt)}>
          <ul className="divide-y divide-border-default">
            {view.orders.map((order) => (
              <li key={order.orderId} className="py-2 text-sm">
                <p className="font-medium text-text-primary">
                  {order.number ?? order.orderId}
                  {order.status ? ` · ${order.status}` : ""}
                </p>
                <p className="text-text-secondary">
                  {formatMoney(order.amount, order.currency)}
                  {order.paymentStatus ? ` · ${order.paymentStatus}` : ""}
                  {order.fulfillmentStatus ? ` · ${order.fulfillmentStatus}` : ""}
                </p>
                {order.items.length ? (
                  <p className="text-text-caption">
                    {order.items
                      .map((item) => {
                        const name = item.productId ?? "Item";
                        const qty = item.quantity != null ? ` × ${item.quantity}` : "";
                        return `${name}${qty}`;
                      })
                      .join(", ")}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </Block>
      ) : null}
      {view.tickets.length ? (
        <Block title="Tickets" when={formatWhen(view.tickets[0]?.occurredAt)}>
          <ul className="divide-y divide-border-default">
            {view.tickets.map((ticket) => (
              <li key={ticket.ticketId} className="py-2 text-sm">
                <p className="font-medium text-text-primary">
                  {ticket.ticketNumber ?? ticket.ticketId}
                  {ticket.subject ? ` · ${ticket.subject}` : ""}
                </p>
                <p className="text-text-secondary">
                  {[ticket.channel, ticket.category, ticket.priority, ticket.assignee]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                {ticket.summary ? (
                  <p className="mt-1 text-text-secondary">{ticket.summary}</p>
                ) : null}
                <p className="text-xs text-text-caption">
                  {[
                    ticket.csat != null ? `CSAT ${ticket.csat}` : null,
                    ticket.resolvedAt ? `Resolved ${formatWhen(ticket.resolvedAt)}` : null,
                    ticket.dueAt ? `Due ${formatWhen(ticket.dueAt)}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </li>
            ))}
          </ul>
        </Block>
      ) : null}
      {view.events.length ? (
        <Block title="Recent events" when={formatWhen(view.events[0]?.occurredAt)}>
          <ul className="divide-y divide-border-default">
            {view.events.map((event, index) => (
              <li key={`${event.name}-${event.occurredAt}-${index}`} className="py-2 text-sm">
                <p className="text-text-primary">
                  {event.name}
                  {event.channel ? ` · ${event.channel}` : ""}
                </p>
                <p className="text-text-caption">
                  {[event.page, event.amount != null ? formatNumber(event.amount) : null, formatWhen(event.occurredAt)]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </li>
            ))}
          </ul>
        </Block>
      ) : null}
      {view.insights.length || view.recommendations.length || view.nextBestAction ? (
        <Block
          title="Predictions"
          when={formatWhen(
            view.insights[0]?.generatedAt ?? view.nextBestActionAt ?? view.recommendations[0]?.generatedAt,
          )}
        >
          {view.nextBestAction ? (
            <p className="text-sm text-text-primary">Next best action: {view.nextBestAction}</p>
          ) : null}
          <ul className="mt-2 space-y-2">
            {view.insights.map((insight) => (
              <li key={insight.type} className="text-sm">
                <p className="font-medium text-text-primary">
                  {labelFor(insight.type)}
                  {insight.score != null ? ` · ${formatNumber(insight.score)}` : ""}
                </p>
                {insight.summary ? (
                  <p className="text-text-secondary">{insight.summary}</p>
                ) : null}
                {insight.explanation ? (
                  <p className="text-text-caption">{insight.explanation}</p>
                ) : null}
              </li>
            ))}
            {view.recommendations.map((item) => (
              <li key={`rec-${item.type}`} className="text-sm text-text-secondary">
                {labelFor(item.type)}
                {item.confidence != null ? ` · ${formatNumber(item.confidence)}` : ""}
                {item.text ? `: ${item.text}` : ""}
              </li>
            ))}
          </ul>
        </Block>
      ) : null}
      {(view.campaigns ?? []).length ? (
        <Block title="Campaigns" when={formatWhen(view.campaigns[0]?.sentAt)}>
          <ul className="divide-y divide-border-default">
            {(view.campaigns ?? []).map((campaign, index) => (
              <li key={`${campaign.runId}-${campaign.channel}-${index}`} className="py-2 text-sm">
                <p className="font-medium text-text-primary">{campaign.title}</p>
                <p className="text-text-secondary">
                  {[campaign.channel, campaign.status, formatWhen(campaign.sentAt)]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </li>
            ))}
          </ul>
        </Block>
      ) : null}
      {view.segments.length ? (
        <Block title="Segments" when={formatWhen(view.segments[0]?.assignedAt)}>
          <p className="text-sm text-text-primary">
            {view.segments.map((segment) => segment.name).join(", ")}
          </p>
        </Block>
      ) : null}
    </div>
  );
}

const customer360Cache = new Map<string, Customer360View>();

export function Customer360Panel({ contactId }: { contactId: string }) {
  const [view, setView] = useState<Customer360View | null>(
    () => customer360Cache.get(contactId) ?? null,
  );
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const cached = customer360Cache.get(contactId);
    if (cached) {
      setView(cached);
      setFailed(false);
    }
    void fetchCustomer360(contactId)
      .then((result) => {
        if (cancelled) return;
        if (result.ok) {
          customer360Cache.set(contactId, result.customer360);
          setView(result.customer360);
          setFailed(false);
        } else if (!customer360Cache.has(contactId)) setFailed(true);
      })
      .catch(() => {
        if (!cancelled && !customer360Cache.has(contactId)) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [contactId]);

  return (
    <section className="rounded-xl border border-border-default bg-surface p-6 lg:col-span-2">
      <h2 className="text-base font-semibold text-text-primary">Customer 360</h2>
      <p className="mt-1 text-xs text-text-caption">From the customer profile</p>
      {view ? (
        hasVisibleProfile(view) ? (
          <Body view={view} />
        ) : (
          <p className="mt-4 text-sm text-text-caption">
            No extra customer profile details yet.
          </p>
        )
      ) : failed ? (
        <p className="mt-4 text-sm text-text-caption">Customer 360 is unavailable right now.</p>
      ) : (
        <p className="mt-4 text-sm text-text-caption">Loading customer profile…</p>
      )}
    </section>
  );
}
