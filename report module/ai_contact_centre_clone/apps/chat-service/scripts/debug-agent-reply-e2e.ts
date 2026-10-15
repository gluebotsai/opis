/**
 * End-to-end: customer WS handoff + agent API accept + reply delivery.
 */
import WebSocket from "ws";

const WEBCHAT_ID = "wc_5d80cd9b1ace4080bc70717552472611";
const VISITOR_ID = `v_e2e_${Date.now()}`;
const CC = "http://localhost:3000";

async function loginAgent() {
  const res = await fetch(`${CC}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "agent.test@worktual.local", password: "Worktual@123" }),
  });
  if (!res.ok) throw new Error(`login failed ${res.status}`);
  return ((await res.json()) as { token: string }).token;
}

async function setReady(token: string) {
  const res = await fetch(`${CC}/api/v1/workspace/presence`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ state: "ready" }),
  });
  if (!res.ok) {
    throw new Error(`setReady failed ${res.status}: ${await res.text()}`);
  }
}

async function tryAcceptAndReply(token: string, conversationId: string) {
  for (let i = 0; i < 15; i += 1) {
    const acceptRes = await fetch(`${CC}/api/v1/workspace/conversations/${conversationId}/accept`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: "{}",
    });
    if (acceptRes.ok) {
      const msgRes = await fetch(`${CC}/api/v1/workspace/conversations/${conversationId}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ body: "Thanks — an agent is here to help you now." }),
      });
      console.log("accept ok, message status", msgRes.status);
      return msgRes.ok;
    }
    const body = await acceptRes.text();
    console.log(`accept attempt ${i + 1} failed`, acceptRes.status, body);
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

async function main() {
  const token = await loginAgent();
  await setReady(token);

  let conversationId = "";
  let handoffTriggered = false;
  let agentReplySeen = false;

  const ws = new WebSocket(
    `ws://localhost:3002/ws/webchat?webchatId=${WEBCHAT_ID}&visitorId=${VISITOR_ID}`,
  );

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("timeout waiting for agent reply")), 120_000);

    ws.on("open", () => {
      ws.send(
        JSON.stringify({
          type: "session.start",
          webchatId: WEBCHAT_ID,
          visitorId: VISITOR_ID,
          pageUrl: "http://debug-e2e",
          consent: { accepted: true },
        }),
      );
    });

    ws.on("message", async (raw) => {
      try {
        const frame = JSON.parse(String(raw)) as {
          type: string;
          conversationId?: string;
          from?: string;
          text?: string;
        };

        if (frame.type === "session.ready" && frame.conversationId) {
          conversationId = frame.conversationId;
          ws.send(
            JSON.stringify({
              type: "message",
              webchatId: WEBCHAT_ID,
              visitorId: VISITOR_ID,
              text: "Please connect me to a live agent",
            }),
          );
          return;
        }

        if (frame.type === "message" && frame.from === "agent" && frame.text?.includes("agent is here")) {
          agentReplySeen = true;
          clearTimeout(timeout);
          ws.close();
          resolve();
          return;
        }

        if (
          !handoffTriggered &&
          frame.type === "message" &&
          (frame.from === "bot" || frame.from === "system") &&
          conversationId &&
          /agent|connect|hold|queue|wait/i.test(frame.text ?? "")
        ) {
          handoffTriggered = true;
          await setReady(token);
          await tryAcceptAndReply(token, conversationId);
        }
      } catch (error) {
        reject(error);
      }
    });

    ws.on("error", reject);
  });

  console.log(agentReplySeen ? "PASS agent reply delivered to customer WS" : "FAIL no agent reply");
  process.exit(agentReplySeen ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
