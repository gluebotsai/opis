/**
 * Framework-agnostic Service MS read-through for Fastify Wave 12.
 * Tickets live in Service MS DB — never crm_qa.
 */

import { getCurrentOrganizationId } from "@/service/auth/require-role";
import {
  isServiceMsConfigured,
  listServiceTicketsFromMs,
} from "@/service/integrations/service-ms";

export type ServiceTicketRow = {
  id: string;
  subject: string;
  status: string;
  companyName?: string | null;
  dealId?: string | null;
  createdAt?: string;
};

export async function listServiceTicketsCommand(): Promise<{
  configured: boolean;
  items: ServiceTicketRow[];
  error?: string;
}> {
  if (!isServiceMsConfigured()) {
    return { configured: false, items: [] };
  }

  try {
    const organizationId = await getCurrentOrganizationId();
    const result = await listServiceTicketsFromMs(organizationId);
    return { configured: true, items: result.items };
  } catch (err) {
    return {
      configured: true,
      items: [],
      error: err instanceof Error ? err.message : "Failed to reach Service MS",
    };
  }
}
