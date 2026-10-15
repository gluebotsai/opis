import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

import { pool } from "./db/pool.js";
import { isOrgAdminCustomer } from "./customerAuth.js";
import * as repo from "./repositories/raw/setupKnowledge.repo.js";

export const KNOWLEDGE_CATEGORIES = {
  business: "Business Knowledge",
  product: "Product Knowledge",
  customer_support: "Customer Support Knowledge",
};

const ALLOWED_EXTENSIONS = new Set([
  ".pdf",
  ".doc",
  ".docx",
  ".txt",
  ".csv",
  ".xls",
  ".xlsx",
]);

const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/csv",
  "application/csv",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/octet-stream",
]);

export const KNOWLEDGE_MAX_BYTES = 15 * 1024 * 1024;

const UPLOAD_ROOT = path.resolve(process.cwd(), "uploads", "knowledge");

function assertOrgAdmin(customerUser) {
  if (!isOrgAdminCustomer(customerUser)) {
    const error = new Error("Only company admins can manage the knowledge base.");
    error.statusCode = 403;
    throw error;
  }
}

function normalizeCategory(value) {
  const key = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
  if (key === "customer-support" || key === "support") return "customer_support";
  if (KNOWLEDGE_CATEGORIES[key]) return key;
  return null;
}

function extensionOf(fileName = "") {
  const ext = path.extname(String(fileName)).toLowerCase();
  return ext;
}

function fileTypeLabel(fileName = "", mimeType = "") {
  const ext = extensionOf(fileName).replace(".", "").toUpperCase();
  if (ext === "DOCX" || ext === "DOC") return ext;
  if (ext === "XLSX" || ext === "XLS") return ext;
  if (ext) return ext;
  if (mimeType.includes("pdf")) return "PDF";
  return "FILE";
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(value < 10 * 1024 ? 1 : 0)} KB`;
  return `${(value / (1024 * 1024)).toFixed(value < 10 * 1024 * 1024 ? 1 : 1)} MB`;
}

function formatUploadedOn(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function parseAssignedBranchIds(raw) {
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
    } catch {
      return raw
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);
    }
  }
  return [];
}

function mapDocument(row, branchNameById = new Map()) {
  const allBranches = Boolean(row.all_branches);
  const assignedBranchIds = Array.isArray(row.assigned_branch_ids)
    ? row.assigned_branch_ids.map(String)
    : [];

  let assignedBranches = [];
  if (allBranches) {
    assignedBranches = ["All Branches"];
  } else {
    assignedBranches = assignedBranchIds.map(
      (id) => branchNameById.get(id) || id,
    );
  }

  return {
    id: row.id,
    category: row.category,
    categoryLabel: KNOWLEDGE_CATEGORIES[row.category] || row.category,
    fileName: row.file_name,
    fileType: row.file_type,
    fileSizeBytes: Number(row.file_size_bytes) || 0,
    fileSize: formatBytes(row.file_size_bytes),
    allBranches,
    assignedBranchIds,
    assignedBranches,
    uploadedAt: row.created_at,
    uploadedOn: formatUploadedOn(row.created_at),
  };
}

async function loadBranchNameMap(organizationId) {
  const { rows } = await pool.query(
    `SELECT id, label FROM organization_locations WHERE organization_id = $1`,
    [organizationId],
  );
  return new Map(rows.map((row) => [String(row.id), row.label || row.id]));
}

export async function listKnowledgeDocuments(organizationId, category) {
  const normalized = category ? normalizeCategory(category) : null;
  if (category && !normalized) {
    const error = new Error("Invalid knowledge category.");
    error.statusCode = 400;
    throw error;
  }

  const rows = await repo.listDocuments(pool, organizationId, normalized);
  const branchNames = await loadBranchNameMap(organizationId);
  return rows.map((row) => mapDocument(row, branchNames));
}

export async function uploadKnowledgeDocument(customerUser, fields, file) {
  assertOrgAdmin(customerUser);

  const category = normalizeCategory(fields?.category);
  if (!category) {
    const error = new Error("Knowledge category is required.");
    error.statusCode = 400;
    throw error;
  }

  if (!file?.buffer && !file?.path) {
    const error = new Error("A file is required.");
    error.statusCode = 400;
    throw error;
  }

  const originalName = String(file.originalname || fields.fileName || "document").trim();
  const ext = extensionOf(originalName);
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    const error = new Error("Unsupported file type. Use PDF, DOCX, TXT, CSV, or Excel.");
    error.statusCode = 400;
    throw error;
  }

  if (file.mimetype && !ALLOWED_MIME_TYPES.has(file.mimetype)) {
    const error = new Error("Unsupported file type. Use PDF, DOCX, TXT, CSV, or Excel.");
    error.statusCode = 400;
    throw error;
  }

  const size = Number(file.size || file.buffer?.length || 0);
  if (!size) {
    const error = new Error("Uploaded file is empty.");
    error.statusCode = 400;
    throw error;
  }
  if (size > KNOWLEDGE_MAX_BYTES) {
    const error = new Error("File exceeds the 15MB limit.");
    error.statusCode = 400;
    throw error;
  }

  const allBranches =
    String(fields?.allBranches || "").toLowerCase() === "true" ||
    fields?.allBranches === true;
  const assignedBranchIds = allBranches ? [] : parseAssignedBranchIds(fields?.assignedBranchIds);

  if (!allBranches && !assignedBranchIds.length) {
    const error = new Error("Select at least one branch, or choose All Branches.");
    error.statusCode = 400;
    throw error;
  }

  if (!allBranches) {
    const branchNames = await loadBranchNameMap(customerUser.organizationId);
    for (const branchId of assignedBranchIds) {
      if (!branchNames.has(String(branchId))) {
        const error = new Error(`Unknown branch: ${branchId}`);
        error.statusCode = 400;
        throw error;
      }
    }
  }

  const orgDir = path.join(UPLOAD_ROOT, String(customerUser.organizationId));
  await fs.mkdir(orgDir, { recursive: true });

  const safeBase = originalName.replace(/[^\w.\-()+ ]+/g, "_").slice(0, 180) || "document";
  const storedName = `${crypto.randomUUID()}-${safeBase}`;
  const storagePath = path.join(orgDir, storedName);

  if (file.buffer) {
    await fs.writeFile(storagePath, file.buffer);
  } else {
    await fs.copyFile(file.path, storagePath);
    await fs.unlink(file.path).catch(() => {});
  }

  const row = await repo.insertDocument(pool, {
    organizationId: customerUser.organizationId,
    category,
    fileName: originalName,
    fileType: fileTypeLabel(originalName, file.mimetype),
    fileSizeBytes: size,
    storagePath,
    allBranches,
    assignedBranchIds,
    uploadedBy: customerUser.customerUserId || null,
  });

  const branchNames = await loadBranchNameMap(customerUser.organizationId);
  return mapDocument(row, branchNames);
}

export async function removeKnowledgeDocument(customerUser, documentId) {
  assertOrgAdmin(customerUser);
  const row = await repo.selectDocument(pool, customerUser.organizationId, documentId);
  if (!row) {
    const error = new Error("Document not found.");
    error.statusCode = 404;
    throw error;
  }

  await repo.deleteDocument(pool, customerUser.organizationId, documentId);
  if (row.storage_path) {
    await fs.unlink(row.storage_path).catch(() => {});
  }
}
