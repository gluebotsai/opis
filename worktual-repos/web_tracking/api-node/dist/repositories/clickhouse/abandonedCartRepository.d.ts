import { type ClickHouseClient, type Row } from "../../plugins/clickhouse.js";
export type CartAbandonmentStatus = "active" | "cart_abandoned" | "checkout_abandoned" | "recovered" | "idle" | "empty";
export interface AbandonedCartProductLine {
    product_id: string;
    product_name: string;
    sku: string;
    quantity: number;
    unit_price: number;
    currency: string;
}
export interface CartAbandonmentState {
    status: CartAbandonmentStatus;
    threshold_minutes: number;
    last_activity_at: string | null;
    last_activity_type: string | null;
    idle_minutes: number | null;
    net_items: number;
    estimated_cart_value: number;
    currency: string;
    checkout_value: number | null;
    checkout_currency: string | null;
    last_checkout_at: string | null;
    last_purchase_at: string | null;
    products: AbandonedCartProductLine[];
}
export declare function computeCartAbandonmentStatus(row: Row, thresholdMinutes: number, nowMs?: number): CartAbandonmentStatus;
export declare class AbandonedCartRepository {
    private baseSignalsQuery;
    fetchAbandonedCarts(client: ClickHouseClient, websiteId: number, options?: {
        thresholdMinutes?: number;
        windowDays?: number;
        limit?: number;
        offset?: number;
        statuses?: CartAbandonmentStatus[];
        visitorIds?: string[];
    }): Promise<{
        rows: Row[];
        summary: Record<string, number>;
        total: number;
    }>;
    getVisitorCartAbandonment(client: ClickHouseClient, websiteId: number, visitorIds: string[], thresholdMinutes?: number, windowDays?: number): Promise<CartAbandonmentState>;
}
export declare const abandonedCartRepository: AbandonedCartRepository;
