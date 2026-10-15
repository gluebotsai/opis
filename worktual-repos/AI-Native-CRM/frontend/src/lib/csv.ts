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

export function downloadFile(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
