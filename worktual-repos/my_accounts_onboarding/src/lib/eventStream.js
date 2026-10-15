import { getAuthToken } from "./auth.js";
import { getCustomerToken } from "./customerAuth.js";

const DEFAULT_CHANNELS = ["quotations", "payments", "tickets", "mail"];

function resolveAuthToken() {
  return getAuthToken() || getCustomerToken();
}

export function subscribeToAppEvents({
  channels = DEFAULT_CHANNELS,
  mailboxProfile = null,
  onEvent,
  onError,
} = {}) {
  const token = resolveAuthToken();
  if (!token) {
    return () => {};
  }

  const params = new URLSearchParams({
    access_token: token,
    channels: channels.join(","),
  });

  if (mailboxProfile) {
    params.set("mailboxProfile", mailboxProfile);
  }

  const source = new EventSource(`/api/events/stream?${params.toString()}`);

  const handlePayload = (event) => {
    try {
      const data = JSON.parse(event.data);
      onEvent?.(data, event.type);
    } catch {
      // Ignore malformed SSE payloads.
    }
  };

  source.addEventListener("connected", handlePayload);
  source.addEventListener("heartbeat", () => {});

  const eventNames = [
    "quotation.submitted",
    "quotation.approved",
    "quotation.rejected",
    "payment.paid",
    "mail.updated",
    "ticket.created",
    "ticket.message.created",
    "ticket.status.changed",
    "message",
  ];

  for (const eventName of eventNames) {
    source.addEventListener(eventName, handlePayload);
  }

  source.onerror = (error) => {
    onError?.(error);
  };

  return () => {
    source.close();
  };
}
