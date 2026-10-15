import type { AgentToolProposal } from "@/services/coworker";
import { contactCsvSample } from "@/lib/contact-csv-import";
import { formatContactImportChatSummary } from "@/lib/contact-csv-import-summary";
import { importContactsCsv } from "@/services/contacts";

function normalizeHeader(line: string): string {
  return line.toLowerCase().replace(/[\s_\-]+/g, "");
}

function headerLooksLikeContactCsv(line: string): boolean {
  if (!/[,;\t]/.test(line)) return false;
  const norm = normalizeHeader(line);
  const hasEmail = norm.includes("email");
  const hasName =
    norm.includes("firstname") ||
    norm.includes("lastname") ||
    norm.includes("fullname") ||
    norm.includes("fname") ||
    norm.includes("lname") ||
    norm.includes("name");
  return hasEmail && hasName;
}

/** Extract CSV body from chat text (attachment intro + pasted rows). */
export function extractContactCsvFromChatText(text: string): string | null {
  let raw = (text || "").trim();
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  const lines = raw.split(/\r?\n/).filter((ln) => ln.trim());
  if (lines.length < 2) return null;
  let start = -1;
  for (let i = 0; i < lines.length - 1; i += 1) {
    if (headerLooksLikeContactCsv(lines[i]!)) {
      start = i;
      break;
    }
  }
  if (start < 0) return null;
  const body = lines.slice(start).join("\n").trim();
  return body.includes("\n") ? `${body}\n` : null;
}

/**
 * Run chat propose_import_contacts via Fastify (form-owned write).
 */
export async function runContactImportCoworkerTool(
  tool: AgentToolProposal,
  opts: {
    businessType?: string | null;
    lastUserText?: string;
  },
): Promise<true | false | string> {
  if (tool.name !== "propose_import_contacts") return false;

  let pasted = String(tool.args.csvText || tool.args.csv || "").trim();
  if (!pasted && opts.lastUserText) {
    pasted = extractContactCsvFromChatText(opts.lastUserText) || "";
  }
  const useSample =
    !pasted &&
    (tool.args.sample === true || String(tool.args.sample || "").toLowerCase() === "true");
  const csvText =
    pasted || (useSample ? contactCsvSample(opts.businessType) : "");
  if (!csvText) {
    return "Paste a CSV, attach a .csv file, or say import this sample.";
  }
  try {
    const result = await importContactsCsv({ csvText });
    if (!result.ok) return result.error || "Import failed.";
    return formatContactImportChatSummary(result);
  } catch {
    return "Import failed — try again or use Import CSV on the list.";
  }
}
