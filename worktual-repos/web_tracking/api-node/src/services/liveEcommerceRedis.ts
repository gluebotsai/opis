import type { Redis } from "ioredis";
import { getLiveFromRedis, isRedisLiveReady } from "./livePresenceRedis.js";

export const ECOM_KPI_FIELDS = [
  "product_views",
  "cart_adds",
  "cart_removes",
  "wishlist_adds",
  "wishlist_removes",
  "checkout_starts",
  "purchases",
  "purchase_revenue",
  "refunds",
  "refund_value",
  "payment_failures",
] as const;

export function sseChannel(websiteId: number): string {
  return `wt:sse:${websiteId}`;
}

function utcDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function kpisKey(websiteId: number, day = utcDate()): string {
  return `wt:ecom:${websiteId}:kpis:${day}`;
}

function visitorsKey(websiteId: number, day = utcDate()): string {
  return `wt:ecom:${websiteId}:visitors:${day}`;
}

function productsZKey(websiteId: number, day = utcDate()): string {
  return `wt:ecom:${websiteId}:products:${day}`;
}

function productHKey(websiteId: number, productId: string, day = utcDate()): string {
  return `wt:ecom:${websiteId}:product:${day}:${productId}`;
}

function recentKey(websiteId: number): string {
  return `wt:ecom:${websiteId}:recent`;
}

function num(raw: string | undefined): number {
  const n = Number(raw ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function emptyEcommerceCounts(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const field of ECOM_KPI_FIELDS) counts[field] = 0;
  counts.add_to_cart_rate = 0;
  counts.unique_products_touched = 0;
  counts.product_engaged_visitors = 0;
  return counts;
}

export async function getLiveEcommerceSnapshot(
  redis: Redis,
  websiteId: number,
): Promise<{
  type: "snapshot";
  counts: Record<string, number>;
  top_products: Array<Record<string, unknown>>;
  recent: unknown[];
  live_sessions: Awaited<ReturnType<typeof getLiveFromRedis>>;
}> {
  const day = utcDate();
  const counts = emptyEcommerceCounts();
  const raw = await redis.hgetall(kpisKey(websiteId, day));
  for (const field of ECOM_KPI_FIELDS) {
    counts[field] = num(raw[field]);
  }
  const views = counts.product_views;
  const cart = counts.cart_adds;
  counts.add_to_cart_rate = views > 0 ? Math.round((cart / views) * 1000) / 10 : 0;
  counts.net_revenue = counts.purchase_revenue - counts.refund_value;
  counts.unique_products_touched = await redis.zcard(productsZKey(websiteId, day));
  counts.product_engaged_visitors = await redis.scard(visitorsKey(websiteId, day));

  const members = await redis.zrevrange(productsZKey(websiteId, day), 0, 19);
  const top_products: Array<Record<string, unknown>> = [];
  if (members.length) {
    const pipe = redis.pipeline();
    for (const pid of members) pipe.hgetall(productHKey(websiteId, pid, day));
    const rows = await pipe.exec();
    for (let i = 0; i < members.length; i += 1) {
      const hash = (rows?.[i]?.[1] ?? {}) as Record<string, string>;
      top_products.push({
        product_id: members[i],
        product_name: hash.product_name || members[i],
        product_views: num(hash.product_views),
        cart_adds: num(hash.cart_adds),
        purchases: num(hash.purchases),
        checkout_starts: num(hash.checkout_starts),
      });
    }
  }

  const recentRaw = await redis.lrange(recentKey(websiteId), 0, 19);
  const recent = recentRaw.map((row) => {
    try {
      return JSON.parse(row);
    } catch {
      return row;
    }
  });

  const live_sessions = isRedisLiveReady(redis)
    ? await getLiveFromRedis(redis, websiteId)
    : { active_users: 0, active_sessions: 0, sessions: [] };

  return { type: "snapshot", counts, top_products, recent, live_sessions };
}
