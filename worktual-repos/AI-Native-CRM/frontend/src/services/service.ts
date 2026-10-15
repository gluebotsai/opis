import { api } from "./api";

export type ServiceTicketRow = {
  id: string;
  subject: string;
  status: string;
  companyName?: string | null;
  dealId?: string | null;
  createdAt?: string;
};

export async function fetchServiceTickets() {
  const { data } = await api.get<{
    ok: true;
    configured: boolean;
    items: ServiceTicketRow[];
    error?: string;
  }>("/api/service/tickets");
  return data;
}
