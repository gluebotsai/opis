import { useState, type ReactNode } from "react";

import { CustomerNotesBlock } from "@/components/workspace/workspace-notes-tab";
import { WorkspaceCustomerOrderDialog } from "@/components/workspace/workspace-customer-order-dialog";
import { WorkspaceCustomerTicketDialog } from "@/components/workspace/workspace-customer-ticket-dialog";
import { OrdersList, TicketsList } from "@/components/workspace/workspace-customer-records";
import { ProfileSection } from "@/components/ui/profile-detail-row";
import { useCustomerOrders } from "@/features/workspace/use-customer-orders";
import { useCustomerTickets } from "@/features/workspace/use-customer-tickets";
import { useWorkspaceNotes } from "@/features/workspace/use-workspace-notes";
import type { CustomerOrder, CustomerTicket } from "@/features/workspace/types";

const PREVIEW_COUNT = 4;

function previewItems<T>(items: T[], expanded: boolean): T[] {
  return expanded ? items : items.slice(0, PREVIEW_COUNT);
}

function PreviewList({
  count,
  children,
}: {
  count: number;
  children: (expanded: boolean) => ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <>
      {children(expanded)}
      {count > PREVIEW_COUNT ? (
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          className="mt-2 text-sm font-semibold text-neutral-900"
        >
          {expanded ? "Show less" : "View more"}
        </button>
      ) : null}
    </>
  );
}

export function ContactProfileRecords({ contactId }: { contactId: string }) {
  const { orders } = useCustomerOrders(contactId);
  const { tickets } = useCustomerTickets(contactId);
  const { customerNotes, loadingCustomer, loadError } = useWorkspaceNotes({
    conversationId: contactId,
    visitorId: contactId,
    contactId,
    includeCommon: false,
  });
  const [selectedOrder, setSelectedOrder] = useState<CustomerOrder | null>(null);
  const [selectedTicket, setSelectedTicket] = useState<CustomerTicket | null>(null);

  const showNotes = customerNotes.length > 0 || Boolean(loadError && !loadingCustomer);
  const showOrders = orders.length > 0;
  const showTickets = tickets.length > 0;

  return (
    <>
      {showNotes ? (
        <ProfileSection title="Notes" description="Notes saved on this customer's conversations">
          {loadError && customerNotes.length === 0 ? (
            <p className="py-6 text-center text-sm text-red-600">{loadError}</p>
          ) : (
            <PreviewList count={customerNotes.length}>
              {(expanded) => (
                <CustomerNotesBlock
                  notes={previewItems(customerNotes, expanded)}
                  scroll={expanded ? "preview" : "flow"}
                />
              )}
            </PreviewList>
          )}
        </ProfileSection>
      ) : null}

      {showOrders ? (
        <ProfileSection title="Orders" description="Orders linked to this contact">
          <PreviewList count={orders.length}>
            {(expanded) => (
              <OrdersList
                orders={previewItems(orders, expanded)}
                onSelect={setSelectedOrder}
                scroll={expanded ? "preview" : "flow"}
              />
            )}
          </PreviewList>
        </ProfileSection>
      ) : null}

      {showTickets ? (
        <ProfileSection title="Tickets" description="Tickets linked to this contact">
          <PreviewList count={tickets.length}>
            {(expanded) => (
              <TicketsList
                tickets={previewItems(tickets, expanded)}
                onSelect={setSelectedTicket}
                scroll={expanded ? "preview" : "flow"}
              />
            )}
          </PreviewList>
        </ProfileSection>
      ) : null}

      <WorkspaceCustomerOrderDialog order={selectedOrder} onClose={() => setSelectedOrder(null)} />
      <WorkspaceCustomerTicketDialog ticket={selectedTicket} onClose={() => setSelectedTicket(null)} />
    </>
  );
}
