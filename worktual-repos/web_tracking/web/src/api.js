import axios from 'axios';
import { clearAuthSession, getStoredToken, isTokenExpired, redirectToLogin } from './authStorage';

// Dev: same-origin /api → Vite proxy → localhost:7861 (avoids CORS on QA server).
// Production build: uses VITE_API_URL (e.g. https://qatrackingapi.worktual.com).
const useDevProxy =
  import.meta.env.DEV && import.meta.env.VITE_DEV_USE_API_PROXY !== 'false';
const API_URL = useDevProxy ? '' : (import.meta.env.VITE_API_URL || '');

// Dev: POST /chat/chat/message → Vite proxy → AI Chat /chat/message
const CHAT_HTTP_URL = useDevProxy
  ? '/chat'
  : (import.meta.env.VITE_AI_CHAT_HTTP_URL || import.meta.env.VITE_API_URL || '');

const api = axios.create({ baseURL: API_URL });

api.interceptors.request.use((config) => {
  const token = getStoredToken();
  if (token && !isTokenExpired(token)) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      clearAuthSession();
      redirectToLogin();
    }
    return Promise.reject(error);
  },
);

export const login = (email, password) =>
  api.post('/api/auth/login', { email, password });

/** One-time code from My Accounts onboarding redirect → same body as login. */
export const exchangeOnboardingCode = (code) =>
  api.post('/api/auth/onboarding/exchange', { code });

export const selectWebsite = async (websiteId) => {
  const { data } = await api.post('/api/auth/select-website', { website_id: websiteId });
  return data;
};

export const getWebsites = () => api.get('/api/admin/websites');

export const getOverview = (period) =>
  api.get('/api/analytics/overview', { params: { period } });

export const getAnalyticsInsights = (period) =>
  api.get('/api/analytics/insights', { params: { period } });

export const getTopPages = (period) =>
  api.get('/api/analytics/top-pages', { params: { period } });

export const getPageDropoff = (period, limit = 5) =>
  api.get('/api/analytics/page-dropoff', { params: { period, limit } });

export const getScrollDepth = (period) =>
  api.get('/api/analytics/scroll-depth', { params: { period } });

export const getEngagement = (period) =>
  api.get('/api/analytics/engagement', { params: { period } });

export const getProducts = (period) =>
  api.get('/api/analytics/products', { params: { period } });

export const getEcommerceOverview = (period) =>
  api.get('/api/analytics/ecommerce/overview', { params: { period } });

export const getEcommerceProducts = (period, limit = 50) =>
  api.get('/api/analytics/ecommerce/products', { params: { period, limit } });

export const getEcommerceTrending = (period, limit = 10) =>
  api.get('/api/analytics/ecommerce/trending', { params: { period, limit } });

export const getEcommerceEngagedVisitors = (period, limit = 20) =>
  api.get('/api/analytics/ecommerce/engaged-visitors', { params: { period, limit } });

export const getEcommerceAbandonedCarts = ({
  mode = 'operational',
  thresholdMinutes,
  status = 'cart_abandoned',
  limit = 10,
  offset = 0,
} = {}) =>
  api.get('/api/analytics/ecommerce/abandoned-carts', {
    params: {
      mode,
      threshold_minutes: thresholdMinutes,
      status,
      limit,
      offset,
    },
  });

export const getTrafficSources = (period) =>
  api.get('/api/analytics/traffic-sources', { params: { period } });

export const getBrowsers = (period) =>
  api.get('/api/analytics/browsers', { params: { period } });

export const getGeography = (period) =>
  api.get('/api/analytics/geography', { params: { period } });

export const getLiveUsers = () =>
  api.get('/api/analytics/live');

export const getVisitorSegmentation = (period, pageEngagementThresholdPct = 50) =>
  api.get('/api/analytics/segmentation', {
    params: { period, page_engagement_threshold_pct: pageEngagementThresholdPct },
  });

export const getHeatmaps = (pagePath, period, fromDate, toDate) =>
  api.get('/api/analytics/heatmaps', { params: { page_path: pagePath, period, from: fromDate, to: toDate } });

export const getHeatmapPages = (period, fromDate, toDate) =>
  api.get('/api/analytics/heatmap-pages', { params: { period, from: fromDate, to: toDate } });

export const getHeatmapScopes = (pagePath, period, eventType = 'click', fromDate, toDate) =>
  api.get('/api/analytics/heatmap-scopes', {
    params: { page_path: pagePath, period, event_type: eventType, from: fromDate, to: toDate },
  });

export const getHeatmap = ({
  pagePath,
  period,
  eventType = 'click',
  visitorId,
  sessionId,
  fromDate,
  toDate,
  cdpId,
  userId,
}) =>
  api.get('/api/analytics/heatmap', {
    params: {
      page_path: pagePath,
      period,
      event_type: eventType,
      visitor_id: visitorId || undefined,
      session_id: sessionId || undefined,
      cdp_id: cdpId || undefined,
      user_id: userId || undefined,
      from: fromDate,
      to: toDate,
    },
  });

const REPLAY_API_TIMEOUT_MS = 90_000;

export const getReplayEvents = (sessionId, pagePath, period) =>
  api.get('/api/analytics/replay/events', {
    params: { session_id: sessionId, page_path: pagePath, period },
    timeout: REPLAY_API_TIMEOUT_MS,
  });

export const getReplaySessions = (
  period,
  offset = 0,
  limit = 10,
  { sessionId = '', visitorId = '', cdpId = '', userId = '' } = {},
) =>
  api.get('/api/analytics/replay/sessions', {
    params: {
      period,
      offset,
      limit,
      session_id: sessionId || undefined,
      visitor_id: visitorId || undefined,
      cdp_id: cdpId || undefined,
      user_id: userId || undefined,
    },
    timeout: REPLAY_API_TIMEOUT_MS,
  });

export const getVisitorAccounts = (visitorId) =>
  api.get(`/api/visitors/${encodeURIComponent(visitorId)}/accounts`);

export const getForms = (period) =>
  api.get('/api/analytics/forms', { params: { period } });

export const getFormSubmissions = (period, formId, limit = 20) =>
  api.get('/api/analytics/forms/submissions', {
    params: { period, form_id: formId, limit },
  });

export const getFormLeads = (period, formId, limit = 50) =>
  api.get('/api/analytics/forms/leads', {
    params: { period, form_id: formId, limit },
  });

export const getPerformance = (period) =>
  api.get('/api/analytics/performance', { params: { period } });

export const getErrors = (period) =>
  api.get('/api/analytics/errors', { params: { period } });

export const getCustomEvents = (period) =>
  api.get('/api/analytics/custom-events', { params: { period } });

export const getSessions = (period, offset = 0, limit = 20) =>
  api.get('/api/analytics/sessions', { params: { period, offset, limit } });

export const getVisitors = (offset, limit = 10, search = '') =>
  api.get('/api/visitors', { params: { offset, limit, search: search || undefined } });

export const getVisitorDetail = (visitorId, params = {}) =>
  api.get(`/api/visitors/${encodeURIComponent(visitorId)}`, { params });

export const getTrackingScript = () =>
  api.get('/api/admin/tracking-script');

export const getAccount = () =>
  api.get('/api/admin/account');

export const sendChatMessage = async (message, sessionId, dashboardPeriod) => {
  const { data } = await api.post(`${CHAT_HTTP_URL}/chat/message`, {
    message,
    session_id: sessionId,
    dashboard_period: dashboardPeriod || undefined,
  });
  return data;
};

export const resetChatSession = async (sessionId) => {
  await api.post(`${CHAT_HTTP_URL}/chat/reset`, { session_id: sessionId });
};

export default api;
