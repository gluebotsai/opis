/**
 * E2E: webchat bot → live agent handoff through local gateway.
 */
import WebSocket from "ws";

const WEBCHAT_ID = process.env.WEBCHAT_ID ?? "wc_2108939a845e413b9ba84d6c400ec3fa";
const VISITOR_ID = `v_handoff_${Date.now()}`;
const WS_URL =
  process.env.WEBCHAT_WS_URL ??
  `ws://127.0.0.1:8080/ws/webchat?webchatId=${WEBCHAT_ID}&visitorId=${VISITOR_ID}`;

async function main() {
  const ws = new WebSocket(WS_URL);
  const frames: Array<Record<string, unknown>> = [];
  let botReplies = 0;

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error(`Timed out. Frames: ${frames.length}`));
    }, 60000);

    ws.on("open", () => {
      ws.send(
        JSON.stringify({
          type: "session.start",
          webchatId: WEBCHAT_ID,
          visitorId: VISITOR_ID,
          organizationId: "1000",
        }),
      );
    });

    ws.on("message", (data) => {
      const frame = JSON.parse(String(data)) as Record<string, unknown>;
      frames.push(frame);
      console.log("IN", JSON.stringify(frame).slice(0, 240));

      if (frame.type === "session.ready" && !frames.some((f) => f.type === "message" && f.from === "user")) {
        ws.send(
          JSON.stringify({
            type: "message",
            webchatId: WEBCHAT_ID,
            visitorId: VISITOR_ID,
            text: "hi",
          }),
        );
      }

      if (frame.type === "message" && frame.from === "bot") {
        botReplies += 1;
        if (botReplies === 1) {
          ws.send(
            JSON.stringify({
              type: "message",
              webchatId: WEBCHAT_ID,
              visitorId: VISITOR_ID,
              text: "connect me to live agent",
            }),
          );
        } else if (botReplies >= 2) {
          clearTimeout(timeout);
          ws.close();
          resolve();
        }
      }
    });

    ws.on("error", reject);
  });

  const handoffReply = frames.find(
    (f) =>
      f.type === "message" &&
      f.from === "bot" &&
      typeof f.text === "string" &&
      (f.text.includes("connect") ||
        f.text.includes("hold") ||
        f.text.includes("agent") ||
        f.text.includes("queue")),
  );

  const configError = frames.find(
    (f) =>
      f.type === "message" &&
      typeof f.text === "string" &&
      f.text.includes("live agent routing isn't configured"),
  );

  if (configError) {
    throw new Error(`Routing still not configured: ${configError.text}`);
  }
  if (!handoffReply) {
    throw new Error(`No handoff-style bot reply. Frames: ${frames.length}`);
  }

  console.log("PASS webchat handoff", { reply: handoffReply.text });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
