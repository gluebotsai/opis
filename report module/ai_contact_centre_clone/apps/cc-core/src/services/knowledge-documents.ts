import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

import type { DbClient } from "../lib/rls.js";

const DEFAULT_UPLOAD_ROOT = resolve(process.cwd(), "uploads", "knowledge");

function resolveKnowledgeFilePath(storagePath: string): string {
  const trimmed = storagePath.trim();
  if (!trimmed) {
    throw new Error("Document storage_path is empty");
  }
  if (isAbsolute(trimmed)) {
    return trimmed;
  }
  const uploadRoot = process.env.KNOWLEDGE_UPLOAD_ROOT?.trim() || DEFAULT_UPLOAD_ROOT;
  return resolve(uploadRoot, trimmed.replace(/^uploads\/knowledge\/?/, ""));
}

export type KnowledgeSnippet = {
  documentId: string;
  title: string;
  fileName: string;
  text: string;
  tokenEstimate: number;
};

const MAX_TOTAL_CHARS = 12_000;

export async function listOrganizationKnowledge(
  db: DbClient,
  organizationId: string,
): Promise<KnowledgeSnippet[]> {
  const rows = await db.$queryRaw<
    Array<{
      document_id: string;
      file_name: string;
      category: string;
      extracted_text: string;
      token_estimate: number;
    }>
  >`
    SELECT
      d.id AS document_id,
      d.file_name,
      d.category,
      COALESCE(t.extracted_text, '') AS extracted_text,
      COALESCE(t.token_estimate, 0) AS token_estimate
    FROM accounts.setup_knowledge_documents d
    LEFT JOIN accounts.setup_knowledge_document_texts t
      ON t.document_id = d.id
    WHERE d.organization_id = ${organizationId}::bigint
    ORDER BY d.created_at DESC
    LIMIT 50
  `;

  const snippets: KnowledgeSnippet[] = [];
  let used = 0;
  for (const row of rows) {
    const text = row.extracted_text.trim();
    if (!text) continue;
    const chunk = text.slice(0, 1500);
    if (used + chunk.length > MAX_TOTAL_CHARS) break;
    snippets.push({
      documentId: row.document_id,
      title: row.category?.trim() || row.file_name,
      fileName: row.file_name,
      text: chunk,
      tokenEstimate: row.token_estimate,
    });
    used += chunk.length;
  }
  return snippets;
}

export async function upsertKnowledgeDocumentText(
  db: DbClient,
  organizationId: string,
  documentId: string,
  extractedText: string,
  extractionStatus: "pending" | "done" | "failed" = "done",
): Promise<void> {
  const tokenEstimate = Math.ceil(extractedText.length / 4);
  await db.$executeRaw`
    INSERT INTO accounts.setup_knowledge_document_texts (
      organization_id, document_id, extracted_text, token_estimate, extraction_status, updated_at
    ) VALUES (
      ${organizationId}::bigint,
      ${documentId}::bigint,
      ${extractedText},
      ${tokenEstimate},
      ${extractionStatus},
      NOW()
    )
    ON CONFLICT (document_id) DO UPDATE SET
      extracted_text = EXCLUDED.extracted_text,
      token_estimate = EXCLUDED.token_estimate,
      extraction_status = EXCLUDED.extraction_status,
      updated_at = NOW()
  `;
}

export async function extractKnowledgeDocumentText(
  db: DbClient,
  organizationId: string,
  documentId: string,
): Promise<{ documentId: string; tokenEstimate: number; extractionStatus: "done" | "failed" }> {
  const rows = await db.$queryRaw<
    Array<{
      document_id: string;
      file_name: string;
      storage_path: string;
    }>
  >`
    SELECT id AS document_id, file_name, storage_path
    FROM accounts.setup_knowledge_documents
    WHERE organization_id = ${organizationId}::bigint
      AND id = ${documentId}::bigint
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) {
    throw new Error(`Knowledge document ${documentId} not found`);
  }

  try {
    const filePath = resolveKnowledgeFilePath(row.storage_path);
    const buffer = await readFile(filePath);
    const extractedText = extractPlainTextFromBuffer(row.file_name, buffer);
    await upsertKnowledgeDocumentText(
      db,
      organizationId,
      row.document_id,
      extractedText,
      extractedText ? "done" : "failed",
    );
    return {
      documentId: row.document_id,
      tokenEstimate: Math.ceil(extractedText.length / 4),
      extractionStatus: extractedText ? "done" : "failed",
    };
  } catch {
    await upsertKnowledgeDocumentText(db, organizationId, row.document_id, "", "failed");
    return {
      documentId: row.document_id,
      tokenEstimate: 0,
      extractionStatus: "failed",
    };
  }
}

export async function backfillMissingKnowledgeDocumentTexts(
  db: DbClient,
  organizationId?: string,
): Promise<{ processed: number; extracted: number; failed: number }> {
  const rows = await db.$queryRaw<
    Array<{ document_id: string; organization_id: string }>
  >`
    SELECT d.id AS document_id, d.organization_id
    FROM accounts.setup_knowledge_documents d
    LEFT JOIN accounts.setup_knowledge_document_texts t ON t.document_id = d.id
    WHERE (${organizationId ?? null}::bigint IS NULL OR d.organization_id = ${organizationId ?? null}::bigint)
      AND (
        t.document_id IS NULL
        OR t.extraction_status = 'pending'
        OR COALESCE(NULLIF(trim(t.extracted_text), ''), '') = ''
      )
    ORDER BY d.created_at ASC
    LIMIT 200
  `;

  let extracted = 0;
  let failed = 0;
  for (const row of rows) {
    const result = await extractKnowledgeDocumentText(db, row.organization_id, row.document_id);
    if (result.extractionStatus === "done") {
      extracted += 1;
    } else {
      failed += 1;
    }
  }
  return { processed: rows.length, extracted, failed };
}

export function extractPlainTextFromBuffer(
  fileName: string,
  buffer: Buffer,
): string {
  const lower = fileName.toLowerCase();
  const raw = buffer.toString("utf8");
  if (lower.endsWith(".md") || lower.endsWith(".txt") || lower.endsWith(".csv")) {
    return raw.trim();
  }
  if (lower.endsWith(".json")) {
    try {
      return JSON.stringify(JSON.parse(raw), null, 2).slice(0, 50_000);
    } catch {
      return raw.trim().slice(0, 50_000);
    }
  }
  return raw.replace(/[^\x09\x0A\x0D\x20-\x7E]/g, " ").replace(/\s+/g, " ").trim().slice(0, 50_000);
}
