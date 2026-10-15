import { X } from "lucide-react";
import { useEffect } from "react";

import { IconButton } from "@/components/ui/button";
import { ProfileDetailList, ProfileDetailRow } from "@/components/ui/profile-detail-row";
import { formatOrderDateTime } from "@/components/workspace/workspace-customer-order-dialog";
import type { CustomerTicket } from "@/features/workspace/types";

function ticketLabel(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function WorkspaceCustomerTicketDialog({
  ticket,
  onClose,
}: {
  ticket: CustomerTicket | null;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!ticket) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, ticket]);

  if (!ticket) return null;

  const csat =
    ticket.csatScore == null
      ? null
      : ticket.csatComment
        ? `${ticket.csatScore} · ${ticket.csatComment}`
        : String(ticket.csatScore);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
      <button
        type="button"
        className="absolute inset-0 bg-black/40"
        aria-label="Close ticket details"
        onClick={onClose}
      />
      <div className="relative z-10 flex max-h-[min(85vh,760px)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b-[0.6px] border-[#bfbfbf] px-6 py-5">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold text-neutral-900">{ticket.ticketNumber}</h2>
            <p className="mt-1 text-sm font-semibold break-words text-neutral-900">{ticket.subject}</p>
            <p className="mt-1 text-sm text-neutral-600">
              {formatOrderDateTime(ticket.createdAt)} · {ticketLabel(ticket.status)}
            </p>
          </div>
          <IconButton variant="ghostIcon" onClick={onClose} aria-label="Close">
            <X className="size-4" />
          </IconButton>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">
          <ProfileDetailList>
            <ProfileDetailRow label="Status">{ticketLabel(ticket.status)}</ProfileDetailRow>
            <ProfileDetailRow label="Priority">{ticketLabel(ticket.priority)}</ProfileDetailRow>
            <ProfileDetailRow label="Channel">{ticketLabel(ticket.channel)}</ProfileDetailRow>
            {ticket.interactionId ? (
              <ProfileDetailRow label="Interaction">{ticket.interactionId}</ProfileDetailRow>
            ) : null}
            {ticket.queueName ? <ProfileDetailRow label="Queue">{ticket.queueName}</ProfileDetailRow> : null}
            {ticket.assigneeName ? (
              <ProfileDetailRow label="Assignee">{ticket.assigneeName}</ProfileDetailRow>
            ) : null}
            {ticket.resolverName ? (
              <ProfileDetailRow label="Resolver">{ticket.resolverName}</ProfileDetailRow>
            ) : null}
            {ticket.category ? <ProfileDetailRow label="Category">{ticket.category}</ProfileDetailRow> : null}
            {ticket.orderId ? <ProfileDetailRow label="Order">{ticket.orderId}</ProfileDetailRow> : null}
            {ticket.productId ? <ProfileDetailRow label="Product">{ticket.productId}</ProfileDetailRow> : null}
            {ticket.dueAt ? (
              <ProfileDetailRow label="Due">{formatOrderDateTime(ticket.dueAt)}</ProfileDetailRow>
            ) : null}
            {ticket.resolvedAt ? (
              <ProfileDetailRow label="Resolved">{formatOrderDateTime(ticket.resolvedAt)}</ProfileDetailRow>
            ) : null}
            {csat ? <ProfileDetailRow label="CSAT">{csat}</ProfileDetailRow> : null}
          </ProfileDetailList>
          {ticket.description ? (
            <div>
              <p className="text-xs font-medium text-neutral-600">Description</p>
              <p className="mt-1 text-sm break-words text-neutral-900">{ticket.description}</p>
            </div>
          ) : null}
          {ticket.aiSummary ? (
            <div>
              <p className="text-xs font-medium text-neutral-600">Summary</p>
              <p className="mt-1 text-sm break-words text-neutral-900">{ticket.aiSummary}</p>
            </div>
          ) : null}
          {ticket.notes.length > 0 ? (
            <div
              className={`rounded-xl border-[0.6px] border-[#bfbfbf] bg-white px-3${
                ticket.notes.length > 4 ? " max-h-[252px] overflow-y-auto overscroll-contain" : ""
              }`}
            >
              {ticket.notes.map((note) => (
                <div
                  key={note.id}
                  className="border-b-[0.6px] border-[#e5e5e5] py-2.5 last:border-b-0"
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 text-sm font-semibold text-neutral-900">{note.authorName}</p>
                    <span className="shrink-0 text-xs text-neutral-500">
                      {formatOrderDateTime(note.createdAt)}
                    </span>
                  </div>
                  {note.visibility ? (
                    <p className="mt-0.5 text-[11px] text-neutral-500">{ticketLabel(note.visibility)}</p>
                  ) : null}
                  <p className="mt-1 text-sm break-words text-neutral-800">{note.body}</p>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
