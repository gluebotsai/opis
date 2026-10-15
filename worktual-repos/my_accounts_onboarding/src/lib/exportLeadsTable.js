import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";

import { formatOversightCurrency, formatOversightDate } from "./salesOversight.js";

export const LEAD_EXPORT_FORMATS = [
  { id: "excel", label: "Excel (.xlsx)", extension: "xlsx" },
  { id: "csv", label: "CSV (.csv)", extension: "csv" },
  { id: "pdf", label: "PDF (.pdf)", extension: "pdf" },
  { id: "docs", label: "Docs (.doc)", extension: "doc" },
];

export const LEAD_EXPORT_SCOPES = [
  { id: "page", label: "Current page" },
  { id: "filtered", label: "Filtered results" },
  { id: "all", label: "All leads for this agent" },
];

export const LEAD_TABLE_COLUMNS = [
  { id: "company", label: "Company", alwaysVisible: true },
  { id: "status", label: "Status" },
  { id: "assigned", label: "Assigned" },
  { id: "lastActivity", label: "Last activity" },
  { id: "quotedProducts", label: "Quoted products" },
  { id: "purchased", label: "Purchased" },
  { id: "productsBought", label: "Products bought" },
  { id: "revenue", label: "Revenue" },
  { id: "actions", label: "Actions", alwaysVisible: true, exportable: false },
];

export const DEFAULT_VISIBLE_COLUMNS = LEAD_TABLE_COLUMNS.map((column) => column.id);

export const STALE_LEAD_DAYS = 14;

function columnStorageKey(role) {
  return `sa-agent-detail-columns:${role || "default"}`;
}

export function loadVisibleColumns(role) {
  try {
    const raw = window.localStorage.getItem(columnStorageKey(role));
    if (!raw) {
      return [...DEFAULT_VISIBLE_COLUMNS];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [...DEFAULT_VISIBLE_COLUMNS];
    }
    const allowed = new Set(LEAD_TABLE_COLUMNS.map((column) => column.id));
    const next = parsed.filter((id) => allowed.has(id));
    for (const column of LEAD_TABLE_COLUMNS) {
      if (column.alwaysVisible && !next.includes(column.id)) {
        next.push(column.id);
      }
    }
    return next.length ? next : [...DEFAULT_VISIBLE_COLUMNS];
  } catch {
    return [...DEFAULT_VISIBLE_COLUMNS];
  }
}

export function saveVisibleColumns(role, columnIds) {
  const allowed = new Set(LEAD_TABLE_COLUMNS.map((column) => column.id));
  const next = columnIds.filter((id) => allowed.has(id));
  for (const column of LEAD_TABLE_COLUMNS) {
    if (column.alwaysVisible && !next.includes(column.id)) {
      next.push(column.id);
    }
  }
  window.localStorage.setItem(columnStorageKey(role), JSON.stringify(next));
  return next;
}

function exportableColumns(visibleColumnIds) {
  const visible = new Set(visibleColumnIds || DEFAULT_VISIBLE_COLUMNS);
  return LEAD_TABLE_COLUMNS.filter(
    (column) => column.exportable !== false && visible.has(column.id),
  );
}

function cellValue(lead, columnId) {
  switch (columnId) {
    case "company":
      return lead.companyName || lead.domainId || "";
    case "status":
      return lead.status || "";
    case "assigned":
      return formatOversightDate(lead.assignedAt);
    case "lastActivity":
      return formatOversightDate(lead.lastActivityAt);
    case "quotedProducts":
      return (lead.quotedProducts || []).join("; ");
    case "purchased":
      return lead.purchased ? "Yes" : "No";
    case "productsBought":
      return (lead.purchasedProducts || []).join("; ");
    case "revenue":
      return lead.revenue ? formatOversightCurrency(lead.revenue) : "—";
    default:
      return "";
  }
}

function buildLeadRows(leads, columns) {
  return leads.map((lead) => columns.map((column) => cellValue(lead, column.id)));
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function buildHtmlTable(title, leads, columns) {
  const headers = columns.map((column) => column.label);
  const rows = buildLeadRows(leads, columns);
  const headerCells = headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("");
  const bodyRows = rows
    .map(
      (row) =>
        `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`,
    )
    .join("");

  return `
    <table border="1" cellspacing="0" cellpadding="6">
      <caption><strong>${escapeHtml(title)}</strong></caption>
      <thead><tr>${headerCells}</tr></thead>
      <tbody>${bodyRows}</tbody>
    </table>
  `;
}

function exportCsv(leads, fileBase, columns) {
  const headers = columns.map((column) => column.label);
  const rows = buildLeadRows(leads, columns);
  const csv = [headers, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(","))
    .join("\n");
  downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), `${fileBase}.csv`);
}

function exportExcel(leads, fileBase, columns) {
  const headers = columns.map((column) => column.label);
  const rows = buildLeadRows(leads, columns);
  const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Leads");
  XLSX.writeFile(workbook, `${fileBase}.xlsx`);
}

function exportDocs(leads, fileBase, title, columns) {
  const html = `
    <html xmlns:o="urn:schemas-microsoft-com:office:office"
          xmlns:w="urn:schemas-microsoft-com:office:word"
          xmlns="http://www.w3.org/TR/REC-html40">
      <head><meta charset="UTF-8" /><title>${escapeHtml(title)}</title></head>
      <body>
        <h1>${escapeHtml(title)}</h1>
        ${buildHtmlTable(title, leads, columns)}
      </body>
    </html>
  `;
  downloadBlob(new Blob([html], { type: "application/msword;charset=utf-8" }), `${fileBase}.doc`);
}

function exportPdf(leads, fileBase, title, columns) {
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  doc.setFontSize(14);
  doc.text(title, 40, 36);
  autoTable(doc, {
    startY: 48,
    head: [columns.map((column) => column.label)],
    body: buildLeadRows(leads, columns),
    styles: { fontSize: 8, cellPadding: 4 },
    headStyles: { fillColor: [124, 58, 237] },
  });
  doc.save(`${fileBase}.pdf`);
}

function formatFileTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return (
    [date.getFullYear(), pad(date.getMonth() + 1), pad(date.getDate())].join("-") +
    "_" +
    [pad(date.getHours()), pad(date.getMinutes()), pad(date.getSeconds())].join("-")
  );
}

export function isLeadStale(lead, staleDays = STALE_LEAD_DAYS) {
  const activity = lead?.lastActivityAt || lead?.assignedAt;
  if (!activity) {
    return true;
  }
  const timestamp = new Date(activity).getTime();
  if (!Number.isFinite(timestamp)) {
    return true;
  }
  const ageMs = Date.now() - timestamp;
  return ageMs >= staleDays * 24 * 60 * 60 * 1000;
}

export function exportLeadsTable(
  formatId,
  leads,
  { agentName = "agent", visibleColumnIds = DEFAULT_VISIBLE_COLUMNS } = {},
) {
  const columns = exportableColumns(visibleColumnIds);
  const safeName =
    String(agentName || "agent")
      .trim()
      .replace(/[^\w.-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase() || "agent";
  const timestamp = formatFileTimestamp();
  const fileBase = `${safeName}-leads-${timestamp}`;
  const title = `${agentName || "Agent"} — Assigned leads`;
  const extension =
    LEAD_EXPORT_FORMATS.find((format) => format.id === formatId)?.extension || "csv";
  const fileName = `${fileBase}.${extension}`;

  switch (formatId) {
    case "excel":
      exportExcel(leads, fileBase, columns);
      break;
    case "pdf":
      exportPdf(leads, fileBase, title, columns);
      break;
    case "docs":
      exportDocs(leads, fileBase, title, columns);
      break;
    case "csv":
    default:
      exportCsv(leads, fileBase, columns);
      break;
  }

  return { fileName, rowCount: leads.length, formatId };
}
