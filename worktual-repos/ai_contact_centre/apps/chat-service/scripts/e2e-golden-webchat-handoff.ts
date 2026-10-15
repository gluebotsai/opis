/**
 * Live E2E for golden webchat routing:
 * session.start → bot → "connect me with live agent" → queue assigned without widget routingQueueId.
 *
 *   npx tsx apps/chat-service/scripts/e2e-golden-webchat-handoff.ts
 */
import "@ai-contact-center/config/load-root-env";
import WebSocket from "ws";

const WEBCHAT_ID =
  process.env.WEBCHAT_ID ?? "wc_f7b08f360dbd410aa77007a9fd209244";
const VISITOR_ID = process.env.VISITOR_ID ?? `v_golden_${Date.now()}`;
const WS_BASE = process.env.WEBCHAT_WS_BASE ?? "ws://127.0.0.1:3002";
const CC_CORE_URL = process.env.CC_CORE_URL ?? "http://localhost:3000";
const ORGANIZATION_ID = process.env.ORGANIZATION_ID ?? "1000";
const INTERNAL_SERVICE_KEY = process.env.INTERNAL_SERVICE_KEY ?? "";

type Frame = Record<string, unknown>;

function textOf(frame: Frame): string {
  return typeof frame.text === "string" ? frame.text : "";
}

async function getConversation(conversationId: string) {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "x-tenant-id": ORGANIZATION_ID,
  };
  if (INTERNAL_SERVICE_KEY) headers["x-internal-service-key"] = INTERNAL_SERVICE_KEY;
  const response = await fetch(`${CC_CORE_URL}/internal/v1/conversations/${conversationId}`, {
    headers,
  });
  if (!response.ok) {
    throw new Error(`cc-core conversation ${conversationId} → ${response.status} ${await response.text()}`);
  }
  return (await response.json()) as {
    conversation: {
      id: string;
      status: string;
      botActive: boolean;
      queueId?: string | null;
      handoffReason?: string | null;
    };
    messages: Array<{ senderType: string; body: string }>;
  };
}

async function main() {
  const wsUrl = `${WS_BASE}/ws/webchat?webchatId=${encodeURIComponent(WEBCHAT_ID)}&visitorId=${encodeURIComponent(VISITOR_ID)}`;
  console.log("golden-e2e start", { webchatId: WEBCHAT_ID, visitorId: VISITOR_ID, wsUrl });

  const ws = new WebSocket(wsUrl);
  const frames: Frame[] = [];
  let conversationId = "";
  let userTurns = 0;

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error(`Timed out after ${frames.length} frames: ${frames.map((f) => f.type).join(",")}`));
    }, 90_000);

    ws.on("open", () => {
      ws.send(
        JSON.stringify({
          type: "session.start",
          webchatId: WEBCHAT_ID,
          visitorId: VISITOR_ID,
          pageUrl: "http://golden-e2e",
          consent: { accepted: true },
        }),
      );
    });

    ws.on("message", (data) => {
      const frame = JSON.parse(String(data)) as Frame;
      frames.push(frame);
      console.log("IN", JSON.stringify(frame).slice(0, 280));

      if (frame.type === "session.ready") {
        conversationId = String(frame.conversationId ?? "");
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
            text: "connect me with live agent",
          }),
        );
        userTurns += 1;
      }

      if (
        userTurns >= 2 &&
        (frame.type === "message" || frame.type === "system") &&
        (frame.from === "bot" || frame.from === "system" || frame.type === "system")
      ) {
        const text = textOf(frame).toLowerCase();
        if (
          text.includes("agent") ||
          text.includes("hold") ||
          text.includes("connect") ||
          text.includes("busy") ||
          text.includes("configured") ||
          text.includes("queue") ||
          text.includes("sorry")
        ) {
          clearTimeout(timeout);
          ws.close();
          resolve();
        }
      }
    });

    ws.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });

  const allText = frames.map((frame) => textOf(frame)).join("\n");
  if (/live agent routing isn't configured/i.test(allText)) {
    throw new Error("FAIL: widget still requires routing queue id");
  }
  if (!conversationId) {
    throw new Error("FAIL: no conversationId from session.ready");
  }

  const snapshot = await getConversation(conversationId);
  const queueId = snapshot.conversation.queueId ?? null;
  console.log(
    JSON.stringify(
      {
        pass: Boolean(queueId),
        conversationId,
        status: snapshot.conversation.status,
        botActive: snapshot.conversation.botActive,
        queueId,
        handoffReason: snapshot.conversation.handoffReason ?? null,
        lastMessages: snapshot.messages.slice(-4).map((message) => ({
          from: message.senderType,
          body: message.body.slice(0, 160),
        })),
      },
      null,
      2,
    ),
  );

  if (!queueId) {
    throw new Error("FAIL: conversation has no queueId after live-agent request");
  }
  console.log("PASS golden webchat handoff assigned a queue without widget routingQueueId");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
