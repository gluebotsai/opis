/**
 * E2E: agent Ready + no accept → offer timeout → visitor gets busy WS + agent marked away.
 *
 *   OFFER_TIMEOUT_SECONDS=5 npx tsx apps/chat-service/scripts/e2e-offer-timeout-webchat.ts
 */
import "@ai-contact-center/config/load-root-env";
import WebSocket from "ws";
import { ccPrisma } from "@ai-contact-center/db-cc";

const WEBCHAT_ID =
  process.env.WEBCHAT_ID ?? "wc_f7b08f360dbd410aa77007a9fd209244";
const VISITOR_ID = process.env.VISITOR_ID ?? `v_timeout_${Date.now()}`;
const WS_BASE = process.env.WEBCHAT_WS_BASE ?? "ws://127.0.0.1:3002";
const ORGANIZATION_ID = process.env.ORGANIZATION_ID ?? "1000";
const AGENT_ID = process.env.AGENT_ID ?? "1003";
const BUSY_SNIPPET = "All our live agents are currently busy";

type Frame = Record<string, unknown>;

function textOf(frame: Frame): string {
  return typeof frame.text === "string" ? frame.text : "";
}

async function setAgentReady(): Promise<void> {
  await ccPrisma.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;
  await ccPrisma.$executeRaw`SELECT set_config('app.organization_id', ${ORGANIZATION_ID}, true)`;
  await ccPrisma.$executeRaw`
    INSERT INTO ccass.agent_presence (
      organization_id, agent_id, status, presence_state, reason_code, source,
      heartbeat_at, lease_expires_at, updated_at
    ) VALUES (
      ${ORGANIZATION_ID}::bigint,
      ${AGENT_ID}::bigint,
      'ready',
      'ready',
      NULL,
      'e2e',
      NOW(),
      NOW() + INTERVAL '90 seconds',
      NOW()
    )
    ON CONFLICT (agent_id) DO UPDATE SET
      status = 'ready',
      presence_state = 'ready',
      reason_code = NULL,
      source = 'e2e',
      heartbeat_at = NOW(),
      lease_expires_at = NOW() + INTERVAL '90 seconds',
      updated_at = NOW()
  `;
}

async function forceOfferExpiry(conversationId: string): Promise<void> {
  await ccPrisma.$executeRaw`
    UPDATE ccass.conversation_assignments
    SET expires_at = NOW() - INTERVAL '1 second'
    WHERE organization_id = ${ORGANIZATION_ID}::bigint
      AND conversation_id = ${conversationId}::bigint
      AND state = 'offered'
  `;
}

async function readAgentPresence(): Promise<{ state: string; reason: string | null }> {
  const rows = await ccPrisma.$queryRaw<Array<{ presence_state: string; reason_code: string | null }>>`
    SELECT presence_state, reason_code
    FROM ccass.agent_presence
    WHERE agent_id = ${AGENT_ID}::bigint
    LIMIT 1
  `;
  return { state: rows[0]?.presence_state ?? "missing", reason: rows[0]?.reason_code ?? null };
}

async function waitForOffer(conversationId: string, timeoutMs = 90_000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const rows = await ccPrisma.$queryRaw<Array<{ state: string }>>`
      SELECT state FROM ccass.conversation_assignments
      WHERE organization_id = ${ORGANIZATION_ID}::bigint
        AND conversation_id = ${conversationId}::bigint
      ORDER BY offered_at DESC NULLS LAST
      LIMIT 1
    `;
    if (rows[0]?.state === "offered") return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Offer not created for conversation ${conversationId}`);
}

async function main() {
  await setAgentReady();

  const wsUrl = `${WS_BASE}/ws/webchat?webchatId=${encodeURIComponent(WEBCHAT_ID)}&visitorId=${encodeURIComponent(VISITOR_ID)}`;
  console.log("offer-timeout-e2e start", { webchatId: WEBCHAT_ID, visitorId: VISITOR_ID });

  const ws = new WebSocket(wsUrl);
  const frames: Frame[] = [];
  let conversationId = "";
  let userTurns = 0;

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error(`Timed out; frames=${frames.map((f) => String(f.type)).join(",")}`));
    }, 120_000);

    ws.on("open", () => {
      ws.send(
        JSON.stringify({
          type: "session.start",
          webchatId: WEBCHAT_ID,
          visitorId: VISITOR_ID,
          pageUrl: "http://offer-timeout-e2e",
          consent: { accepted: true },
        }),
      );
    });

    ws.on("message", (data) => {
      const frame = JSON.parse(String(data)) as Frame;
      frames.push(frame);
      console.log("IN", JSON.stringify(frame).slice(0, 240));
      if (frame.type === "session.ready" && typeof frame.conversationId === "string") {
        conversationId = frame.conversationId;
        ws.send(
          JSON.stringify({
            type: "message",
            webchatId: WEBCHAT_ID,
            visitorId: VISITOR_ID,
            text: "hello",
          }),
        );
        userTurns += 1;
      }

      if (frame.type === "message" && frame.from === "bot" && userTurns === 1) {
        ws.send(
          JSON.stringify({
            type: "message",
            webchatId: WEBCHAT_ID,
            visitorId: VISITOR_ID,
            text: "connect me to a live agent please",
          }),
        );
        userTurns += 1;
      }
    });

    ws.on("error", reject);

    const poll = setInterval(async () => {
      if (!conversationId) return;
      try {
        const busyFrame = frames.find(
          (frame) =>
            frame.type === "message" &&
            textOf(frame).includes(BUSY_SNIPPET),
        );
        if (busyFrame) {
          clearInterval(poll);
          clearTimeout(timeout);
          resolve();
        }
      } catch (error) {
        clearInterval(poll);
        clearTimeout(timeout);
        reject(error);
      }
    }, 500);

    void (async () => {
      while (!conversationId) {
        await new Promise((r) => setTimeout(r, 200));
      }
      try {
        await waitForOffer(conversationId);
        console.log("offer created, forcing expiry", { conversationId });
        await forceOfferExpiry(conversationId);
      } catch (error) {
        console.warn("offer wait/force failed; waiting for natural timeout", error);
      }
    })();
  });

  ws.close();

  const busyFrame = frames.find(
    (frame) => frame.type === "message" && textOf(frame).includes(BUSY_SNIPPET),
  );
  if (!busyFrame) {
    throw new Error(`Busy message not received on WS. Got ${frames.length} frames.`);
  }

  // Allow sweeper/timer to finish side effects.
  await new Promise((resolve) => setTimeout(resolve, 6_000));

  const presence = await readAgentPresence();
  if (presence.state !== "away" || presence.reason !== "offer_timeout") {
    throw new Error(`Expected agent away/offer_timeout, got ${JSON.stringify(presence)}`);
  }

  console.log("offer-timeout-e2e PASS", {
    conversationId,
    busyPreview: textOf(busyFrame).slice(0, 80),
    presence,
  });
}

main()
  .catch((error) => {
    console.error("offer-timeout-e2e FAIL", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await ccPrisma.$disconnect();
  });
