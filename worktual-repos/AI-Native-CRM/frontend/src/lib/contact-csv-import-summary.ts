/** Format contact CSV import results for coworker chat — counts + duplicates/failures. */

const MAX_DETAIL_IN_CHAT = 25;

export type ContactImportFailure = {
  row: number;
  message: string;
  email?: string;
  displayName?: string;
};

export type ContactImportDuplicate = {
  row: number;
  email: string;
  phone?: string | null;
  displayName: string;
  reason: string;
};

export function formatContactImportChatSummary(result: {
  created: number;
  updated?: number;
  skipped: number;
  errors?: ContactImportFailure[];
  duplicates?: ContactImportDuplicate[];
}): string {
  const failures = result.errors ?? [];
  const duplicates = result.duplicates ?? [];
  const lines = [
    `Imported ${result.created} created, ${duplicates.length} skipped as duplicates, ${failures.length} failed.`,
  ];

  if (duplicates.length > 0) {
    lines.push("Duplicates skipped:");
    for (const dup of duplicates.slice(0, MAX_DETAIL_IN_CHAT)) {
      const who = [dup.displayName, dup.email].filter(Boolean).join(", ");
      lines.push(`• Row ${dup.row} (${who}): ${dup.reason}`);
    }
    if (duplicates.length > MAX_DETAIL_IN_CHAT) {
      lines.push(
        `• …and ${duplicates.length - MAX_DETAIL_IN_CHAT} more duplicates.`,
      );
    }
  }

  if (failures.length > 0) {
    lines.push("Failures:");
    for (const err of failures.slice(0, MAX_DETAIL_IN_CHAT)) {
      const who = [err.displayName, err.email].filter(Boolean).join(", ");
      const where = who ? `Row ${err.row} (${who})` : `Row ${err.row}`;
      lines.push(`• ${where}: ${err.message}`);
    }
    if (failures.length > MAX_DETAIL_IN_CHAT) {
      lines.push(
        `• …and ${failures.length - MAX_DETAIL_IN_CHAT} more failures.`,
      );
    }
  }

  return lines.join("\n");
}
