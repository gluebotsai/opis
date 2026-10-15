const TEXT_LIMIT = 100_000;
const UPLOAD_LIMIT = 20_000_000;
const FILE_LIMIT = 8_000_000;
const MAX_FILES = 8;
const ALLOWED = new Set([
  "pdf", "png", "jpg", "jpeg", "gif", "webp", "txt", "csv", "md",
  "doc", "docx", "xls", "xlsx", "zip",
]);

export async function readRequest(req) {
  const type = String(req.headers["content-type"] || "");
  const limit = type.includes("multipart/form-data") ? UPLOAD_LIMIT : TEXT_LIMIT;
  const raw = await readRaw(req, limit);
  if (!type.includes("multipart/form-data")) {
    const params = new URLSearchParams(raw.toString("utf8"));
    const body = {};
    for (const [key, value] of params) body[key] = value;
    return { body, files: [] };
  }
  return parseMultipart(type, raw);
}

export function acceptFiles(files) {
  const chosen = files.filter((file) => file.filename && file.data.length);
  if (!chosen.length) return { ok: false, error: "Choose at least one file." };
  if (chosen.length > MAX_FILES) return { ok: false, error: `Attach up to ${MAX_FILES} files at a time.` };
  const accepted = [];
  for (const file of chosen) {
    if (file.data.length > FILE_LIMIT) {
      return { ok: false, error: `${file.filename} is larger than 8 MB.` };
    }
    const name = safeName(file.filename);
    const extension = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
    if (!ALLOWED.has(extension)) {
      return { ok: false, error: `${name} is not an allowed file type.` };
    }
    accepted.push({ ...file, filename: name });
  }
  return { ok: true, files: accepted };
}

function safeName(value) {
  const base = String(value || "file").split(/[/\\]/).pop() || "file";
  const cleaned = base.replace(/[^\w.\- ]+/g, "").trim().slice(0, 120);
  return cleaned || "file";
}

function parseMultipart(contentType, buffer) {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!match) {
    const error = new Error("Upload is missing a boundary.");
    error.status = 400;
    throw error;
  }
  const boundary = Buffer.from(`--${(match[1] || match[2]).trim()}`);
  const body = {};
  const files = [];
  let start = buffer.indexOf(boundary);
  while (start !== -1) {
    const after = start + boundary.length;
    if (buffer.subarray(after, after + 2).toString() === "--") break;
    let partStart = after;
    if (buffer.subarray(partStart, partStart + 2).toString() === "\r\n") partStart += 2;
    const next = buffer.indexOf(boundary, partStart);
    if (next === -1) break;
    let partEnd = next;
    if (buffer.subarray(partEnd - 2, partEnd).toString() === "\r\n") partEnd -= 2;
    const headerEnd = indexOf(buffer, Buffer.from("\r\n\r\n"), partStart, partEnd);
    if (headerEnd !== -1) {
      const headers = buffer.subarray(partStart, headerEnd).toString("utf8");
      const content = buffer.subarray(headerEnd + 4, partEnd);
      const disposition = /content-disposition:[^\r\n]*/i.exec(headers)?.[0] || "";
      const name = /name="([^"]*)"/.exec(disposition)?.[1] || "";
      const filename = /filename="([^"]*)"/.exec(disposition)?.[1] || "";
      const mime = /content-type:\s*([^\r\n]+)/i.exec(headers)?.[1]?.trim() || "application/octet-stream";
      if (filename) files.push({ field: name, filename, mime, data: content });
      else if (name) body[name] = content.toString("utf8");
    }
    start = next;
  }
  return { body, files };
}

function indexOf(buffer, needle, from, to) {
  const found = buffer.indexOf(needle, from);
  if (found === -1 || found > to) return -1;
  return found;
}

function readRaw(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        const error = new Error("Upload is too large.");
        error.status = 413;
        reject(error);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
