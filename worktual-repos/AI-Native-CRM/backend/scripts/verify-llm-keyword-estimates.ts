import { researchSeoKeywords } from "../src/service/seo/keyword-research.ts";
import { getPrismaClient } from "../src/dao/db/prisma.ts";

process.env.SEO_KEYWORD_SOURCE = "llm";

const seed = `dmtst-llm-estimates ${Date.now()}`;
const org = "1000";

const first = await researchSeoKeywords({
  organizationId: org,
  userId: "1000",
  seed,
  location: "us",
  language: "en",
});

console.log(
  JSON.stringify(
    {
      step: "first",
      ok: first.ok,
      source: first.source,
      cacheHit: first.cacheHit,
      code: first.code,
      rows: first.rows.length,
      sample: first.rows.slice(0, 3).map((r) => ({
        term: r.term,
        volume: r.volume,
        source: r.source,
      })),
      semrushCalledAt: first.query?.semrushCalledAt ?? null,
      error: first.error,
      queryId: first.query?.id ?? null,
    },
    null,
    2,
  ),
);

let failed =
  !first.ok || first.source !== "llm" || Boolean(first.query?.semrushCalledAt);

if (!failed) {
  const second = await researchSeoKeywords({
    organizationId: org,
    userId: "1000",
    seed,
    location: "us",
    language: "en",
  });
  console.log(
    JSON.stringify(
      {
        step: "second_cache",
        ok: second.ok,
        source: second.source,
        cacheHit: second.cacheHit,
        rows: second.rows.length,
        semrushCalledAt: second.query?.semrushCalledAt ?? null,
      },
      null,
      2,
    ),
  );
  if (!second.cacheHit || second.source !== "llm") failed = true;
}

if (first.query?.id) {
  const prisma = getPrismaClient();
  await prisma.$executeRawUnsafe(
    `DELETE FROM crm.seo_saved_keywords WHERE query_id = $1`,
    first.query.id,
  );
  await prisma.$executeRawUnsafe(
    `DELETE FROM crm.seo_keyword_queries WHERE id = $1`,
    first.query.id,
  );
  console.log("cleanup", first.query.id);
}

if (failed) process.exit(1);
