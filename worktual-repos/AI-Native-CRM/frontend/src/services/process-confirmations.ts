import { api } from "./api";

export type ProcessConfirmationItem = {
  id: string;
  contactId: string;
  dealId: string | null;
  activityId: string | null;
  actionKind: string;
  title: string;
  summary: string | null;
  payload: Record<string, unknown> | null;
  status: string;
  createdAt: string;
  decidedAt: string | null;
  resultNote: string | null;
};

export async function fetchProcessConfirmations(status = "pending") {
  const { data } = await api.get<{ ok: true; items: ProcessConfirmationItem[] }>(
    "/api/process-confirmations",
    { params: { status } },
  );
  return data.items ?? [];
}

export async function decideProcessConfirmationRequest(
  id: string,
  body: {
    decision: "approved" | "rejected";
    selectedSlotIso?: string | null;
    note?: string | null;
  },
) {
  const { data } = await api.post<
    { ok: true } | { ok: false; error: string }
  >(`/api/process-confirmations/${id}/decide`, body);
  return data;
}
