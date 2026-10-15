import fs from "node:fs";

const schema = fs.readFileSync(
  new URL("../prisma/schema.prisma", import.meta.url),
  "utf8",
);

const enums = {};
const enumRe = /enum (\w+) \{([^}]+)\}/g;
let m;
while ((m = enumRe.exec(schema))) {
  const vals = m[2]
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("@@") && !l.startsWith("//") && !l.startsWith("///"));
  enums[m[1]] = vals;
}

const models = [];
const modelRe = /model (\w+) \{([\s\S]*?)\n\}/g;
while ((m = modelRe.exec(schema))) {
  const body = m[2];
  const map = /@@map\("([^"]+)"\)/.exec(body);
  const sch = /@@schema\("([^"]+)"\)/.exec(body);
  if (!map || !sch) continue;
  const fields = [];
  for (const line of body.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("//") || t.startsWith("///") || t.startsWith("@@")) continue;
    const fm = t.match(/^(\w+)\s+(\w+)(\?)?/);
    if (!fm) continue;
    const enumName = fm[2];
    if (enums[enumName]) {
      const col = /@map\("([^"]+)"\)/.exec(t);
      fields.push({
        column: col ? col[1] : camelToSnake(fm[1]),
        enumName,
        values: enums[enumName],
      });
    }
  }
  models.push({
    model: m[1],
    schema: sch[1],
    table: map[1],
    fields,
  });
}

function camelToSnake(s) {
  return s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`).replace(/^_/, "");
}

const lines = [];
for (const model of models) {
  for (const f of model.fields) {
    lines.push({
      key: `${model.schema}.${model.table}.${f.column}`,
      values: f.values,
      enumName: f.enumName,
    });
  }
}
lines.sort((a, b) => a.key.localeCompare(b.key));

console.log(
  JSON.stringify(
    {
      models: models.map((x) => `${x.schema}.${x.table}`),
      enums: lines,
    },
    null,
    2,
  ),
);
