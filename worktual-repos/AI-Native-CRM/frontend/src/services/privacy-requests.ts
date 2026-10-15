import { api } from "./api";

/** Compliance & Privacy Control — admin HITL queue (deep-link from email / bell). */
export type PrivacyRequest = {
  id: string;
  contactId: string;
  activityId: string;
  contactName: string | null;
  requestType: "data_deletion" | "data_access" | string;
  confidence: "high" | "medium" | "low" | string;
  status: "pending_review" | "executed" | "dismissed" | string;
  reason: string | null;
  draftConfirmation: string | null;
  createdAt: string;
  reviewedAt: string | null;
  executedAt: string | null;
};

export async function fetchPrivacyRequests() {
  const { data } = await api.get<
    { ok: true; items: PrivacyRequest[] } | { ok: false; error: string }
  >("/api/privacy-requests");
  return data;
}

export async function executePrivacyRequest(id: string) {
  const { data } = await api.post<
    { ok: true; id: string } | { ok: false; error: string }
  >(`/api/privacy-requests/${id}/execute`);
  return data;
}

export async function dismissPrivacyRequest(id: string) {
  const { data } = await api.post<
    { ok: true; id: string } | { ok: false; error: string }
  >(`/api/privacy-requests/${id}/dismiss`);
  return data;
}
