/**
 * SMS send adapter — stub by default; optional HTTP provider via settings.base_url.
 */

export type SmsSendInput = {
  to: string;
  body: string;
  dltTemplateId?: string;
  senderId: string;
  entityId?: string;
  provider: string;
  apiKey?: string;
  baseUrl?: string;
};

export type SmsSendResult = {
  sent: boolean;
  providerMessageId: string;
  stub: boolean;
};

export async function sendSmsMessage(
  input: SmsSendInput,
): Promise<SmsSendResult> {
  const provider = (input.provider || "stub").toLowerCase();
  const baseUrl = (input.baseUrl || "").trim();

  if (provider !== "stub" && baseUrl) {
    const res = await fetch(baseUrl.replace(/\/$/, "") + "/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(input.apiKey ? { Authorization: `Bearer ${input.apiKey}` } : {}),
      },
      body: JSON.stringify({
        to: input.to,
        body: input.body,
        sender_id: input.senderId,
        entity_id: input.entityId || null,
        dlt_template_id: input.dltTemplateId || null,
      }),
    });
    const text = await res.text();
    let json: { message_id?: string; providerMessageId?: string } = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = {};
    }
    if (!res.ok) {
      throw new Error(
        `SMS provider error (${res.status}): ${text.slice(0, 200)}`,
      );
    }
    return {
      sent: true,
      providerMessageId:
        json.providerMessageId ||
        json.message_id ||
        `sms_${Date.now()}`,
      stub: false,
    };
  }

  // Dev stub — always succeeds
  return {
    sent: true,
    providerMessageId: `stub_sms_${Date.now()}_${input.to.slice(-4)}`,
    stub: true,
  };
}
