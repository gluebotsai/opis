/** Minimal CSV parser: handles quoted fields and commas. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  const pushCell = () => {
    row.push(cell);
    cell = "";
  };
  const pushRow = () => {
    if (row.length === 1 && row[0] === "" && rows.length === 0) {
      row = [];
      return;
    }
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      pushCell();
      continue;
    }
    if (ch === "\n" || (ch === "\r" && next === "\n")) {
      if (ch === "\r") i++;
      pushCell();
      pushRow();
      continue;
    }
    if (ch === "\r") {
      pushCell();
      pushRow();
      continue;
    }
    cell += ch;
  }
  pushCell();
  if (row.length > 1 || (row.length === 1 && row[0] !== "")) {
    pushRow();
  }
  return rows;
}

/** Escape a value for a CSV/TSV cell (RFC 4180-ish). */
export function csvEscape(value: string | number | null | undefined): string {
  const raw = value == null ? "" : String(value);
  if (/[",\r\n]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

export type ExportTable = {
  headers: string[];
  rows: Array<Array<string | number | null | undefined>>;
};

export type ContactExportFormat = "csv" | "tsv" | "json" | "xlsx" | "txt";

export const CONTACT_EXPORT_FORMATS: Array<{
  value: ContactExportFormat;
  label: string;
  description: string;
}> = [
  {
    value: "csv",
    label: "CSV (.csv)",
    description: "Comma-separated — Excel, Sheets, Numbers",
  },
  {
    value: "xlsx",
    label: "Excel (.xls)",
    description: "Spreadsheet file for Microsoft Excel",
  },
  {
    value: "tsv",
    label: "TSV (.tsv)",
    description: "Tab-separated values",
  },
  {
    value: "json",
    label: "JSON (.json)",
    description: "Structured data for integrations",
  },
  {
    value: "txt",
    label: "Text (.txt)",
    description: "Plain text, pipe-separated",
  },
];

export function toDelimited(
  table: ExportTable,
  delimiter: "," | "\t" | " | ",
  withBom = false,
): string {
  const lines = [
    table.headers.map(csvEscape).join(delimiter),
    ...table.rows.map((row) => row.map(csvEscape).join(delimiter)),
  ];
  const body = `${lines.join("\r\n")}\r\n`;
  return withBom ? `\uFEFF${body}` : body;
}

export function toCsv(table: ExportTable): string {
  return toDelimited(table, ",", true);
}

export function toTsv(table: ExportTable): string {
  return toDelimited(table, "\t", true);
}

export function toTxt(table: ExportTable): string {
  return toDelimited(table, " | ", false);
}

export function toJson(table: ExportTable): string {
  const records = table.rows.map((row) => {
    const record: Record<string, string> = {};
    table.headers.forEach((header, index) => {
      const value = row[index];
      record[header] = value == null ? "" : String(value);
    });
    return record;
  });
  return `${JSON.stringify(records, null, 2)}\n`;
}

function xmlEscape(value: string | number | null | undefined): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Excel-compatible HTML workbook (opens in Excel / LibreOffice). */
export function toExcelHtml(
  table: ExportTable,
  sheetName = "Export",
): string {
  const safeSheet = sheetName.replace(/[\\/*?:\[\]]/g, " ").slice(0, 31) || "Export";
  const head = table.headers
    .map((h) => `<th>${xmlEscape(h)}</th>`)
    .join("");
  const body = table.rows
    .map(
      (row) =>
        `<tr>${row.map((cell) => `<td>${xmlEscape(cell)}</td>`).join("")}</tr>`,
    )
    .join("");
  return `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:x="urn:schemas-microsoft-com:office:excel"
      xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8" />
<!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet>
<x:Name>${xmlEscape(safeSheet)}</x:Name>
<x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions>
</x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->
</head>
<body>
<table border="1">
<thead><tr>${head}</tr></thead>
<tbody>${body}</tbody>
</table>
</body>
</html>
`;
}

export function buildExportFile(
  format: ContactExportFormat,
  table: ExportTable,
  baseName: string,
  sheetName?: string,
): { content: string; filename: string; mimeType: string } {
  switch (format) {
    case "tsv":
      return {
        content: toTsv(table),
        filename: `${baseName}.tsv`,
        mimeType: "text/tab-separated-values;charset=utf-8",
      };
    case "json":
      return {
        content: toJson(table),
        filename: `${baseName}.json`,
        mimeType: "application/json;charset=utf-8",
      };
    case "xlsx":
      return {
        content: toExcelHtml(table, sheetName ?? baseName),
        filename: `${baseName}.xls`,
        mimeType: "application/vnd.ms-excel;charset=utf-8",
      };
    case "txt":
      return {
        content: toTxt(table),
        filename: `${baseName}.txt`,
        mimeType: "text/plain;charset=utf-8",
      };
    case "csv":
    default:
      return {
        content: toCsv(table),
        filename: `${baseName}.csv`,
        mimeType: "text/csv;charset=utf-8",
      };
  }
}

export function downloadFile(
  filename: string,
  content: string,
  mimeType: string,
) {
  const g = globalThis as typeof globalThis & {
    document?: {
      createElement: (tag: string) => {
        href: string;
        download: string;
        rel: string;
        click: () => void;
        remove: () => void;
      };
      body: { appendChild: (node: unknown) => void };
    };
  };
  if (!g.document) {
    throw new Error("downloadFile is browser-only");
  }
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = g.document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  g.document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/** @deprecated Prefer downloadFile */
export function downloadCsvFile(filename: string, csv: string) {
  downloadFile(filename, csv, "text/csv;charset=utf-8");
}
