/** Pipe-table grid for an uploaded quote or invoice sheet. No header separator. */

export function parsePipeGrid(markdown: string): string[][] {
  const rows = markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|") && line.endsWith("|"))
    .filter((line) => {
      const inner = line.replace(/^\|/, "").replace(/\|$/, "");
      return !(/^[\s|:-]+$/.test(inner) && /[-:]/.test(inner));
    })
    .map((line) =>
      line
        .slice(1, -1)
        .split("|")
        .map((cell) => cell.trim()),
    );
  if (!rows.length) return [];
  const width = Math.max(...rows.map((row) => row.length));
  return rows.map((row) => {
    const next = row.slice();
    while (next.length < width) next.push("");
    return next;
  });
}

export function pipeGrid(rows: string[][]): string {
  const width = Math.max(0, ...rows.map((row) => row.length));
  return rows
    .map((row) => {
      const cells = row.slice(0, width);
      while (cells.length < width) cells.push("");
      return `| ${cells
        .map((cell) => cell.replace(/\|/g, "/").replace(/\r?\n/g, "‹br›").trim())
        .join(" | ")} |`;
    })
    .join("\n");
}
