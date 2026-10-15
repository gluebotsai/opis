/**
 * Digital Marketing flow check. Never calls Semrush live.
 * Cache is seeded first; /keywords/research must return cacheHit.
 */
import pg from "pg";
import {
  SESSION_COOKIE_NAME,
  signSessionUserId,
} from "../src/service/account/session-crypto.ts";
import {
  deleteSeoGeneratedContent,
  saveSeoGeneratedContent,
  upsertSeoKeywordQuery,
  upsertSeoSocialPost,
} from "../src/dao/seo/seo-store.ts";
import { getPrismaClient } from "../src/dao/db/prisma.ts";
import { keywordCacheKey } from "../src/service/seo/keyword-cache.ts";
import { researchSeoKeywords } from "../src/service/seo/keyword-research.ts";

const API = process.env.E2E_API_BASE || "http://127.0.0.1:4000";
const TAG = `dmtst-${Date.now()}`;
const SEED = `${TAG} conversational chatbot`;

type Check = { name: string; ok: boolean; detail: string };
const checks: Check[] = [];
function rec(name: string, ok: boolean, detail: string) {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${detail}`);
}

async function http(
  method: string,
  path: string,
  cookie: string,
  body?: unknown,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Cookie: `${SESSION_COOKIE_NAME}=${cookie}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(12_000),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, json };
}

function dataOf(json: Record<string, unknown>): Record<string, unknown> {
  return (json.data && typeof json.data === "object"
    ? json.data
    : json) as Record<string, unknown>;
}

async function main() {
  const account = new pg.Client({
    connectionString:
      process.env.ACCOUNT_DATABASE_URL || process.env.DATABASE_URL,
  });
  await account.connect();
  const u = await account.query(
    `
    SELECT u.id::text AS id, u.organization_id::text AS org_id
    FROM accounts.setup_users u
    JOIN accounts.setup_user_product_access a
      ON a.user_id = u.id AND a.product_id = 'crm'
    JOIN accounts.setup_roles r ON r.id = a.role_id
    WHERE u.status = 'active'
      AND u.organization_id = 1000
      AND lower(r.name) IN ('admin', 'sales_manager', 'marketing')
    ORDER BY u.id
    LIMIT 1
    `,
  );
  await account.end();
  const user = u.rows[0] as { id?: string; org_id?: string } | undefined;
  if (!user?.id || !user.org_id) {
    rec("session-user", false, "no active CRM user on org 1000");
    process.exit(1);
  }
  const orgId = user.org_id;
  const cookie = signSessionUserId(user.id);
  rec("session-user", true, `org=${orgId} user=${user.id}`);

  const me = await http("GET", "/api/auth/me", cookie);
  rec("auth/me", me.status === 200, `status=${me.status}`);
  if (me.status !== 200) process.exit(1);

  const keywords0 = await http("GET", "/api/seo/keywords", cookie);
  rec(
    "GET /api/seo/keywords",
    keywords0.status === 200,
    `status=${keywords0.status} rows=${Array.isArray(dataOf(keywords0.json).rows) ? (dataOf(keywords0.json).rows as unknown[]).length : "?"}`,
  );

  const content0 = await http("GET", "/api/seo/content?limit=5", cookie);
  rec("GET /api/seo/content", content0.status === 200, `status=${content0.status}`);

  const social0 = await http("GET", "/api/seo/social", cookie);
  rec("GET /api/seo/social", social0.status === 200, `status=${social0.status}`);

  const conns = await http("GET", "/api/seo/social-connections", cookie);
  const platforms = (dataOf(conns.json).platforms || []) as Array<{
    platform: string;
    connected: boolean;
    needsReauth: boolean;
  }>;
  rec(
    "GET /api/seo/social-connections",
    conns.status === 200 && platforms.length === 3,
    JSON.stringify(platforms.map((p) => `${p.platform}:${p.connected ? "on" : "off"}`)),
  );

  const cacheKey = keywordCacheKey({
    organizationId: orgId,
    seed: SEED,
    location: "us",
    language: "en",
  });
  const query = await upsertSeoKeywordQuery({
    organizationId: orgId,
    userId: user.id,
    seed: SEED,
    location: "us",
    language: "en",
    filters: {},
    cacheKey,
    semrushCalledAt: null,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    payload: [
      {
        term: "conversational chatbot",
        intent: "informational",
        volume: 2900,
        kd: 12,
        cpc: 1.2,
        competition: 0.4,
        opportunity: 72,
      },
      {
        term: "ai chatbot for business",
        intent: "commercial",
        volume: 880,
        kd: 28,
        cpc: 4.1,
        competition: 0.6,
        opportunity: 61,
      },
    ],
    error: null,
  });
  rec("seed keyword cache", Boolean(query?.id), query?.id || "no query");
  if (!query?.id) process.exit(1);

  const cached = await researchSeoKeywords({
    organizationId: orgId,
    userId: user.id,
    seed: SEED,
    location: "us",
    language: "en",
    filters: { intent: "commercial" },
  });
  rec(
    "in-process cache-hit research (no Semrush)",
    cached.ok && cached.cacheHit && cached.rows.length === 1,
    `ok=${cached.ok} cacheHit=${cached.cacheHit} rows=${cached.rows.length} calledAt=${cached.query?.semrushCalledAt}`,
  );
  if (!cached.cacheHit) {
    rec("abort", false, "cache miss would call Semrush — stopped");
    process.exit(1);
  }

  const researched = await http("POST", "/api/seo/keywords/research", cookie, {
    seed: SEED,
    location: "us",
    language: "en",
  });
  const rdata = dataOf(researched.json);
  rec(
    "POST /keywords/research cacheHit",
    researched.status === 200 &&
      rdata.cacheHit === true &&
      rdata.ok === true &&
      Array.isArray(rdata.rows),
    `status=${researched.status} cacheHit=${rdata.cacheHit} ok=${rdata.ok} rows=${Array.isArray(rdata.rows) ? (rdata.rows as unknown[]).length : 0}`,
  );

  const listed = await http(
    "GET",
    `/api/seo/keywords?queryId=${encodeURIComponent(query.id)}&intent=informational`,
    cookie,
  );
  const ldata = dataOf(listed.json);
  rec(
    "GET keywords filter intent",
    listed.status === 200 &&
      Array.isArray(ldata.rows) &&
      (ldata.rows as unknown[]).length === 1,
    `rows=${Array.isArray(ldata.rows) ? (ldata.rows as unknown[]).length : 0}`,
  );

  const saved = await http("POST", "/api/seo/keywords/save", cookie, {
    queryId: query.id,
    term: "conversational chatbot",
    metrics: { volume: 2900, kd: 12 },
  });
  rec("POST /keywords/save", saved.status === 201 || saved.status === 200, `status=${saved.status}`);

  const content = await saveSeoGeneratedContent({
    organizationId: orgId,
    userId: user.id,
    contentType: "package",
    title: `${TAG} test article`,
    slug: TAG,
    body: { markdown: "Local test article. Not from Semrush." },
    status: "draft",
    primaryKeyword: "conversational chatbot",
    keywordQueryId: query.id,
  });
  rec("save content with keywordQueryId", Boolean(content?.id), content?.id || "none");
  if (!content?.id) process.exit(1);

  const contentGet = await http("GET", `/api/seo/content/${content.id}`, cookie);
  rec("GET /api/seo/content/:id", contentGet.status === 200, `status=${contentGet.status}`);

  const post = await upsertSeoSocialPost({
    organizationId: orgId,
    userId: user.id,
    contentId: content.id,
    platform: "linkedin",
    postType: "feed",
    copy: { caption: `${TAG} draft caption` },
    status: "draft",
  });
  rec("insert linkedin draft", Boolean(post?.id), post?.id || "none");
  if (!post?.id) process.exit(1);

  const fbPost = await upsertSeoSocialPost({
    organizationId: orgId,
    userId: user.id,
    contentId: content.id,
    platform: "facebook",
    copy: { caption: `${TAG} facebook` },
    status: "draft",
  });
  await upsertSeoSocialPost({
    organizationId: orgId,
    userId: user.id,
    contentId: content.id,
    platform: "instagram",
    copy: { caption: `${TAG} instagram` },
    status: "draft",
  });

  const socialList = await http(
    "GET",
    `/api/seo/social?contentId=${encodeURIComponent(content.id)}`,
    cookie,
  );
  const sitems = (dataOf(socialList.json).items || []) as unknown[];
  rec(
    "GET social for content",
    socialList.status === 200 && sitems.length === 3,
    `n=${sitems.length}`,
  );

  const patched = await http("PATCH", `/api/seo/social/${post.id}`, cookie, {
    copy: { caption: `${TAG} edited caption` },
  });
  rec("PATCH social caption", patched.status === 200, `status=${patched.status}`);

  const when = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const scheduled = await http("POST", `/api/seo/social/${post.id}/schedule`, cookie, {
    scheduledAt: when,
  });
  rec("POST social schedule", scheduled.status === 200, `status=${scheduled.status}`);

  const li = platforms.find((p) => p.platform === "linkedin");
  rec(
    "LinkedIn live publish skipped",
    true,
    li?.connected
      ? "connected — would post for real, skipped"
      : "not connected",
  );
  const fb = platforms.find((p) => p.platform === "facebook");
  if (fb?.connected || !fbPost?.id) {
    rec(
      "POST facebook publish skipped",
      Boolean(fbPost?.id),
      fb?.connected ? "Facebook is connected" : "no facebook draft",
    );
  } else {
    const published = await http(
      "POST",
      `/api/seo/social/${fbPost.id}/publish`,
      cookie,
    );
    const pdata = dataOf(published.json);
    rec(
      "POST publish degrade (facebook, no token)",
      published.status === 200 && pdata.ok === false,
      `status=${published.status} ok=${pdata.ok} error=${String(pdata.error || pdata.message || "").slice(0, 140)}`,
    );
  }

  const prisma = getPrismaClient();
  await prisma.$executeRawUnsafe(
    `DELETE FROM crm.seo_social_posts WHERE content_id = $1`,
    content.id,
  );
  await deleteSeoGeneratedContent(orgId, content.id);
  await prisma.$executeRawUnsafe(
    `DELETE FROM crm.seo_saved_keywords WHERE query_id = $1`,
    query.id,
  );
  await prisma.$executeRawUnsafe(
    `DELETE FROM crm.seo_keyword_queries WHERE id = $1`,
    query.id,
  );
  rec("cleanup test rows", true, TAG);

  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
  if (failed.length) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
