export type CsvTableSection = {
  title: string;
  headers: string[];
  rows: string[][];
};

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (inQuotes) {
      if (char === '"') {
        if (line[index + 1] === '"') {
          current += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  cells.push(current);
  return cells;
}

export function parseCsvTableSections(text: string): CsvTableSection[] {
  const normalized = text.replace(/^\uFEFF/, "").trim();
  if (!normalized) return [];

  const lines = normalized.split(/\r?\n/);
  const sections: CsvTableSection[] = [];
  let current: CsvTableSection | null = null;

  for (const line of lines) {
    if (!line.trim()) continue;
    const cells = parseCsvLine(line);
    const nonEmptyCells = cells.filter((cell) => cell.length > 0);

    if (nonEmptyCells.length === 1) {
      if (current && (current.headers.length > 0 || current.rows.length > 0)) {
        sections.push(current);
      }
      current = { title: cells[0] ?? "Report", headers: [], rows: [] };
      continue;
    }

    if (!current) {
      current = { title: "Report", headers: [], rows: [] };
    }

    if (current.headers.length === 0) {
      current.headers = cells;
      continue;
    }

    current.rows.push(cells);
  }

  if (current && (current.headers.length > 0 || current.rows.length > 0)) {
    sections.push(current);
  }

  return sections;
}
