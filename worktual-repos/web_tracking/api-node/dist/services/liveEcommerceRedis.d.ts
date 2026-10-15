import type { Redis } from "ioredis";
import { getLiveFromRedis } from "./livePresenceRedis.js";
export declare const ECOM_KPI_FIELDS: readonly ["product_views", "cart_adds", "cart_removes", "wishlist_adds", "wishlist_removes", "checkout_starts", "purchases", "purchase_revenue", "refunds", "refund_value", "payment_failures"];
export declare function sseChannel(websiteId: number): string;
export declare function emptyEcommerceCounts(): Record<string, number>;
export declare function getLiveEcommerceSnapshot(redis: Redis, websiteId: number): Promise<{
    type: "snapshot";
    counts: Record<string, number>;
    top_products: Array<Record<string, unknown>>;
    recent: unknown[];
    live_sessions: Awaited<ReturnType<typeof getLiveFromRedis>>;
}>;
