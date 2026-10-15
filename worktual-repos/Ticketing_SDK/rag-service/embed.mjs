import { inflateRawSync } from "node:zlib";

const DIM = 384;

export function embed(text) {
  const vec = new Float64Array(DIM);
  const words = String(text || "").toLowerCase().match(/[a-z0-9]{2,}/g) || [];
  for (let index = 0; index < words.length; index += 1) {
    addToken(vec, words[index], 1);
    if (index + 1 < words.length) addToken(vec, `${words[index]}_${words[index + 1]}`, 0.6);
  }
  let norm = 0;
  for (const value of vec) norm += value * value;
  norm = Math.sqrt(norm) || 1;
  return Array.from(vec, (value) => Math.round((value / norm) * 10000) / 10000);
}

export function cosine(left, right) {
  const size = Math.min(left.length, right.length);
  let score = 0;
  for (let index = 0; index < size; index += 1) score += left[index] * right[index];
  return score;
}

export function chunkText(text) {
  const clean = String(text || "").replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").trim();
  if (!clean) return [];
  if (clean.length <= 900) return [clean];
  const chunks = [];
  let start = 0;
  while (start < clean.length && chunks.length < 40) {
    let end = Math.min(clean.length, start + 900);
    if (end < clean.length) {
      const breakAt = Math.max(clean.lastIndexOf("\n", end), clean.lastIndexOf(". ", end));
      if (breakAt > start + 400) end = breakAt + 1;
    }
    const piece = clean.slice(start, end).trim();
    if (piece) chunks.push(piece);
    if (end >= clean.length) break;
    start = Math.max(end - 120, start + 1);
  }
  return chunks;
}

export function documentText(filename, mime, raw) {
  const extension = filename.includes(".") ? filename.slice(filename.lastIndexOf(".") + 1).toLowerCase() : "";
  if (["txt", "csv", "md"].includes(extension) || String(mime || "").startsWith("text/")) {
    return raw.toString("utf8").replace(/\u0000/g, "").trim();
  }
  if (extension === "docx") return docxText(raw);
  if (extension === "xlsx") return xlsxText(raw);
  if (extension === "pdf") return pdfText(raw);
  return "";
}

function addToken(vec, token, weight) {
  const hash = fnv(token);
  const index = hash % DIM;
  const sign = (hash >>> 8) & 1 ? 1 : -1;
  vec[index] += sign * weight;
}

function fnv(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function docxText(raw) {
  const xml = unzipEntry(raw, "word/document.xml");
  if (!xml) return "";
  return xml.toString("utf8")
    .replace(/<w:p[ >]/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function xlsxText(raw) {
  const xml = unzipEntry(raw, "xl/sharedStrings.xml");
  if (!xml) return "";
  return [...xml.toString("utf8").matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((match) => match[1]).join("\n").trim();
}

function pdfText(raw) {
  const pieces = [raw.toString("latin1")];
  const streams = raw.toString("latin1").matchAll(/stream\r?\n([\s\S]*?)endstream/g);
  for (const match of streams) {
    try {
      pieces.push(inflateRawSync(Buffer.from(match[1], "latin1")).toString("latin1"));
    } catch {
      // An uncompressed stream is already in the first piece.
    }
  }
  const words = [];
  for (const piece of pieces) {
    for (const match of piece.matchAll(/\((?:\\[nrtbf()\\]|\\[0-7]{1,3}|[^\\)]){2,}\)/g)) {
      const decoded = decodePdfString(match[0].slice(1, -1)).replace(/\s+/g, " ").trim();
      if (decoded) words.push(decoded);
    }
  }
  return words.join(" ").replace(/\s+/g, " ").trim();
}

function decodePdfString(value) {
  return value
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\[()\\]/g, (item) => item.slice(1))
    .replace(/\\([0-7]{1,3})/g, (_, octal) => String.fromCharCode(Number.parseInt(octal, 8)));
}

function unzipEntry(buffer, wanted) {
  let offset = 0;
  while (offset + 30 <= buffer.length) {
    if (buffer.readUInt32LE(offset) !== 0x04034b50) return null;
    const method = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const name = buffer.subarray(offset + 30, offset + 30 + nameLength).toString("utf8");
    const start = offset + 30 + nameLength + extraLength;
    const end = start + compressedSize;
    if (end > buffer.length) return null;
    if (name === wanted) {
      const data = buffer.subarray(start, end);
      if (method === 0) return data;
      if (method === 8) return inflateRawSync(data);
      return null;
    }
    offset = end;
  }
  return null;
}
