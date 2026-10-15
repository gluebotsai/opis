import fs from "node:fs";
const md = fs.readFileSync(
  new URL("../docs/reports-analytics-spoke/01-database-schema.md", import.meta.url),
  "utf8",
);
const purposes = {};
const parts = md.split(/^### /m).slice(1);
for (const part of parts) {
  const lines = part.split("\n");
  const title = lines[0].trim();
  const body = [];
  for (const line of lines.slice(2)) {
    if (line.startsWith("Primary key:") || line.startsWith("Columns:") || line.startsWith("Columns CRM") || line.startsWith("Foreign keys")) break;
    if (line.startsWith("Prisma model")) continue;
    body.push(line);
  }
  purposes[title] = body.join("\n").trim();
}
fs.writeFileSync(
  new URL("./schema-table-purposes.json", import.meta.url),
  JSON.stringify(purposes, null, 2),
);
console.log(Object.keys(purposes).length);
