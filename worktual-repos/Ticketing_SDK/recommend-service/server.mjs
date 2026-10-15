import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

loadEnv(path.join(path.dirname(fileURLToPath(import.meta.url)), ".env"));

const port = Number(process.env.PORT || 4200);
const host = "127.0.0.1";
const model = process.env.LLM_MODEL || "worktual-qwen-27B";
const baseUrl = String(process.env.LLM_BASE_URL || "http://89.12.66.129:8566/v1").replace(/\/+$/, "");
const apiKey = String(process.env.LLM_API_KEY || "").trim();
const origins = new Set(
  String(process.env.RECOMMEND_ORIGINS || "http://127.0.0.1:4100,http://localhost:4100")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean),
);
const chats = new Map();

const server = createServer(async (req, res) => {
  const origin = String(req.headers.origin || "").trim();
  if (origins.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, Accept, X-Worktual-Sdk-Surface, X-Worktual-Sdk-Component, X-Worktual-Sdk-Feature",
    );
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  }
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  const url = new URL(req.url || "/", `http://${host}:${port}`);
  if (req.method === "GET" && url.pathname === "/health") {
    sendJson(res, 200, { ok: true, model });
    return;
  }
  if (req.method === "POST" && url.pathname === "/recommend") {
    try {
      const body = await readJson(req);
      const issue = String(body.issue || "").trim();
      const locale = String(body.locale || "en").trim() || "en";
      if (!issue) {
        sendJson(res, 400, { error: "issue is required" });
        return;
      }
      const knowledge = String(body.knowledge || "").trim().slice(0, 8000);
      const grounded = !knowledge && body.grounded !== false;
      const text = await complete([
        { role: "system", content: systemPrompt(locale, grounded, Boolean(knowledge)) },
        { role: "user", content: knowledge
          ? `Customer request:\n${issue}\n\nSaved knowledge:\n${knowledge}`
          : issue },
      ]);
      const parts = splitSuggestion(text);
      let reply = parts.reply || text.trim();
      if (knowledge) {
        reply = reply.replace(/^I don't have knowledge on this\.\s*/i, "").trim();
      } else if (!grounded && !/don'?t have knowledge|do not have knowledge/i.test(reply)) {
        reply = `I don't have knowledge on this. ${reply}`.trim();
      }
      sendJson(res, 200, {
        guidance: parts.guidance,
        reply,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Recommendation failed.";
      console.error(message);
      sendJson(res, 502, { error: message });
    }
    return;
  }
  if (
    req.method === "POST" &&
    (url.pathname === "/api/coworker/agent-turn" || url.pathname === "/api/coworker/agent-turn/stream")
  ) {
    try {
      const body = await readJson(req);
      const result = await answerChat(body);
      if (url.pathname.endsWith("/stream")) sendSse(res, result);
      else sendJson(res, 200, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Chat failed.";
      const status = error && typeof error === "object" && "status" in error ? Number(error.status) || 502 : 502;
      console.error(message);
      sendJson(res, status, { error: message, detail: message });
    }
    return;
  }
  sendJson(res, 404, { error: "Not found" });
});

server.listen(port, host, () => {
  console.log(`Recommendation service  http://${host}:${port}`);
  console.log(`Model                  ${model}`);
  console.log(`LLM                    ${baseUrl}`);
});

async function answerChat(body) {
  const message = String(body.message || "").trim();
  const locale = String(body.locale || "en").trim() || "en";
  const sessionId = String(body.session_id || "desk-chat").trim() || "desk-chat";
  if (!message) {
    const error = new Error("message is required");
    error.status = 400;
    throw error;
  }
  if (body.confirm_tool) {
    const reply = "This chat only answers questions. Ticket changes stay on the desk.";
    return { assistantText: reply, reply, session_id: sessionId, agent: "desk" };
  }
  const prior = chats.get(sessionId) || [];
  const text = await complete([
    { role: "system", content: chatPrompt(locale) },
    ...prior,
    { role: "user", content: message },
  ]);
  prior.push({ role: "user", content: message }, { role: "assistant", content: text.trim() });
  while (prior.length > 12) prior.shift();
  if (!chats.has(sessionId) && chats.size >= 100) chats.delete(chats.keys().next().value);
  chats.set(sessionId, prior);
  return {
    assistantText: text.trim(),
    reply: text.trim(),
    session_id: sessionId,
    agent: "desk",
  };
}

function chatPrompt(locale) {
  return [
    "You are the support assistant in this desk's chat.",
    "Answer the person directly.",
    "Do not create, update, or assign a ticket.",
    "Use only this conversation.",
    `Write in locale ${locale}.`,
  ].join("\n");
}

async function complete(messages) {
  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  let response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages,
      }),
      signal: AbortSignal.timeout(90000),
    });
  } catch (error) {
    const code = error && typeof error === "object" && "cause" in error && error.cause && typeof error.cause === "object" && "code" in error.cause
      ? String(error.cause.code)
      : "";
    throw new Error(code ? `The model could not be reached (${code}).` : "The model could not be reached.");
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = payload.error?.message || payload.error || payload.message || response.statusText;
    throw new Error(String(detail || "The model request failed."));
  }
  const text = payload.choices?.[0]?.message?.content;
  if (!String(text || "").trim()) throw new Error("The model returned an empty suggestion.");
  return String(text);
}

function systemPrompt(locale, grounded = true, rephrase = false) {
  const lines = [
    "You help a support agent who already has the ticket in their own desk.",
    "Do not create, update, or assign a ticket. Use only the customer request you are given.",
    `Write in locale ${locale}.`,
    "Answer in exactly this shape:",
    "GUIDANCE: one or two sentences for the agent about what to check or try.",
    "REPLY: the customer-facing message the agent may send, with no preamble.",
  ];
  if (rephrase) {
    lines.push("A saved knowledge passage is included with the request.");
    lines.push("Rewrite that passage as a natural customer-facing REPLY in your own words.");
    lines.push("Keep every fact from the passage. Do not add steps that are not in it.");
    lines.push("Do not start the REPLY with: I don't have knowledge on this.");
  } else if (!grounded) {
    lines.push("No saved solution matched this request.");
    lines.push("The REPLY must begin with exactly: I don't have knowledge on this.");
    lines.push("After that sentence, give the best reasoned reply you can.");
  }
  return lines.join("\n");
}

function splitSuggestion(text) {
  const guidance = String(text).match(/GUIDANCE:\s*([\s\S]*?)(?:\n\s*REPLY:|$)/i);
  const reply = String(text).match(/REPLY:\s*([\s\S]*)$/i);
  if (!reply) return { guidance: "", reply: "" };
  return {
    guidance: (guidance?.[1] || "").trim(),
    reply: reply[1].trim(),
  };
}

function loadEnv(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const splitAt = trimmed.indexOf("=");
    if (splitAt < 1) continue;
    const key = trimmed.slice(0, splitAt).trim();
    let value = trimmed.slice(splitAt + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] == null) process.env[key] = value;
  }
}

function sendSse(res, payload) {
  const body = `event: result\ndata: ${JSON.stringify(payload)}\n\n`;
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        reject(new Error("Invalid JSON."));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}
