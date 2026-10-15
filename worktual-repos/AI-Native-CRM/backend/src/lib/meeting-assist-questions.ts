/** Heuristic: customer asked something the rep should answer with KB context. */

const QUESTION_START =
  /^(what|what's|whats|how|why|when|where|who|which|can you|could you|do you|does it|is there|are there|will you|would you|tell me|we need|we want|looking for|interested in|can we|could we|have you|do we)\b/i;

const PRODUCT_INTENT =
  /\b(product|products|offering|offerings|solution|solutions|feature|features|pricing|price|cost|plan|plans|package|packages|integrat|demo|trial|support|sla)\b/i;

const SPECIFIC_EXPLAIN =
  /\b(explain|detail|details|how does|how do|what is|what's|whats|tell me about|walk me through|deep dive|tell about)\b/i;

const GENERIC_PRODUCT_OVERVIEW =
  /\b(what are|what do you|which products|your products|products (do )?you (have|offer)|product (list|catalog|portfolio))\b/i;

const STOP_SPANS =
  /^(can|you|tell|me|about|what|is|are|the|a|an|do|does|how|why|when|where|who|which|please|just)\b/i;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function compactAlnum(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length || !b.length) return Math.max(a.length, b.length);
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 0; i < a.length; i++) {
    const cur = [i + 1];
    for (let j = 0; j < b.length; j++) {
      cur.push(
        Math.min(
          prev[j + 1]! + 1,
          cur[j]! + 1,
          prev[j]! + (a[i] === b[j] ? 0 : 1),
        ),
      );
    }
    for (let k = 0; k < prev.length; k++) prev[k] = cur[k]!;
  }
  return prev[b.length]!;
}

function normalizeProductNames(
  productNames: Array<string | null | undefined> | null | undefined,
): string[] {
  if (!productNames?.length) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of productNames) {
    const name = String(raw || "").trim();
    if (name.length < 2) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out.slice(0, 40);
}

function mentionsCatalogProduct(
  text: string,
  productNames: string[],
): boolean {
  const t = text.trim();
  if (!t || productNames.length === 0) return false;
  return productNames.some((name) => {
    const re = new RegExp(`\\b${escapeRegExp(name)}\\b`, "i");
    return re.test(t);
  });
}

/**
 * Map caption STT garble onto this tenant's product catalog
 * (e.g. "AAC cars" → "CCaaS" when CCaaS is in the org catalog).
 * No vendor-specific hardcoding — works for any tenant's SKUs.
 */
export function repairAssistQueryAgainstCatalog(
  text: string,
  productNames?: Array<string | null | undefined> | null,
): string {
  const original = (text || "").trim();
  if (!original) return "";
  const products = normalizeProductNames(productNames);
  if (products.length === 0) return original.replace(/\s+/g, " ").trim();

  // Already names a catalog product clearly — leave alone.
  if (mentionsCatalogProduct(original, products)) {
    return original.replace(/\s+/g, " ").trim();
  }

  const words = original.split(/\s+/).filter(Boolean);
  let best: { name: string; span: string; dist: number } | null = null;

  for (const name of products) {
    const cn = compactAlnum(name);
    if (cn.length < 3) continue;

    for (let i = 0; i < words.length; i++) {
      for (let len = 1; len <= 4 && i + len <= words.length; len++) {
        const span = words.slice(i, i + len).join(" ");
        if (STOP_SPANS.test(span) && len <= 2) continue;
        const cs = compactAlnum(span);
        if (cs.length < 3) continue;

        const dist = Math.min(
          levenshtein(cs, cn),
          levenshtein(cs.replace(/^ai/, ""), cn.replace(/^ai/, "")),
          levenshtein(cs, `ai${cn}`),
          levenshtein(cs.replace(/s$/, ""), cn),
        );
        const maxLen = Math.max(cs.length, cn.length);
        const threshold = Math.min(3, Math.max(1, Math.floor(maxLen * 0.4)));
        if (dist > threshold) continue;
        if (!best || dist < best.dist || (dist === best.dist && name.length > best.name.length)) {
          best = { name, span, dist };
        }
      }
    }
  }

  if (!best) return original.replace(/\s+/g, " ").trim();

  const replaced = original.replace(
    new RegExp(escapeRegExp(best.span), "i"),
    best.name,
  );
  return replaced.replace(/\s+/g, " ").trim();
}

/** @deprecated Use repairAssistQueryAgainstCatalog with tenant products. */
export function repairAssistSttQuery(text: string): string {
  return (text || "").trim().replace(/\s+/g, " ");
}

export function looksLikeCustomerQuery(text: string): boolean {
  const t = text.trim();
  if (t.length < 12) return false;
  if (t.includes("?")) return true;
  if (QUESTION_START.test(t)) return true;
  // Product/pricing intents still need question-like framing — not statements
  // like "I've got the products here."
  if (
    PRODUCT_INTENT.test(t) &&
    t.split(/\s+/).length >= 4 &&
    /\b(what|which|how|tell|explain|need|want|looking|interested|price|pricing|cost)\b/i.test(
      t,
    )
  ) {
    return true;
  }
  return false;
}

/** Drop STT noise / one-word fragments that are not real questions. */
export function isWeakAssistFragment(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length <= 2 && !t.includes("?") && !QUESTION_START.test(t)) {
    return true;
  }
  // Single non-product noun fragments like "extension"
  if (words.length === 1 && !PRODUCT_INTENT.test(t)) return true;
  return false;
}

export function extractAssistQuery(text: string): string {
  const t = (text || "").trim();
  if (!t) return "";
  const parts = t.split(/(?<=[.?!])\s+/).map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return t;

  // Prefer the strongest question sentence, not necessarily the last fragment
  let best = parts[parts.length - 1]!;
  let bestScore = scoreQueryCandidate(best);
  for (const part of parts) {
    const score = scoreQueryCandidate(part);
    if (score > bestScore) {
      best = part;
      bestScore = score;
    }
  }
  return best.length >= 8 ? best : t;
}

export function scoreQueryCandidate(
  text: string,
  productNames?: Array<string | null | undefined> | null,
): number {
  const t = text.trim();
  if (!t || isWeakAssistFragment(t)) return 0;
  let score = Math.min(t.length, 80);
  if (t.includes("?")) score += 40;
  if (QUESTION_START.test(t)) score += 50;
  if (PRODUCT_INTENT.test(t)) score += 35;
  // Generic catalog overview — useful, but must not beat a later specific ask.
  if (GENERIC_PRODUCT_OVERVIEW.test(t)) {
    score += 15;
  }
  const products = normalizeProductNames(productNames);
  // Prefer asks that name (or nearly name) this tenant's catalog products.
  if (products.length > 0 && mentionsCatalogProduct(t, products)) {
    score += SPECIFIC_EXPLAIN.test(t) ? 70 : 45;
  } else if (products.length > 0) {
    const repaired = repairAssistQueryAgainstCatalog(t, products);
    if (repaired !== t && mentionsCatalogProduct(repaired, products)) {
      score += SPECIFIC_EXPLAIN.test(t) ? 65 : 40;
    }
  }
  // Penalize very short trailing STT leftovers
  if (t.split(/\s+/).length <= 2) score -= 30;
  return score;
}

/**
 * Merge recent customer utterances so STT splits
 * ("what are the products" + "extension") become one useful query.
 * Prefer the latest strong question so follow-ups beat older overview asks.
 * Pass tenant `productNames` when available so scoring prefers catalog hits.
 */
export function buildAssistQueryFromRecent(
  utterances: string[],
  latest: string,
  productNames?: Array<string | null | undefined> | null,
): string {
  const recent = [...utterances.map((u) => u.trim()).filter(Boolean), latest.trim()]
    .filter(Boolean)
    .slice(-6);

  if (recent.length === 0) return "";

  const products = normalizeProductNames(productNames);

  // Score each utterance with a recency boost (later lines win ties).
  let best = "";
  let bestScore = 0;
  for (let i = 0; i < recent.length; i++) {
    const q = extractAssistQuery(recent[i]!);
    const score = scoreQueryCandidate(q, products) + i * 25;
    if (score > bestScore) {
      best = q;
      bestScore = score;
    }
  }

  // Joined window only wins when it is a clearly stronger *specific* ask,
  // not when it re-surfaces an older generic overview.
  const joined = recent.join(" ").replace(/\s+/g, " ").trim();
  const joinedQuery = extractAssistQuery(joined);
  const joinedScore = scoreQueryCandidate(joinedQuery, products);
  if (joinedScore > bestScore + 20) {
    best = joinedQuery;
    bestScore = joinedScore;
  }

  // If latest is not a real question (STT filler / acknowledgment), keep best prior.
  if (
    (isWeakAssistFragment(latest) || !looksLikeCustomerQuery(latest)) &&
    bestScore > 0
  ) {
    return repairAssistQueryAgainstCatalog(best, products);
  }

  // Latest strong question always preferred when it qualifies as a query.
  const latestQ = extractAssistQuery(latest);
  if (
    !isWeakAssistFragment(latestQ) &&
    looksLikeCustomerQuery(latestQ) &&
    scoreQueryCandidate(latestQ, products) >= 40
  ) {
    return repairAssistQueryAgainstCatalog(latestQ, products);
  }

  return repairAssistQueryAgainstCatalog(best || latestQ, products);
}
