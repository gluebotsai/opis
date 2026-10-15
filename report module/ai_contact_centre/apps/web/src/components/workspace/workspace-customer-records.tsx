import { Check, ChevronRight, Clock } from "lucide-react";

import {
  formatOrderDateTime,
  formatOrderMoney,
} from "@/components/workspace/workspace-customer-order-dialog";
import type { CustomerOrder, CustomerTicket } from "@/features/workspace/types";
import { cn } from "@/lib/utils";

function ticketStatusTone(value: string): "done" | "pending" | "neutral" {
  const status = value.trim().toLowerCase();
  if (["resolved", "closed", "solved", "done", "complete", "completed"].includes(status)) return "done";
  if (
    ["open", "new", "reopened", "in progress", "in_progress", "pending", "waiting", "on hold", "on_hold"].includes(
      status,
    )
  ) {
    return "pending";
  }
  return "neutral";
}

function compareTicketsByRecency(left: CustomerTicket, right: CustomerTicket): number {
  const byDate = right.createdAt.localeCompare(left.createdAt);
  if (byDate !== 0) return byDate;
  return right.ticketNumber.localeCompare(left.ticketNumber, undefined, { numeric: true });
}

function orderStatusLabel(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function orderStatusTone(value: string): "done" | "pending" | "neutral" {
  const status = value.trim().toLowerCase();
  if (["fulfilled", "completed", "complete", "delivered", "shipped"].includes(status)) return "done";
  if (["pending", "unfulfilled", "processing", "open"].includes(status)) return "pending";
  return "neutral";
}

function recordListClassName(scroll: "panel" | "preview" | "flow"): string {
  if (scroll === "preview") {
    return "flex max-h-80 min-h-0 flex-col gap-2 overflow-y-auto overscroll-contain px-2 py-2 [&>ul]:flex-none";
  }
  if (scroll === "flow") {
    return "flex flex-col gap-2 overflow-visible px-2 py-2 [&>ul]:flex-none";
  }
  return "flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain px-2 py-2";
}

function StatusPill({ tone, label }: { tone: "done" | "pending" | "neutral"; label: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1 rounded-full px-2 text-[11px] font-medium",
        tone === "done" && "bg-emerald-50 text-emerald-700",
        tone === "pending" && "bg-orange-50 text-orange-600",
        tone === "neutral" && "bg-neutral-100 text-neutral-700",
      )}
    >
      {tone === "done" ? (
        <Check className="size-3" strokeWidth={2.25} aria-hidden="true" />
      ) : tone === "pending" ? (
        <Clock className="size-3" strokeWidth={2.25} aria-hidden="true" />
      ) : null}
      {label}
    </span>
  );
}

export function OrdersList({
  orders,
  onSelect,
  scroll = "panel",
}: {
  orders: CustomerOrder[];
  onSelect: (order: CustomerOrder) => void;
  /** `panel` fills the workspace section. `preview` scrolls inside the profile card. `flow` leaves scrolling to the page. */
  scroll?: "panel" | "preview" | "flow";
}) {
  return (
    <div className={recordListClassName(scroll)}>
      <ul className="min-h-0 flex-1 space-y-2">
        {orders.map((order) => (
          <li key={order.id}>
            <button
              type="button"
              onClick={() => onSelect(order)}
              className="flex w-full items-center gap-2 rounded-xl border-[0.6px] border-[#bfbfbf] bg-white px-3 py-2.5 text-left transition-colors hover:bg-neutral-50"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-neutral-900">{order.orderNumber}</p>
                <p className="mt-0.5 truncate text-xs text-neutral-500">{formatOrderDateTime(order.createdAt)}</p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <span className="text-sm font-semibold text-neutral-900">
                  {formatOrderMoney(order.totalAmount, order.currency)}
                </span>
                <StatusPill tone={orderStatusTone(order.status)} label={orderStatusLabel(order.status)} />
              </div>
              <ChevronRight className="size-[18px] shrink-0 text-neutral-400" strokeWidth={2.25} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function TicketsList({
  tickets,
  onSelect,
  scroll = "panel",
}: {
  tickets: CustomerTicket[];
  onSelect: (ticket: CustomerTicket) => void;
  scroll?: "panel" | "preview" | "flow";
}) {
  return (
    <div className={recordListClassName(scroll)}>
      <ul className="min-h-0 flex-1 space-y-2">
        {[...tickets].sort(compareTicketsByRecency).map((ticket) => (
          <li key={ticket.id}>
            <button
              type="button"
              onClick={() => onSelect(ticket)}
              className="grid w-full grid-cols-[minmax(0,1fr)_4.5rem_7rem_1.125rem] items-center gap-x-3 rounded-xl border-[0.6px] border-[#bfbfbf] bg-white px-3 py-2.5 text-left transition-colors hover:bg-neutral-50"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-neutral-900">{ticket.ticketNumber}</p>
                <p className="mt-0.5 truncate text-xs text-neutral-500">
                  {formatOrderDateTime(ticket.createdAt)}
                </p>
              </div>
              <p className="truncate text-xs font-semibold text-neutral-900">
                {orderStatusLabel(ticket.priority)}
              </p>
              <span className="justify-self-start">
                <StatusPill tone={ticketStatusTone(ticket.status)} label={orderStatusLabel(ticket.status)} />
              </span>
              <ChevronRight className="size-[18px] shrink-0 text-neutral-400" strokeWidth={2.25} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
