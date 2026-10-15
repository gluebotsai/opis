import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chunkText, cosine, documentText, embed } from "./embed.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const storePath = path.join(root, "data", "solutions.json");
const documentIndexPath = path.join(root, "data", "documents.json");
const documentDir = path.join(root, "data", "files");
const kbDir = path.join(root, "kb");
const DOCUMENT_LIMIT = 12_000_000;
const FILE_LIMIT = 8_000_000;
const port = Number(process.env.PORT || 4300);
const host = "127.0.0.1";
const origins = new Set(
  String(process.env.RAG_ORIGINS || "http://127.0.0.1:4100,http://localhost:4100")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean),
);
const STOP = new Set(["the", "a", "an", "to", "of", "and", "or", "for", "in", "on", "is", "it", "this", "that", "with", "from", "was", "are", "can", "you", "your"]);

const server = createServer(async (req, res) => {
  const origin = String(req.headers.origin || "").trim();
  if (origins.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  }
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  const url = new URL(req.url || "/", `http://${host}:${port}`);
  if (req.method === "GET" && url.pathname === "/health") {
    const [rows, documents] = await Promise.all([loadCorpus(), loadDocumentIndex()]);
    sendJson(res, 200, { ok: true, solutions: rows.length, documents: documents.length });
    return;
  }
  if (req.method === "GET" && url.pathname === "/documents") {
    const documents = await loadDocumentIndex();
    sendJson(res, 200, {
      documents: documents.map((row) => ({
        id: row.id,
        filename: row.filename,
        created_at: row.created_at,
        chunks: Array.isArray(row.chunks) ? row.chunks.length : 0,
      })),
    });
    return;
  }
  if (req.method === "POST" && url.pathname === "/search") {
    try {
      const body = await readJson(req);
      const issue = String(body.issue || "").trim();
      if (!issue) {
        sendJson(res, 400, { error: "issue is required" });
        return;
      }
      const documents = await loadDocumentIndex();
      const embedded = bestEmbedded(issue, documents);
      const hit = bestMatch(await loadCorpus(), issue);
      if (embedded && (!hit || hit.source === "file" || embedded.score >= 0.55)) {
        sendJson(res, 200, {
          found: true,
          reply: embedded.text.slice(0, 4000),
          guidance: `This came from ${embedded.filename}.`,
          ticket: "",
        });
        return;
      }
      if (!hit) {
        sendJson(res, 200, { found: false, reply: "", guidance: "" });
        return;
      }
      sendJson(res, 200, {
        found: true,
        reply: hit.solution,
        guidance: hit.source === "file"
          ? "This came from a file saved in the knowledge service."
          : "This came from a saved solution.",
        ticket: hit.ticket || "",
      });
    } catch (error) {
      sendJson(res, 400, { error: error instanceof Error ? error.message : "Search failed." });
    }
    return;
  }
  if (req.method === "POST" && url.pathname === "/store") {
    try {
      const body = await readJson(req);
      const issue = String(body.issue || "").trim().slice(0, 4000);
      const solution = String(body.solution || "").trim().slice(0, 8000);
      const ticket = String(body.ticket || "").trim().slice(0, 40);
      if (!issue || !solution) {
        sendJson(res, 400, { error: "issue and solution are required" });
        return;
      }
      const rows = await load();
      const row = {
        id: randomBytes(8).toString("hex"),
        ticket,
        issue,
        solution,
        created_at: new Date().toISOString(),
      };
      rows.push(row);
      await save(rows);
      sendJson(res, 201, { ok: true, id: row.id });
    } catch (error) {
      sendJson(res, 400, { error: error instanceof Error ? error.message : "Store failed." });
    }
    return;
  }
  if (req.method === "POST" && url.pathname === "/documents") {
    try {
      const body = await readJson(req, DOCUMENT_LIMIT);
      const saved = await saveDocument(body);
      sendJson(res, 201, { ok: true, id: saved.id, filename: saved.filename });
    } catch (error) {
      sendJson(res, 400, { error: error instanceof Error ? error.message : "The file could not be saved." });
    }
    return;
  }
  sendJson(res, 404, { error: "Not found" });
});

server.listen(port, host, () => {
  console.log(`Knowledge service  http://${host}:${port}`);
});

function bestEmbedded(issue, documents) {
  const query = embed(issue);
  let best = null;
  for (const document of documents) {
    for (const chunk of document.chunks || []) {
      if (!chunk?.text || !Array.isArray(chunk.vector) || !chunk.vector.length) continue;
      const score = cosine(query, chunk.vector);
      if (!best || score > best.score) {
        best = { score, text: chunk.text, filename: document.filename || "document" };
      }
    }
  }
  if (!best || best.score < 0.42) return null;
  return best;
}

function bestMatch(rows, issue) {
  const scored = rows.map((row) => ({ row, ...overlap(issue, `${row.issue}\n${row.solution}`) }));
  scored.sort((left, right) => right.score - left.score || right.hits - left.hits);
  const top = scored[0];
  if (!top || top.hits < 3 || top.score < 0.34) return null;
  return top.row;
}

function overlap(query, document) {
  const words = tokens(query);
  const known = new Set(tokens(document));
  if (!words.length) return { score: 0, hits: 0 };
  const hits = words.filter((word) => known.has(word)).length;
  return { score: hits / words.length, hits };
}

function tokens(text) {
  return [...new Set(String(text).toLowerCase().match(/[a-z0-9]{3,}/g) || [])].filter((word) => !STOP.has(word));
}

async function loadCorpus() {
  const [stored, files, documents] = await Promise.all([load(), loadKb(), loadDocuments()]);
  return [...files, ...stored, ...documents];
}

async function saveDocument(body) {
  const filename = safeFileName(body.filename);
  const ticket = String(body.ticket || "").trim().slice(0, 40);
  const mime = String(body.mime || "application/octet-stream").trim().slice(0, 120);
  const raw = Buffer.from(String(body.content_base64 || ""), "base64");
  if (!raw.length) throw new Error("The file is empty.");
  if (raw.length > FILE_LIMIT) throw new Error("The file is larger than 8 MB.");
  const text = documentText(filename, mime, raw).slice(0, 20000);
  const pieces = chunkText(text);
  if (!pieces.length) throw new Error("This document has no text to embed.");
  const id = randomBytes(8).toString("hex");
  const storedName = `${id}-${filename}`;
  const target = path.resolve(documentDir, storedName);
  if (!target.startsWith(`${path.resolve(documentDir)}${path.sep}`)) {
    throw new Error("The file name is not allowed.");
  }
  await mkdir(documentDir, { recursive: true });
  await writeFile(target, raw);
  const row = {
    id,
    ticket,
    filename,
    mime,
    stored_name: storedName,
    created_at: new Date().toISOString(),
    chunks: pieces.map((piece) => ({ text: piece, vector: embed(piece) })),
  };
  const rows = await loadDocumentIndex();
  rows.push(row);
  await mkdir(path.dirname(documentIndexPath), { recursive: true });
  await writeFile(documentIndexPath, JSON.stringify(rows, null, 2));
  return row;
}

async function loadDocumentIndex() {
  try {
    const parsed = JSON.parse(await readFile(documentIndexPath, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function loadDocuments() {
  const rows = await loadDocumentIndex();
  return rows.flatMap((row) => {
    const pieces = Array.isArray(row.chunks) && row.chunks.length
      ? row.chunks.map((chunk) => chunk.text)
      : [row.text];
    return pieces.filter(Boolean).map((text) => ({
      id: row.id,
      ticket: row.ticket || "",
      issue: `File: ${row.filename}\n${text}`,
      solution: String(text).slice(0, 4000),
      source: "file",
      created_at: row.created_at || "",
    }));
  });
}

function safeFileName(value) {
  const base = String(value || "file").split(/[/\\]/).pop() || "file";
  const cleaned = base.replace(/[^\w.\- ]+/g, "").trim().slice(0, 120);
  return cleaned || "file";
}

async function loadKb() {
  let names = [];
  try {
    names = await readdir(kbDir);
  } catch {
    return [];
  }
  const rows = [];
  for (const name of names) {
    if (!name.endsWith(".md")) continue;
    const text = await readFile(path.join(kbDir, name), "utf8");
    const row = parseKb(name, text);
    if (row) rows.push(row);
  }
  return rows;
}

function parseKb(name, text) {
  const title = (text.match(/^#\s+(.+)$/m) || [])[1]?.trim() || name;
  const issue = section(text, "Issue");
  const solution = section(text, "Reply") || section(text, "Solution");
  if (!issue || !solution) return null;
  return {
    id: name.replace(/\.md$/i, ""),
    ticket: "",
    issue: `${title}\n${issue}`,
    solution,
    created_at: "",
  };
}

function section(text, heading) {
  const start = text.search(new RegExp(`^## ${heading}\\r?\\n`, "m"));
  if (start < 0) return "";
  const after = text.slice(start).replace(new RegExp(`^## ${heading}\\r?\\n`), "");
  const next = after.search(/\n## /);
  return (next < 0 ? after : after.slice(0, next)).trim();
}

async function load() {
  try {
    const parsed = JSON.parse(await readFile(storePath, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function save(rows) {
  await mkdir(path.dirname(storePath), { recursive: true });
  await writeFile(storePath, JSON.stringify(rows, null, 2));
}

function readJson(req, limit = 200_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("Request is too large."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
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
