import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import AppShell from '../layout/AppShell';
import ReportsPanel from '../components/ReportsPanel';
import { useAuth } from '../AuthContext';
import {
  getOverview,
  getTopPages,
  getScrollDepth,
  getEngagement,
  getLiveUsers,
  getTrafficSources,
  getBrowsers,
  getGeography,
  getPageDropoff,
  getAccount,
} from '../api';
import { prefetchAnalyticsInsights } from '../hooks/useAnalyticsInsights';
import { setAnalyticsPeriod } from '../chat/analyticsPeriod';
import { useCoWorker } from '../context/CoWorkerContext';
import {
  LIVE_POLL_MS_FALLBACK,
  livePollMsForPresenceSource,
} from '../utils/livePollMs';
import useLiveTrackingStream from '../hooks/useLiveTrackingStream';
import { applyLiveTrackingEvent, mergeLivePayload } from '../utils/mergeLiveUsers';

const DASHBOARD_REFRESH_MS = Number(import.meta.env.VITE_DASHBOARD_REFRESH_MS) || 30000;

export default function Dashboard() {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const chatOpen = searchParams.get('chat') === 'open';
  const { setPanelState } = useCoWorker();

  useEffect(() => {
    if (chatOpen) setPanelState('split');
  }, [chatOpen, setPanelState]);

  const [period, setPeriod] = useState('overall');

  useEffect(() => {
    setAnalyticsPeriod(period);
  }, [period]);
  const [features, setFeatures] = useState(user?.features || null);
  const [data, setData] = useState(null);
  const [topPages, setTopPages] = useState([]);
  const [scrollDepthData, setScrollDepthData] = useState(null);
  const [engagementData, setEngagementData] = useState(null);
  const [trafficData, setTrafficData] = useState(null);
  const [browserData, setBrowserData] = useState(null);
  const [geoData, setGeoData] = useState(null);
  const [pageDropoffData, setPageDropoffData] = useState(null);
  const [liveData, setLiveData] = useState(null);
  const [liveStreamReady, setLiveStreamReady] = useState(false);
  const [liveStreamEnabled, setLiveStreamEnabled] = useState(false);
  const [livePollMs, setLivePollMs] = useState(LIVE_POLL_MS_FALLBACK);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [error, setError] = useState(null);

  const showConversions = useMemo(
    () => features?.conversions !== false,
    [features],
  );

  useEffect(() => {
    if (user?.features) {
      setFeatures(user.features);
      return;
    }
    getAccount()
      .then((res) => setFeatures(res.data?.features || { product_analytics: false, conversions: true, forms: true }))
      .catch(() => setFeatures({ product_analytics: false, conversions: true, forms: true }));
  }, [user?.features]);

  const loadLive = useCallback(async () => {
    try {
      const res = await getLiveUsers();
      const source = res.data?.presence_source;
      setLivePollMs(livePollMsForPresenceSource(source));
      setLiveStreamEnabled(res.data?.live_stream_available === true);
      setLiveData((prev) => mergeLivePayload(prev, res.data));
    } catch (err) {
      console.error(err);
    }
  }, []);

  useLiveTrackingStream({
    enabled: liveStreamEnabled,
    onSnapshot: () => {
      setLiveStreamReady(true);
    },
    onTracking: (event) => {
      setLiveData((prev) => applyLiveTrackingEvent(prev, event));
    },
  });

  const load = useCallback(async ({ silent = false } = {}) => {
    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
      setError(null);
    }
    try {
      const [
        overview,
        pages,
        scrollDepth,
        engagement,
        traffic,
        browsers,
        geography,
        pageDropoffResult,
      ] = await Promise.all([
        getOverview(period),
        getTopPages(period),
        getScrollDepth(period),
        getEngagement(period),
        getTrafficSources(period),
        getBrowsers(period),
        getGeography(period),
        getPageDropoff(period).catch((err) => {
          console.error('Page drop-off analytics failed', err);
          return { data: null };
        }),
      ]);
      setData(overview.data);
      setTopPages(pages.data);
      setScrollDepthData(scrollDepth.data);
      setEngagementData(engagement.data);
      setTrafficData(traffic.data);
      setBrowserData(browsers.data);
      setGeoData(geography.data);
      setPageDropoffData(pageDropoffResult.data);
      setLastUpdated(new Date());
    } catch (err) {
      console.error(err);
      if (!silent) {
        setData(null);
        setTopPages([]);
        setScrollDepthData(null);
        setEngagementData(null);
        setTrafficData(null);
        setBrowserData(null);
        setGeoData(null);
        setPageDropoffData(null);
        const detail = err.response?.data?.detail;
        setError(
          typeof detail === 'string'
            ? detail
            : !err.response
              ? 'Unable to reach the API — ensure api-node is running on port 7861 and restart web (yarn dev).'
              : 'Failed to load analytics. Check that the API is running and try Refresh.',
        );
      }
    } finally {
      if (silent) {
        setRefreshing(false);
      } else {
        setLoading(false);
      }
    }
  }, [period]);

  useEffect(() => {
    load();
    prefetchAnalyticsInsights(period);
  }, [load, period]);

  useEffect(() => {
    loadLive();
  }, [loadLive]);

  useEffect(() => {
    const interval = setInterval(() => {
      load({ silent: true });
    }, DASHBOARD_REFRESH_MS);
    return () => clearInterval(interval);
  }, [load]);

  useEffect(() => {
    if (liveStreamReady) return undefined;
    const interval = setInterval(() => loadLive(), livePollMs);
    return () => clearInterval(interval);
  }, [loadLive, livePollMs, liveStreamReady]);

  useEffect(() => {
    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible') {
        load({ silent: true });
        if (!liveStreamReady) loadLive();
      }
    };
    window.addEventListener('focus', refreshIfVisible);
    document.addEventListener('visibilitychange', refreshIfVisible);
    return () => {
      window.removeEventListener('focus', refreshIfVisible);
      document.removeEventListener('visibilitychange', refreshIfVisible);
    };
  }, [load, loadLive, liveStreamReady]);

  return (
    <AppShell title="Dashboard" fullBleed>
      <div className="reports-panel-standalone">
        <ReportsPanel
          period={period}
          onPeriodChange={setPeriod}
          onRefresh={() => load()}
          loading={loading}
          refreshing={refreshing}
          lastUpdated={lastUpdated}
          error={error}
          data={data}
          liveData={liveData}
          topPages={topPages}
          scrollDepthData={scrollDepthData}
          engagementData={engagementData}
          trafficData={trafficData}
          browserData={browserData}
          geoData={geoData}
          pageDropoffData={pageDropoffData}
          showConversions={showConversions}
        />
      </div>
    </AppShell>
  );
}
