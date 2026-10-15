/**
 * Public help center — published KB articles by organization slug.
 */
import { query } from "./db";

export type HelpOrg = {
  id: string;
  slug: string;
  name: string;
  portalLabel: string;
};

export type HelpArticleListItem = {
  id: string;
  title: string;
  category: string;
  excerpt: string;
  /** Longer body for DSSA / agent tools (optional). */
  content?: string;
  updatedAt: string;
};

export type HelpArticleDetail = {
  id: string;
  title: string;
  content: string;
  category: string;
  updatedAt: string;
  views: number;
};

function excerptOf(content: string, max = 140): string {
  const s = String(content || "")
    .trim()
    .replace(/\s+/g, " ");
  if (!s) return "";
  if (s.length <= max) return s;
  return `${s.slice(0, max).trim()}…`;
}

/** Ticketing orgs are bigint ids — reject legacy placeholders like "org-1". */
function isOrgBigintId(raw: string): boolean {
  const id = String(raw || "").trim();
  return /^\d{1,20}$/.test(id);
}

export async function resolveHelpOrgBySlug(
  slugRaw: string
): Promise<HelpOrg | null> {
  const slug = String(slugRaw || "")
    .trim()
    .toLowerCase();
  if (!slug || slug.length > 120) return null;
  const { rows } = await query(
    `SELECT a.id,
            COALESCE(s.portal_slug, a.support_portal_slug) AS slug,
            a.company_name AS name,
            COALESCE(s.portal_label, a.support_portal_welcome) AS portal_label
     FROM accounts.organizations a
     LEFT JOIN ticketing.org_settings s ON s.organization_id = a.id
     WHERE lower(COALESCE(s.portal_slug, a.support_portal_slug, '')) = $1
     LIMIT 1`,
    [slug]
  );
  if (!rows[0]) return null;
  return {
    id: String(rows[0].id),
    slug: String(rows[0].slug),
    name: String(rows[0].name || ""),
    portalLabel: rows[0].portal_label ? String(rows[0].portal_label) : "",
  };
}

export async function listPublishedHelpArticles(input: {
  organizationId: string;
  q?: string;
  category?: string;
  limit?: number;
  /** When true, include truncated article body for LLM self-service. */
  includeContent?: boolean;
}): Promise<HelpArticleListItem[]> {
  if (!isOrgBigintId(input.organizationId)) return [];
  const limit = Math.min(Math.max(Number(input.limit) || 50, 1), 100);
  const q = String(input.q || "").trim();
  const category = String(input.category || "").trim();
  const params: unknown[] = [input.organizationId];
  let where = `organization_id = $1 AND status = 'Published'`;
  if (category && category.toLowerCase() !== "all") {
    params.push(category);
    where += ` AND category = $${params.length}`;
  }
  if (q) {
    const stop = new Set([
      "i", "am", "is", "are", "was", "were", "the", "a", "an", "my", "me", "we",
      "you", "your", "have", "has", "had", "do", "does", "did", "not", "no",
      "can", "could", "would", "should", "will", "be", "been", "being", "to",
      "of", "in", "on", "at", "for", "with", "about", "this", "that", "it",
      "facing", "having", "getting", "need", "help", "please", "hi", "hello",
    ]);
    const tokens = q
      .split(/\s+/)
      .map((t) => t.trim().toLowerCase())
      .filter((t) => t.length > 2 && !stop.has(t));
    if (tokens.length > 1) {
      const parts: string[] = [];
      for (const token of tokens) {
        params.push(`%${token}%`);
        parts.push(
          `(title ILIKE $${params.length} OR content ILIKE $${params.length})`
        );
      }
      where += ` AND (${parts.join(" OR ")})`;
    } else {
      params.push(`%${q}%`);
      where += ` AND (title ILIKE $${params.length} OR content ILIKE $${params.length})`;
    }
  }
  params.push(limit);
  const { rows } = await query(
    `SELECT external_id, id, title, content, category, updated_at
     FROM ticketing.kb_articles
     WHERE ${where}
     ORDER BY updated_at DESC
     LIMIT $${params.length}`,
    params
  );
  return rows.map((r) => {
    const body = String(r.content || "");
    const item: HelpArticleListItem = {
      id: String(r.external_id || r.id),
      title: String(r.title || "Untitled"),
      category: String(r.category || "General"),
      excerpt: excerptOf(body),
      updatedAt: r.updated_at ? new Date(String(r.updated_at)).toISOString() : "",
    };
    if (input.includeContent) {
      item.content = body.slice(0, 2000);
    }
    return item;
  });
}

export async function getPublishedHelpArticle(input: {
  organizationId: string;
  articleId: string;
}): Promise<HelpArticleDetail | null> {
  if (!isOrgBigintId(input.organizationId)) return null;
  const articleId = String(input.articleId || "").trim();
  if (!articleId) return null;
  const { rows } = await query(
    `SELECT external_id, id, title, content, category, updated_at, views
     FROM ticketing.kb_articles
     WHERE organization_id = $1
       AND status = 'Published'
       AND (external_id = $2 OR id::text = $2)
     LIMIT 1`,
    [input.organizationId, articleId]
  );
  if (!rows[0]) return null;
  const id = String(rows[0].id);
  await query(
    `UPDATE ticketing.kb_articles SET views = COALESCE(views, 0) + 1 WHERE id = $1`,
    [id]
  ).catch(() => undefined);
  return {
    id: String(rows[0].external_id || rows[0].id),
    title: String(rows[0].title || "Untitled"),
    content: String(rows[0].content || ""),
    category: String(rows[0].category || "General"),
    updatedAt: rows[0].updated_at
      ? new Date(String(rows[0].updated_at)).toISOString()
      : "",
    views: Number(rows[0].views || 0) + 1,
  };
}

export async function listHelpCategories(
  organizationId: string
): Promise<string[]> {
  const { rows } = await query(
    `SELECT DISTINCT category
     FROM ticketing.kb_articles
     WHERE organization_id = $1 AND status = 'Published'
     ORDER BY category ASC`,
    [organizationId]
  );
  return rows.map((r) => String(r.category || "General")).filter(Boolean);
}

/** URL-safe org slug from company name (hyphenated). */
export function slugifyOrgPortal(label: string): string {
  const s = String(label || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return s || "support";
}

async function portalSlugTaken(slug: string, organizationId: string): Promise<boolean> {
  const want = String(slug || "").trim().toLowerCase();
  if (!want) return true;
  const { rows } = await query(
    `SELECT 1
     FROM accounts.organizations a
     LEFT JOIN ticketing.org_settings s ON s.organization_id = a.id
     WHERE lower(COALESCE(s.portal_slug, a.support_portal_slug, '')) = $1
       AND a.id::text <> $2
     LIMIT 1`,
    [want, String(organizationId)]
  );
  return rows.length > 0;
}

/**
 * Ensure the spoke has a portal_slug so /support/{slug} and /hc/{slug} work.
 * New MyAccount companies often arrive without support_portal_slug — mint one
 * from company name into ticketing.org_settings (spoke owns portal slug).
 */
export async function ensureOrgPortalSlug(organizationId: string): Promise<string> {
  const orgId = String(organizationId || "").trim();
  if (!isOrgBigintId(orgId)) return "";

  const { rows } = await query(
    `SELECT a.company_name AS name,
            COALESCE(s.portal_slug, a.support_portal_slug, '') AS slug
     FROM accounts.organizations a
     LEFT JOIN ticketing.org_settings s ON s.organization_id = a.id
     WHERE a.id = $1::bigint
     LIMIT 1`,
    [orgId]
  );
  if (!rows[0]) return "";

  const existing = String(rows[0].slug || "").trim().toLowerCase();
  if (existing) {
    // Prefer spoke column so future prefs always resolve even if hub slug is empty.
    await query(
      `INSERT INTO ticketing.org_settings (organization_id, portal_slug)
       VALUES ($1::bigint, $2)
       ON CONFLICT (organization_id) DO UPDATE SET
         portal_slug = COALESCE(NULLIF(ticketing.org_settings.portal_slug, ''), EXCLUDED.portal_slug),
         updated_at = NOW()`,
      [orgId, existing]
    ).catch(() => undefined);
    return existing;
  }

  const company = String(rows[0].name || "").trim();
  let base = slugifyOrgPortal(company);
  if (base === "support") {
    base = `org-${orgId}`;
  }
  let candidate = base;
  let n = 2;
  while (await portalSlugTaken(candidate, orgId)) {
    candidate = `${base}-${n}`.slice(0, 60);
    n += 1;
    if (n > 50) {
      candidate = `org-${orgId}`;
      break;
    }
  }

  await query(
    `INSERT INTO ticketing.org_settings (organization_id, portal_slug)
     VALUES ($1::bigint, $2)
     ON CONFLICT (organization_id) DO UPDATE SET
       portal_slug = COALESCE(NULLIF(ticketing.org_settings.portal_slug, ''), EXCLUDED.portal_slug),
       updated_at = NOW()`,
    [orgId, candidate]
  );
  return candidate;
}
