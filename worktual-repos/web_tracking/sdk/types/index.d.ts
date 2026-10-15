export interface WorktualAnalyticsConfig {
  websiteId: number | string;
  websiteUrl?: string;
  /** @deprecated use websiteId */
  domainId?: number | string;
  /** snake_case alias for websiteId */
  website_id?: number | string;
  /** snake_case alias for websiteUrl */
  website_url?: string;
  organizationId?: number;
  /** snake_case alias for organizationId */
  organization_id?: number;
  /** @deprecated use websiteUrl */
  domainName?: string;
  /** @deprecated use websiteId */
  domain_id?: number | string;
  /** @deprecated use websiteUrl */
  domain_name?: string;
  endpoint?: string;
  autoTrack?: boolean;
  trackForms?: boolean;
  /** Per-event form tracking — only submit is on by default. */
  trackFormSubmit?: boolean;
  trackFormView?: boolean;
  trackFormStart?: boolean;
  trackFormFocus?: boolean;
  trackFormBlur?: boolean;
  trackFormChange?: boolean;
  trackFormValidation?: boolean;
  trackFormSuccess?: boolean;
  trackFormFailure?: boolean;
  trackFormAbandon?: boolean;
  trackPerformance?: boolean;
  trackHeatmap?: boolean;
  /** Click coordinates for heatmap (default true when trackHeatmap is true) */
  trackHeatmapClicks?: boolean;
  /** Mouse move sampling — high volume, default false */
  trackMove?: boolean;
  /** Mouse hover events — default false */
  trackHover?: boolean;
  /** Scroll depth milestones — default true */
  trackScroll?: boolean;
  /** Rage click detection on heatmap clicks — default true */
  trackRageClick?: boolean;
  /** Dead click detection — default true */
  trackDeadClick?: boolean;
  trackErrors?: boolean;
  trackEcommerce?: boolean;
  batching?: boolean;
  batchInterval?: number;
  batchSize?: number;
  /** When true (default), page_view is sent immediately; other events still use batchInterval. */
  flushOnFirstPageView?: boolean;
  /** Flush ecommerce events immediately (default true). */
  flushOnEcommerce?: boolean;
  sessionTimeoutMinutes?: number;
  heatmapSampleRate?: number;
  debug?: boolean;
  respectDNT?: boolean;
  respectGPC?: boolean;
  offlineQueue?: boolean;
  flushOnUnload?: boolean;
  /**
   * On by default (`analytics: true` in SDK config) — tracking starts after init().
   * Pass `consent: { analytics: false }` or call setConsent({ analytics: false }) to opt out.
   */
  consent?: { analytics?: boolean; marketing?: boolean };
  /** Request browser GPS when the visitor grants permission (HTTPS required). */
  geolocation?: boolean;
  /** Prompt for location when SDK initializes (default true when geolocation is enabled). */
  /** Auto-detect div/React forms via data-wt-form (default true). */
  leadFormAutoScan?: boolean;
  /** Heuristic auto-detect div wrappers with inputs + submit (default true). */
  leadFormHeuristicScan?: boolean;
  /** Register div-based forms by CSS selector (for any framework). */
  leadForms?: Array<{
    formId: string;
    root: string;
    submit?: string;
    autoSuccess?: boolean;
  }>;
  trackReplay?: boolean;
  replaySampleRate?: number;
  replayScriptUrl?: string;
  geolocationPrompt?: boolean;
  /** Same as Campaign WEB_TRACKING_HMAC_SECRET — decodes ?wt= email click tokens. */
  webTrackingHmacSecret?: string;
  /** snake_case alias for webTrackingHmacSecret */
  web_tracking_hmac_secret?: string;
  /** Remove `wt` from URL after capture (default true). */
  stripCampaignTokenFromUrl?: boolean;
}

export interface WorktualAnalyticsPlugin {
  beforeTrack?: (event: Record<string, unknown>) => Record<string, unknown> | false | void;
  afterTrack?: (event: Record<string, unknown>) => void;
  beforeSend?: (payload: Record<string, unknown>) => Record<string, unknown> | false | void;
  afterSend?: (result: { success: boolean; payload: Record<string, unknown> }) => void;
}

export interface WorktualAnalytics {
  init(config: WorktualAnalyticsConfig): WorktualAnalytics;
  track(name: string, properties?: Record<string, unknown>): void;
  page(name?: string, properties?: Record<string, unknown>): void;
  identify(userId: string, traits?: Record<string, unknown>): void;
  alias(oldId: string, newId: string): void;
  group(groupId: string, properties?: Record<string, unknown>): void;
  login(props?: Record<string, unknown>): void;
  logout(): void;
  signup(props?: Record<string, unknown>): void;
  setUserProperties(traits: Record<string, unknown>): void;
  setConsent(options: { analytics?: boolean; marketing?: boolean }): Record<string, boolean>;
  /** Ask the browser for GPS coordinates. Requires user permission and HTTPS. */
  requestLocation(options?: {
    enableHighAccuracy?: boolean;
    timeout?: number;
    maximumAge?: number;
  }): Promise<Record<string, unknown>>;
  /** Current browser location permission state: granted | denied | unavailable | unknown */
  getLocationPermissionState(): string;
  flush(): Promise<boolean>;
  reset(): void;
  pause(): void;
  resume(): void;
  destroy(): void;
  registerPlugin(name: string, plugin: WorktualAnalyticsPlugin): void;
  getVisitorId(): string | null;
  getSessionId(): string | null;
  getUserId(): string | null;
  /** Call after AJAX submit succeeds (div forms without &lt;form&gt;). */
  formSuccess(formId: string, properties?: Record<string, unknown>): void;
  formFailure(formId: string, properties?: Record<string, unknown>): void;
  registerLeadForm(options: {
    formId: string;
    root?: string | Element;
    submit?: string;
    autoSuccess?: boolean;
  }): boolean;
  productView(product: Record<string, unknown>): void;
  addToCart(product: Record<string, unknown>): void;
  removeFromCart(product: Record<string, unknown>): void;
  beginCheckout(props?: Record<string, unknown>): void;
  purchase(order: Record<string, unknown>): void;
  refund(order: Record<string, unknown>): void;
  /** Cross-site product/order-item rating → event `product_rating` (CDP / fact_custom_events). */
  productRating(props: Record<string, unknown>): void;
  /** One `product_rating` event per item in `items`. */
  productRatings(batch: {
    orderId?: string;
    orderNumber?: string;
    scale?: string;
    source?: string;
    deliveredAt?: string;
    items: Record<string, unknown>[];
  }): void;
  version: string;
}

declare global {
  interface Window {
    WorktualAnalytics: WorktualAnalytics;
  }
}

export default WorktualAnalytics;
