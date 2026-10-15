import "./load-repo-env.js";
import { prisma } from "../src/dao/db/prisma.js";

const limit = Math.min(50, Math.max(1, Number(process.argv[2] || 10)));
const meetFilter = (process.argv[3] || "").trim().toLowerCase();

async function main() {
  const rows = await prisma.contactActivity.findMany({
    where: { type: "meeting" },
    orderBy: { dueAt: "desc" },
    take: limit,
    select: { id: true, contactId: true, dueAt: true, body: true },
  });
  for (const r of rows) {
    const link =
      (r.body || "").match(/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}/i)?.[0] || "";
    if (meetFilter && !link.toLowerCase().includes(meetFilter) && !(r.body || "").toLowerCase().includes(meetFilter)) {
      continue;
    }
    console.log([r.id, r.dueAt?.toISOString() || "", link, r.contactId].join("\t"));
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
