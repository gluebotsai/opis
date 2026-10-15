import { createTicketingClient, TicketingApiError } from "@worktual/ticketing";
import type { TicketingClient } from "@worktual/ticketing";

export type WorktualSessionEndDetail = {
  feature: "auth.session_end";
  sessionId?: string;
};

export function widgetClient(el: HTMLElement): TicketingClient {
  return createTicketingClient({
    baseUrl: (el.getAttribute("endpoint") || "").trim(),
    accessToken: (el.getAttribute("token") || "").trim(),
    locale: (el.getAttribute("locale") || "en").trim() || "en",
    surface: "ui",
    component: el.tagName.toLowerCase(),
  });
}

/** Message and stable code from a failed partner call. */
export function failureDetail(error: unknown, fallback: string): { message: string; code?: string } {
  if (error instanceof TicketingApiError) {
    return { message: error.message || fallback, code: error.code };
  }
  if (error instanceof Error && error.message) return { message: error.message };
  return { message: fallback };
}

/** Revoke the partner session and tell the host. */
export async function endWidgetSession(el: HTMLElement): Promise<void> {
  const token = (el.getAttribute("token") || "").trim();
  if (!(el.getAttribute("endpoint") || "").trim() || !token) return;
  await widgetClient(el).auth.endSession(token);
  const detail: WorktualSessionEndDetail = {
    feature: "auth.session_end",
    sessionId: el.getAttribute("session-id") || undefined,
  };
  el.dispatchEvent(new CustomEvent("worktual-session-end", { bubbles: true, composed: true, detail }));
  el.dispatchEvent(new CustomEvent("worktual-action", { bubbles: true, composed: true, detail }));
}
