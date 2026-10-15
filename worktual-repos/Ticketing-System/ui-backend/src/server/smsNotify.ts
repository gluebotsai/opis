/**
 * Outbound SMS for portal OTP. SMS_MODE=log (default) | twilio | off
 */
export async function sendCustomerSms(input: {
  toPhone: string;
  text: string;
}): Promise<{ sent: boolean; mode: string; error?: string }> {
  const to = String(input.toPhone || "").trim();
  if (!to) return { sent: false, mode: smsMode(), error: "no_valid_recipient" };

  const mode = smsMode();
  if (mode === "off") return { sent: false, mode };
  if (mode === "log") {
    console.info(`[sms:log] to=${to} text=${input.text.slice(0, 160)}`);
    return { sent: true, mode };
  }

  const sid = String(process.env.TWILIO_ACCOUNT_SID || "").trim();
  const token = String(process.env.TWILIO_AUTH_TOKEN || "").trim();
  const from = String(process.env.TWILIO_FROM || "").trim();
  if (!sid || !token || !from) {
    return { sent: false, mode, error: "twilio_not_configured" };
  }
  try {
    const auth = Buffer.from(`${sid}:${token}`).toString("base64");
    const body = new URLSearchParams({
      To: to,
      From: from,
      Body: input.text,
    });
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      }
    );
    if (!res.ok) {
      const errText = await res.text().catch(() => res.statusText);
      return { sent: false, mode, error: errText.slice(0, 200) };
    }
    return { sent: true, mode };
  } catch (err) {
    return { sent: false, mode, error: (err as Error).message };
  }
}

function smsMode(): "log" | "twilio" | "off" {
  const m = String(process.env.SMS_MODE || "").trim().toLowerCase();
  if (m === "off" || m === "twilio" || m === "log") return m;
  if (process.env.TWILIO_ACCOUNT_SID) return "twilio";
  return "log";
}
