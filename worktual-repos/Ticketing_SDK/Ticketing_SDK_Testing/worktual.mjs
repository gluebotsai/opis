import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createTicketingClient } from "../packages/ticketing-sdk/dist/index.js";

const root = path.dirname(fileURLToPath(import.meta.url));
loadEnv(path.join(root, ".env"));

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

function client() {
  return createTicketingClient({
    baseUrl: process.env.WORKTUAL_API_BASE || "http://127.0.0.1:3001",
    partnerApiKey: process.env.WORKTUAL_API_KEY,
    locale: "en",
  });
}

export function worktualActorEmail() {
  return String(process.env.WORKTUAL_ACTOR_EMAIL || "").trim();
}

export function worktualApiBase() {
  return process.env.WORKTUAL_API_BASE || "http://127.0.0.1:3001";
}

export function recommendUrl() {
  return process.env.RECOMMEND_URL || "http://127.0.0.1:4200/recommend";
}

export function ragBase() {
  return String(process.env.RAG_URL || "http://127.0.0.1:4300").replace(/\/+$/, "");
}

export function ragSearchUrl() {
  return `${ragBase()}/search`;
}

export function ragStoreUrl() {
  return `${ragBase()}/store`;
}

export function ragDocumentUrl() {
  return `${ragBase()}/documents`;
}

export function recommendOrigin() {
  try {
    return new URL(recommendUrl()).origin;
  } catch {
    return "http://127.0.0.1:4200";
  }
}

export async function openWorktualSession() {
  const actorEmail = worktualActorEmail();
  if (!process.env.WORKTUAL_API_KEY || !actorEmail) {
    return { ok: false, error: "Worktual login is not configured on this desk." };
  }
  try {
    const session = await client().auth.createSession({
      actor: { email: actorEmail },
      locale: "en",
    });
    return {
      ok: true,
      sessionId: session.sessionId,
      token: session.sessionToken,
      actorEmail: session.actor?.email || actorEmail,
    };
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : "";
    const message = error instanceof Error ? error.message : "Worktual login failed.";
    return { ok: false, error: code ? `${code}: ${message}` : message };
  }
}

export async function closeWorktualSession(sessionToken) {
  if (!sessionToken) return;
  try {
    await client().auth.endSession(sessionToken);
  } catch {
    // The desk logout still completes if Worktual is unreachable.
  }
}
