import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkNote,
  checkReply,
  checkTicketInput,
  databaseTarget,
  openDatabase,
  SEED_USER,
  STATUSES,
  verifyPassword,
} from "./db.mjs";
import { listPage, loginPage, messagePage, newTicketPage, ticketPage } from "./html.mjs";
import { acceptFiles, readRequest } from "./upload.mjs";
import { closeWorktualSession, openWorktualSession, ragDocumentUrl, ragStoreUrl } from "./worktual.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const uploadRoot = path.join(root, "uploads");
let db;
try {
  db = await openDatabase();
} catch (error) {
  console.error(`Could not open Postgres (${databaseTarget()}).`);
  console.error(error.message);
  process.exit(1);
}
const port = Number(process.env.PORT || 4100);
const host = "127.0.0.1";
const cssPath = path.join(root, "public", "desk.css");
const browserShimPath = path.join(root, "public", "ticketing-browser.js");
const sdkDist = path.resolve(root, "../packages/ticketing-sdk/dist");
const uiDist = path.resolve(root, "../packages/ticketing-ui/dist");
const uiV2Dist = path.resolve(root, "../packages/ticketing-ui-v2/dist");
const uiV3Dist = path.resolve(root, "../packages/ticketing-ui-v3/dist");

function safePackageFile(baseDir, rel) {
  let decoded = rel;
  try {
    decoded = decodeURIComponent(rel);
  } catch {
    return null;
  }
  if (!decoded || decoded.includes("\0")) return null;
  const file = path.resolve(baseDir, decoded);
  const base = path.resolve(baseDir);
  if (file !== base && !file.startsWith(`${base}${path.sep}`)) return null;
  return file;
}

const routes = [
  ["GET", "/login", getLogin],
  ["POST", "/login", postLogin],
  ["POST", "/logout", postLogout],
  ["GET", "/", getList],
  ["GET", "/tickets/new", getNewTicket],
  ["POST", "/tickets", postTicket],
  ["GET", /^\/tickets\/([^/]+)\/files\/(\d+)$/, getFile],
  ["GET", /^\/tickets\/([^/]+)$/, getTicket],
  ["POST", "/documents", postDocuments],
  ["POST", /^\/tickets\/([^/]+)\/knowledge$/, postKnowledge],
  ["POST", /^\/tickets\/([^/]+)\/status$/, postStatus],
  ["POST", /^\/tickets\/([^/]+)\/notes$/, postNote],
  ["POST", /^\/tickets\/([^/]+)\/reply$/, postReply],
  ["POST", /^\/tickets\/([^/]+)\/suggestion$/, postSuggestion],
];

const server = createServer(async (req, res) => {
  const wrapped = wrap(req, res);
  try {
    const url = new URL(req.url || "/", `http://${host}:${port}`);
    if (req.method === "GET" && url.pathname === "/desk.css") {
      const css = await readFile(cssPath);
      res.writeHead(200, {
        "content-type": "text/css; charset=utf-8",
        "cache-control": "no-cache",
      });
      res.end(css);
      return;
    }
    if (req.method === "GET" && url.pathname === "/ticketing-browser.js") {
      const shim = await readFile(browserShimPath);
      res.writeHead(200, {
        "content-type": "text/javascript; charset=utf-8",
        "cache-control": "no-cache",
      });
      res.end(shim);
      return;
    }
    if (
      req.method === "GET" &&
      (url.pathname.startsWith("/sdk/") || url.pathname.startsWith("/sdk-ui/") || url.pathname.startsWith("/sdk-ui-v2/") || url.pathname.startsWith("/sdk-ui-v3/"))
    ) {
      const prefix = url.pathname.startsWith("/sdk-ui-v3/")
        ? "/sdk-ui-v3/"
        : url.pathname.startsWith("/sdk-ui-v2/")
          ? "/sdk-ui-v2/"
          : url.pathname.startsWith("/sdk-ui/")
            ? "/sdk-ui/"
            : "/sdk/";
      const base = prefix === "/sdk-ui-v3/" ? uiV3Dist : prefix === "/sdk-ui-v2/" ? uiV2Dist : prefix === "/sdk-ui/" ? uiDist : sdkDist;
      const file = safePackageFile(base, url.pathname.slice(prefix.length));
      if (!file) {
        res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        res.end("Not found");
        return;
      }
      try {
        const body = await readFile(file);
        res.writeHead(200, {
          "content-type": "text/javascript; charset=utf-8",
          "cache-control": "no-cache",
        });
        res.end(body);
      } catch {
        res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        res.end("Not found");
      }
      return;
    }
    wrapped.query = {
      status: url.searchParams.get("status") || "",
      q: url.searchParams.get("q") || "",
      notice: url.searchParams.get("notice") || "",
      ask: url.searchParams.get("ask") || "",
    };
    if (req.method === "POST") {
      const parsed = await readRequest(req);
      wrapped.body = parsed.body;
      wrapped.files = parsed.files;
    } else {
      wrapped.body = {};
      wrapped.files = [];
    }
    for (const [method, pattern, handler] of routes) {
      if (req.method !== method) continue;
      const match = typeof pattern === "string"
        ? (url.pathname === pattern ? [] : null)
        : url.pathname.match(pattern);
      if (!match) continue;
      wrapped.params = {
        ...(match[1] ? { number: decodeURIComponent(match[1]) } : {}),
        ...(match[2] ? { fileId: match[2] } : {}),
      };
      await handler(wrapped, wrapped);
      return;
    }
    const user = await currentUser(wrapped);
    sendMissing(wrapped, user, user ? ensureCsrf(wrapped, wrapped) : "");
  } catch (error) {
    console.error(error);
    if (!res.headersSent) {
      res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      res.end("Something went wrong.");
    }
  }
});

server.listen(port, host, () => {
  console.log(`Acme Support desk  http://${host}:${port}`);
  console.log(`Database           ${databaseTarget()}`);
  console.log(`Staff login        ${SEED_USER.email}  /  ${SEED_USER.password}`);
});

async function getLogin(req, res) {
  if (await currentUser(req)) {
    res.redirect("/");
    return;
  }
  const csrf = ensureCsrf(req, res);
  res.send(loginPage({ csrf, email: "" }));
}

async function postLogin(req, res) {
  const csrf = ensureCsrf(req, res);
  if (!csrfOk(req, csrf)) {
    sendForbidden(res);
    return;
  }
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const user = await db.findUserByEmail(email);
  if (!user || !verifyPassword(password, user.password_hash)) {
    res.status(401).send(loginPage({
      csrf,
      email,
      error: "Email or password is incorrect.",
    }));
    return;
  }
  const worktual = await openWorktualSession();
  const session = await db.createSession(user.id, worktual.ok
    ? { sessionId: worktual.sessionId, token: worktual.token, actorEmail: worktual.actorEmail }
    : { error: worktual.error });
  res.append("Set-Cookie", sessionCookie(session.token, session.expires));
  res.redirect("/");
}

async function postLogout(req, res) {
  const csrf = ensureCsrf(req, res);
  if (!csrfOk(req, csrf)) {
    sendForbidden(res);
    return;
  }
  const user = await currentUser(req);
  await closeWorktualSession(user?.worktual_token);
  await db.deleteSession(readCookie(req, "desk_session"));
  res.append("Set-Cookie", "desk_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
  res.redirect("/login");
}

async function getList(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;
  const csrf = ensureCsrf(req, res);
  const status = STATUSES.includes(req.query.status) ? req.query.status : "";
  const q = String(req.query.q || "").slice(0, 120);
  res.send(await listMarkup({
    user,
    csrf,
    status,
    q,
    notice: String(req.query.notice || ""),
  }));
}

async function getNewTicket(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;
  const csrf = ensureCsrf(req, res);
  res.send(newTicketPage({
    user,
    csrf,
    values: { priority: "normal" },
    errors: {},
  }));
}

async function postTicket(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;
  const csrf = ensureCsrf(req, res);
  if (!csrfOk(req, csrf)) {
    sendForbidden(res, user, csrf);
    return;
  }
  const checked = checkTicketInput(req.body);
  if (!checked.ok) {
    res.status(400).send(newTicketPage({
      user,
      csrf,
      values: req.body,
      errors: checked.errors,
    }));
    return;
  }
  const ticket = await db.createTicket(checked.value);
  res.redirect(`/tickets/${ticket.number}?notice=created`);
}

async function getTicket(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;
  const ticket = await db.getTicket(req.params.number);
  if (!ticket) {
    sendMissing(res, user, ensureCsrf(req, res));
    return;
  }
  const csrf = ensureCsrf(req, res);
  await sendTicket(res, 200, {
    user,
    csrf,
    ticket,
    notice: String(req.query.notice || ""),
    askKnowledge: req.query.ask === "knowledge" && ticket.status === "resolved",
  });
}

async function postStatus(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;
  const csrf = ensureCsrf(req, res);
  if (!csrfOk(req, csrf)) {
    sendForbidden(res, user, csrf);
    return;
  }
  const ticket = await db.getTicket(req.params.number);
  if (!ticket) {
    sendMissing(res, user, csrf);
    return;
  }
  if (!STATUSES.includes(req.body.status)) {
    await sendTicket(res, 400, { user, csrf, ticket, noteError: "" });
    return;
  }
  await db.setStatus(ticket.id, req.body.status);
  const next = req.body.status === "resolved" ? "ask=knowledge" : "notice=status";
  res.redirect(`/tickets/${ticket.number}?${next}`);
}

async function postNote(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;
  const csrf = ensureCsrf(req, res);
  if (!csrfOk(req, csrf)) {
    sendForbidden(res, user, csrf);
    return;
  }
  const ticket = await db.getTicket(req.params.number);
  if (!ticket) {
    sendMissing(res, user, csrf);
    return;
  }
  const checked = checkNote(req.body.body);
  if (!checked.ok) {
    await sendTicket(res, 400, { user, csrf, ticket, noteError: checked.error });
    return;
  }
  await db.addNote(ticket.id, user.id, checked.value);
  res.redirect(`/tickets/${ticket.number}?notice=note`);
}

async function postReply(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;
  const csrf = ensureCsrf(req, res);
  if (!csrfOk(req, csrf)) {
    sendForbidden(res, user, csrf);
    return;
  }
  const ticket = await db.getTicket(req.params.number);
  if (!ticket) {
    sendMissing(res, user, csrf);
    return;
  }
  const checked = checkReply(req.body.body);
  if (!checked.ok) {
    await sendTicket(res, 400, { user, csrf, ticket, replyError: checked.error });
    return;
  }
  await db.addCustomerReply(ticket.id, user.name, checked.value);
  res.redirect(`/tickets/${ticket.number}?notice=sent`);
}

async function postSuggestion(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;
  const csrf = ensureCsrf(req, res);
  if (!csrfOk(req, csrf)) {
    sendForbidden(res, user, csrf);
    return;
  }
  const ticket = await db.getTicket(req.params.number);
  if (!ticket) {
    sendMissing(res, user, csrf);
    return;
  }
  const guidance = String(req.body.guidance || "").trim().slice(0, 2000);
  const reply = String(req.body.reply || "").trim().slice(0, 4000);
  if (!guidance && !reply) {
    res.status(400).send("Suggestion is empty");
    return;
  }
  await db.saveSuggestion(ticket.id, guidance, reply);
  res.noContent();
}

async function postDocuments(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;
  const csrf = ensureCsrf(req, res);
  if (!csrfOk(req, csrf)) {
    sendForbidden(res, user, csrf);
    return;
  }
  const checked = acceptFiles(req.files || []);
  if (!checked.ok) {
    res.status(400).send(await listMarkup({ user, csrf, fileError: checked.error }));
    return;
  }
  for (const file of checked.files) {
    try {
      await keepDocument(file);
    } catch (error) {
      const status = error.status >= 500 ? 502 : 400;
      res.status(status).send(await listMarkup({
        user,
        csrf,
        fileError: error instanceof Error ? error.message : "The knowledge service did not keep this file.",
      }));
      return;
    }
  }
  res.redirect("/?notice=embedded");
}

async function listMarkup({ user, csrf, status = "", q = "", notice = "", fileError = "" }) {
  return listPage({
    user,
    csrf,
    tickets: await db.listTickets({ status, q }),
    total: await db.countTickets(),
    status,
    q,
    notice,
    documents: await listKnowledgeDocuments(),
    fileError,
  });
}

async function listKnowledgeDocuments() {
  try {
    const response = await fetch(new URL("/documents", ragDocumentUrl()));
    if (!response.ok) return [];
    const payload = await response.json();
    return Array.isArray(payload.documents) ? payload.documents : [];
  } catch {
    return [];
  }
}

async function keepDocument(file) {
  const response = await fetch(ragDocumentUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      filename: file.filename,
      mime: file.mime,
      content_base64: file.data.toString("base64"),
    }),
  });
  if (!response.ok) {
    let message = "The knowledge service did not keep this file.";
    try {
      const payload = await response.json();
      if (payload.error) message = String(payload.error);
    } catch {
      // The status text below is enough when the body is not JSON.
    }
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
}

async function getFile(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;
  const ticket = await db.getTicket(req.params.number);
  const file = ticket ? await db.attachmentFor(ticket.id, Number(req.params.fileId)) : null;
  if (!ticket || !file || !/^[a-f0-9]+-[\w.\- ]+$/i.test(file.stored_name)) {
    sendMissing(res, user, ensureCsrf(req, res));
    return;
  }
  const folder = path.resolve(uploadRoot, String(ticket.id));
  const target = path.resolve(folder, file.stored_name);
  if (!target.startsWith(`${folder}${path.sep}`)) {
    sendMissing(res, user, ensureCsrf(req, res));
    return;
  }
  try {
    const body = await readFile(target);
    res.sendRaw(200, {
      "content-type": file.mime || "application/octet-stream",
      "content-length": body.length,
      "content-disposition": `attachment; filename="${file.original_name.replaceAll('"', "")}"`,
      "x-content-type-options": "nosniff",
    }, body);
  } catch {
    sendMissing(res, user, ensureCsrf(req, res));
  }
}

async function postKnowledge(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;
  const csrf = ensureCsrf(req, res);
  if (!csrfOk(req, csrf)) {
    sendForbidden(res, user, csrf);
    return;
  }
  const ticket = await db.getTicket(req.params.number);
  if (!ticket) {
    sendMissing(res, user, csrf);
    return;
  }
  const solution = String(req.body.solution || "").trim().slice(0, 8000);
  if (!solution) {
    await sendTicket(res, 400, {
      user,
      csrf,
      ticket,
      askKnowledge: true,
      knowledgeError: "Write the solution before storing it.",
    });
    return;
  }
  const issue = [`Subject: ${ticket.subject}`, ticket.description].filter(Boolean).join("\n\n");
  try {
    const response = await fetch(ragStoreUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ issue, solution, ticket: ticket.number }),
    });
    if (!response.ok) throw new Error("The knowledge service did not store this solution.");
  } catch (error) {
    await sendTicket(res, 502, {
      user,
      csrf,
      ticket,
      askKnowledge: true,
      knowledgeError: error instanceof Error ? error.message : "The knowledge service is unavailable.",
    });
    return;
  }
  res.redirect(`/tickets/${ticket.number}?notice=stored`);
}

async function sendTicket(res, status, { user, csrf, ticket, notice = "", noteError = "", replyError = "", fileError = "", askKnowledge = false, knowledgeError = "" }) {
  const messages = await db.listMessages(ticket.id);
  res.status(status).send(ticketPage({
    user,
    csrf,
    ticket,
    notes: await db.listNotes(ticket.id),
    messages,
    files: await db.listAttachments(ticket.id),
    suggestion: await db.suggestionFor(ticket.id),
    notice,
    noteError,
    replyError,
    fileError,
    askKnowledge,
    knowledgeError,
    solution: messages.filter((message) => message.sender === "agent").map((message) => message.body).join("\n\n"),
  }));
}

async function requireUser(req, res) {
  const user = await currentUser(req);
  if (!user) {
    res.redirect("/login");
    return null;
  }
  return user;
}

async function currentUser(req) {
  return db.userForSession(readCookie(req, "desk_session"));
}

function ensureCsrf(req, res) {
  const existing = readCookie(req, "desk_csrf");
  if (existing) return existing;
  const token = randomBytes(24).toString("hex");
  res.append("Set-Cookie", `desk_csrf=${token}; Path=/; HttpOnly; SameSite=Lax`);
  return token;
}

function csrfOk(req, csrf) {
  return safeEqual(String(req.body?.csrf || ""), csrf);
}

function sessionCookie(token, expires) {
  const maxAge = Math.max(0, Math.floor((expires.getTime() - Date.now()) / 1000));
  return `desk_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}

function readCookie(req, name) {
  const header = req.headers.cookie || "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return "";
}

function safeEqual(left, right) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}

function sendMissing(res, user, csrf) {
  res.status(404).send(messagePage({
    title: "Not found",
    user,
    csrf,
    text: "That page is not on this desk.",
  }));
}

function sendForbidden(res, user, csrf) {
  res.status(403).send(messagePage({
    title: "Page expired",
    user,
    csrf,
    text: "Reload the page and try that again.",
  }));
}

function wrap(req, res) {
  const cookies = [];
  let status = 200;
  let ended = false;
  return {
    headers: req.headers,
    body: {},
    query: {},
    params: {},
    append(_name, value) {
      cookies.push(value);
    },
    redirect(location) {
      status = 302;
      finish(location, "");
    },
    status(code) {
      status = code;
      return this;
    },
    noContent() {
      status = 204;
      finish("", "");
    },
    sendRaw(code, headers, body) {
      status = code;
      if (ended) return;
      ended = true;
      if (cookies.length) res.setHeader("Set-Cookie", cookies);
      res.writeHead(code, headers);
      res.end(body);
    },
    send(html) {
      finish("text/html; charset=utf-8", html);
    },
  };

  function finish(contentType, body) {
    if (ended) return;
    ended = true;
    if (cookies.length) res.setHeader("Set-Cookie", cookies);
    const headers = { "content-type": contentType, "x-content-type-options": "nosniff" };
    if (status === 302) {
      headers.location = contentType;
      headers["content-type"] = "text/plain; charset=utf-8";
      res.writeHead(status, headers);
      res.end();
      return;
    }
    if (status === 204) {
      res.writeHead(204);
      res.end();
      return;
    }
    res.writeHead(status, headers);
    res.end(body);
  }
}

function readForm(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 100_000) {
        reject(Object.assign(new Error("Form is too large"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const params = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
      const body = {};
      for (const [key, value] of params) body[key] = value;
      resolve(body);
    });
    req.on("error", reject);
  });
}
