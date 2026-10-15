/**
 * Direct WS repro against local chat-service for debug logs.
 */
import { randomUUID } from "node:crypto";
import WebSocket from "ws";

const WEBCHAT_ID = "wc_5d80cd9b1ace4080bc70717552472611";
const VISITOR_ID = `v_debug_${Date.now()}`;

async function main() {
  const url = `ws://localhost:3002/ws/webchat?webchatId=${WEBCHAT_ID}&visitorId=${VISITOR_ID}`;
  const ws = new WebSocket(url);
  const frames: unknown[] = [];

  await new Promise<void>((resolve, reject) => {
    ws.on("open", () => {
      ws.send(
        JSON.stringify({
          type: "session.start",
          webchatId: WEBCHAT_ID,
          visitorId: VISITOR_ID,
          pageUrl: "http://debug-local",
          consent: { accepted: true },
        }),
      );
    });
    ws.on("message", (data) => {
      const frame = JSON.parse(String(data));
      frames.push(frame);
      console.log("IN", JSON.stringify(frame).slice(0, 200));
      if (frame.type === "session.ready") {
        ws.send(
          JSON.stringify({
            type: "message",
            webchatId: WEBCHAT_ID,
            visitorId: VISITOR_ID,
            text: "What are your business hours?",
          }),
        );
      }
      if (frame.type === "message" && frame.from === "bot" && frames.filter((f: any) => f.type === "message").length === 1) {
        ws.send(
          JSON.stringify({
            type: "message",
            webchatId: WEBCHAT_ID,
            visitorId: VISITOR_ID,
            text: "Please connect me to a live agent",
          }),
        );
      }
      if (frames.filter((f: any) => f.type === "message").length >= 4) {
        setTimeout(() => {
          ws.close();
          resolve();
        }, 3000);
      }
    });
    ws.on("error", reject);
    setTimeout(() => {
      ws.close();
      resolve();
    }, 45000);
  });

  console.log("frames:", frames.length);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
