import { api } from "./api";

export type SalesGuideAction = { title: string; detail: string; dueInDays: number };
export type SalesGuideCtaKind =
  | "email"
  | "call"
  | "meeting"
  | "sms"
  | "task"
  | "note"
  | "quote"
  | "proposal"
  | "deal"
  | "view_deal"
  | "order";
export type SalesGuideCta = {
  kind: SalesGuideCtaKind;
  subject: string;
  message: string;
  dueInDays: number;
  dealId: string | null;
};
export type SalesObjection = {
  kind: "price" | "timing" | "competitor" | "authority";
  customerLine: string;
  reply: string;
  proofPoint: string | null;
  question: string | null;
};

export type SalesGuideView = {
  suggestions: string[];
  nextBestAction: SalesGuideAction;
  action: SalesGuideCta;
  accepted?: {
    task: boolean;
    note: boolean;
  };
};

export async function fetchSalesGuide(contactId: string) {
  const { data } = await api.get(`/api/contacts/${contactId}/sales-guide`);
  return data as ({ ok: true } & SalesGuideView) | { ok: false; error: string };
}

export async function acceptSalesTask(contactId: string, action: SalesGuideAction) {
  const { data } = await api.post(`/api/contacts/${contactId}/sales-guide/task`, action);
  return data as { ok: true; id: string } | { ok: false; error: string };
}

export async function suggestSalesObjection(contactId: string, objection: string) {
  const { data } = await api.post(`/api/contacts/${contactId}/sales-guide/objection`, {
    objection,
  });
  return data as { ok: true; objection: SalesObjection } | { ok: false; error: string };
}
