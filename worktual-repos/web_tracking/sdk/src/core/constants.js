/** Shared SDK constants — transport, storage, and tracking thresholds. */

export const PAYLOAD_TYPE_V3 = 'events_v3';

export const VISITOR_COOKIE_DAYS = 365;

export const BEACON_MAX_BYTES = 60_000;
export const HTTP_STATUS_DUPLICATE = 409;

export const OFFLINE_DRAIN_BATCH = 20;
export const OFFLINE_QUEUE_MAX = 500;
export const OFFLINE_STORE_MAX = 50;

export const RAGE_CLICK_THRESHOLD = 3;
export const RAGE_CLICK_WINDOW_MS = 1000;
export const RAGE_CLICK_RADIUS_PX = 30;
export const DEAD_CLICK_DELAY_MS = 300;

export const USER_IDLE_MS = 30_000;

export const SEARCH_QUERY_MAX_LEN = 200;
export const ELEMENT_TEXT_MAX_LEN = 100;

export const ERROR_STACK_MAX_LEN = 2000;
