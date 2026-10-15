/**
 * Offline pair relatedness when ai-service is down.
 * LLM pair scoring remains the success path.
 */

import { spawnSync } from "node:child_process";

const STOP = new Set(
  `
  the a an and or of to for in on with from by as is are was were be been
  this that these those it its we our you your they their not at into about
  will shall may can should would could all any each other more most such
  per via etc including include following document pdf docx page pages
  `.split(/\s+/).filter(Boolean),
);

const FILENAME_STOP = new Set([
  "brd",
  "pdf",
  "docx",
  "doc",
  "proposal",
  "requirement",
  "requirements",
  "winning",
  "document",
  "final",
  "v1",
  "v2",
]);

const PDF_EXTRACT_SCRIPT = `
import sys
from io import BytesIO
try:
    from pypdf import PdfReader
except Exception:
    sys.exit(2)
raw = sys.stdin.buffer.read()
reader = PdfReader(BytesIO(raw))
parts = []
for page in reader.pages[:40]:
    parts.append(page.extract_text() or "")
sys.stdout.write("\\n".join(parts))
`;

export function normalizePairExtractText(text: string): string {
  return String(text || "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function tokens(text: string): Set<string> {
  const words = normalizePairExtractText(text)
    .toLowerCase()
    .match(/[a-z0-9][a-z0-9&'/-]{2,}/g);
  return new Set((words || []).filter((word) => !STOP.has(word)));
}

function filenameTokens(name: string): Set<string> {
  const stem = String(name || "")
    .replace(/\.[A-Za-z0-9]+$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ");
  return new Set(
    stem
      .split(/\s+/)
      .filter((part) => part.length >= 3 && !FILENAME_STOP.has(part)),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) return 0;
  let inter = 0;
  for (const item of a) if (b.has(item)) inter += 1;
  return inter / (a.size + b.size - inter);
}

export function lexicalPairConfidence(input: {
  requirementText: string;
  proposalText: string;
  requirementFilename?: string;
  proposalFilename?: string;
}): number {
  const content = jaccard(
    tokens(input.requirementText),
    tokens(input.proposalText),
  );
  let score = Math.min(0.95, 0.15 + content * 2.4);
  const names = jaccard(
    filenameTokens(input.requirementFilename || ""),
    filenameTokens(input.proposalFilename || ""),
  );
  if (names >= 0.5) score = Math.min(0.95, score + 0.05);
  return Math.round(score * 10000) / 10000;
}

function unescapePdfLiteral(inner: string): string {
  return inner
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\\)/g, ")")
    .replace(/\\\(/g, "(")
    .replace(/\\\\/g, "\\");
}

export function extractPdfTextLightweight(raw: Buffer): string {
  const data = raw.toString("latin1");
  const chunks: string[] = [];
  const tj = /\((?:\\.|[^\\)])*\)\s*Tj/g;
  for (const match of data.matchAll(tj)) {
    const inner = match[0].slice(1, match[0].lastIndexOf(")"));
    const text = unescapePdfLiteral(inner).trim();
    if (text) chunks.push(text);
  }
  const arrayTj = /\[(.*?)\]\s*TJ/gs;
  for (const match of data.matchAll(arrayTj)) {
    const parts = match[1].matchAll(/\((?:\\.|[^\\)])*\)/g);
    for (const part of parts) {
      const text = unescapePdfLiteral(part[0].slice(1, -1)).trim();
      if (text) chunks.push(text);
    }
  }
  return chunks.join("\n").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "").trim();
}

function extractPdfViaPython(raw: Buffer): string {
  const candidates = [
    process.env.PDF_EXTRACT_PYTHON?.trim(),
    "/usr/bin/python3",
    "python3",
  ].filter((value): value is string => Boolean(value));
  for (const py of candidates) {
    try {
      const proc = spawnSync(py, ["-c", PDF_EXTRACT_SCRIPT], {
        input: raw,
        timeout: 20_000,
        maxBuffer: 8_000_000,
        encoding: "buffer",
      });
      if (proc.status !== 0) continue;
      const text = Buffer.from(proc.stdout || []).toString("utf8").trim();
      if (text) return text;
    } catch {
      continue;
    }
  }
  return "";
}

export function extractLocalCorpusText(input: {
  filename: string;
  contentBase64: string;
}): string {
  const name = input.filename.toLowerCase();
  let raw: Buffer;
  try {
    raw = Buffer.from(input.contentBase64, "base64");
  } catch {
    return "";
  }
  if (name.endsWith(".txt") || name.endsWith(".md") || name.endsWith(".csv")) {
    return normalizePairExtractText(raw.toString("utf8"));
  }
  if (!name.endsWith(".pdf")) return "";
  const viaPython = extractPdfViaPython(raw);
  if (viaPython) return normalizePairExtractText(viaPython);
  return normalizePairExtractText(extractPdfTextLightweight(raw));
}
