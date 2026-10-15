import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom';
import AppShell from '../layout/AppShell';
import CopyId from '../components/CopyId';
import Pagination from '../components/Pagination';
import VisitorHeatmapSection from '../components/VisitorHeatmapSection';
import VisitorScrollDepthChart from '../components/VisitorScrollDepthChart';
import VisitorTouchAttribution from '../components/VisitorTouchAttribution';
import VisitorProductActivity from '../components/VisitorProductActivity';
import VisitorJourneySection from '../components/VisitorJourneySection';
import VisitorCombinedScopeBanner from '../components/VisitorCombinedScopeBanner';
import VisitorMultiAccountPicker from '../components/VisitorMultiAccountPicker';
import VisitorDetailAnalytics from '../components/VisitorDetailAnalytics';
import VisitorRecentActivity from '../components/VisitorRecentActivity';
import { useAuth } from '../AuthContext';
import { getVisitorDetail } from '../api';
import { formatDuration } from '../utils/formatDuration';
import { formatLocalDateTime } from '../utils/formatDateTime';
import { dedupeJourneySteps } from '../utils/dedupeJourney';
import {
  bouncePageTitle,
  formatBounceDisplay,
  formatPagePath,
  formatPagePathTitle,
  formatProductLabel,
} from '../utils/formatDisplayLabels';
import { resolveVisitorTrafficDetails } from '../utils/visitorTrafficUtm';
import {
  visitorContactTypeLabel,
  visitorIsGuestProfile,
  visitorIsKnown,
  visitorProfileHeaderSubtitle,
  visitorProfileName,
} from '../utils/visitorProfileDisplay';
import { replayUrlWithReturn } from '../utils/backNavigation';
import useLiveTrackingStream from '../hooks/useLiveTrackingStream';
import {
  applyLiveCommerceRevenue,
  applyLiveConversions,
  applyLiveRecentInteractions,
  applyLiveTopProducts,
  applyLiveVisitorActivity,
} from '../utils/ecommerceLive';
import {
  formatCommerceMoney,
  netRevenue,
  netRevenueBreakdownHint,
} from '../utils/commerceRevenue';

function MetricCard({ label, value, hint }) {
  return (
    <div className="card metric-card visitor-metric-card">
      <div className="value">{value}</div>
      <div className="label">{label}</div>
      {hint && <div className="visitor-metric-hint">{hint}</div>}
    </div>
  );
}

function DetailRow({ label, value, mono = false, hideIfEmpty = false }) {
  const text = value == null ? '' : String(value).trim();
  if (hideIfEmpty && !text) return null;
  return (
    <div className="detail-item">
      <span className="key">{label}</span>
      <span className={mono ? 'visitor-detail-mono' : undefined}>{text || '—'}</span>
    </div>
  );
}

const SESSION_PAGE_SIZES = [5, 10, 15];

const VISITOR_DETAIL_REFRESH_MS =
  Number(import.meta.env.VITE_VISITOR_DETAIL_REFRESH_MS)
  || Number(import.meta.env.VITE_VISITORS_REFRESH_MS)
  || 15000;

export default function VisitorDetail() {
  const { visitorId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedCdpIdFromUrl = searchParams.get('cdp_id') || '';
  const navigate = useNavigate();
  const { user } = useAuth();
  const productAnalyticsEnabled = user?.features?.product_analytics === true;
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const hasLoadedRef = useRef(false);
  const [heatmapPage, setHeatmapPage] = useState(null);
  const [sessionOffset, setSessionOffset] = useState(0);
  const [sessionLimit, setSessionLimit] = useState(5);

  useEffect(() => {
    hasLoadedRef.current = false;
    setSessionOffset(0);
    setSessionLimit(5);
  }, [visitorId, selectedCdpIdFromUrl]);

  const loadVisitorDetail = useCallback(async ({ silent = false } = {}) => {
    if (!visitorId) return;

    const showInitialLoader = !silent && !hasLoadedRef.current;
    if (showInitialLoader) {
      setData(null);
      setLoading(true);
    } else {
      setRefreshing(true);
    }
    if (!silent) setError(null);

    const params = selectedCdpIdFromUrl ? { cdp_id: selectedCdpIdFromUrl } : {};
    try {
      const res = await getVisitorDetail(visitorId, params);
      setData(res.data);
      hasLoadedRef.current = true;
    } catch (err) {
      console.error('Failed to load visitor detail', err);
      if (!silent) {
        setError(
          err.response?.data?.detail || err.response?.data?.message || 'Failed to load visitor.',
        );
        if (showInitialLoader) setData(null);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [visitorId, selectedCdpIdFromUrl]);

  useEffect(() => {
    loadVisitorDetail();
  }, [loadVisitorDetail]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        loadVisitorDetail({ silent: true });
      }
    }, VISITOR_DETAIL_REFRESH_MS);
    return () => clearInterval(interval);
  }, [loadVisitorDetail]);

  useEffect(() => {
    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible') {
        loadVisitorDetail({ silent: true });
      }
    };
    window.addEventListener('focus', refreshIfVisible);
    document.addEventListener('visibilitychange', refreshIfVisible);
    return () => {
      window.removeEventListener('focus', refreshIfVisible);
      document.removeEventListener('visibilitychange', refreshIfVisible);
    };
  }, [loadVisitorDetail]);

  useLiveTrackingStream({
    enabled: Boolean(visitorId) && productAnalyticsEnabled,
    onTracking: (event) => {
      const eventVisitor = String(event?.visitor_id ?? '').trim();
      if (!eventVisitor || eventVisitor !== String(visitorId)) return;
      setData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          top_products: applyLiveTopProducts(prev.top_products, event),
          product_activity: applyLiveVisitorActivity(prev.product_activity, event),
          recent_interactions: applyLiveRecentInteractions(prev.recent_interactions, event),
          conversions: applyLiveConversions(prev.conversions, event),
          commerce_revenue: applyLiveCommerceRevenue(prev.commerce_revenue, event),
        };
      });
    },
  });

  const handleSelectCdpProfile = (cdpId) => {
    const next = new URLSearchParams(searchParams);
    if (cdpId) next.set('cdp_id', cdpId);
    else next.delete('cdp_id');
    setSearchParams(next, { replace: true });
  };

  const resolvedVisitorId = useMemo(
    () => data?.visitor?.visitor_id ?? data?.visitor?.['v.visitor_id'] ?? visitorId,
    [data, visitorId],
  );

  const journeySteps = useMemo(
    () => dedupeJourneySteps(data?.journey),
    [data?.journey],
  );

  const resolvedTraffic = useMemo(
    () => resolveVisitorTrafficDetails(data?.summary?.traffic_source, data?.sessions, data?.journey),
    [data?.summary?.traffic_source, data?.sessions, data?.journey],
  );

  const allSessions = data?.sessions ?? [];
  const pagedSessions = useMemo(
    () => allSessions.slice(sessionOffset, sessionOffset + sessionLimit),
    [allSessions, sessionOffset, sessionLimit],
  );

  const handleSessionLimitChange = (nextLimit) => {
    setSessionLimit(nextLimit);
    setSessionOffset(0);
  };

  const headerRefreshActions = (copyIdValue) => (
    <>
      <button
        type="button"
        className="btn btn-black"
        onClick={() => loadVisitorDetail({ silent: false })}
        disabled={loading || refreshing}
      >
        {loading || refreshing ? 'Loading…' : 'Refresh'}
      </button>
      {copyIdValue ? (
        <CopyId value={copyIdValue} label="visitor ID" className="copy-id-btn-inline" />
      ) : null}
    </>
  );

  if (error && !data) {
    return (
      <AppShell title="Visitor" headerActions={headerRefreshActions(visitorId)}>
        <div className="container container-in-shell">
          <Link to="/visitors" className="visitor-back-link">← Back to Visitors</Link>
          <p className="visitor-error">{error}</p>
        </div>
      </AppShell>
    );
  }

  if (!data) {
    return (
      <AppShell title="Visitor" headerActions={headerRefreshActions(visitorId)}>
        <div className="container container-in-shell"><p>Loading visitor profile…</p></div>
      </AppShell>
    );
  }

  const {
    visitor,
    cdp_profile: cdpProfileFromRoot,
    summary,
    sessions,
    top_pages,
    top_products,
    product_activity,
    conversions,
    commerce_revenue: commerceRevenue = {},
    journey,
    scroll_depth,
    recent_interactions: recentInteractions,
    daily_activity: dailyActivity,
    analytics_scope: analyticsScope,
  } = data;
  const distinctSessionVisitorIds = new Set(
    allSessions.map((s) => String(s.visitor_id ?? '').trim()).filter(Boolean),
  );
  const showSessionVisitorId =
    analyticsScope?.scope === 'cdp_linked' && distinctSessionVisitorIds.size > 1;
  const cdpProfile = cdpProfileFromRoot ?? visitor?.cdp_profile ?? null;
  const activeCdpId =
    analyticsScope?.selected_cdp_id || cdpProfile?.cdp_id || cdpProfileFromRoot?.cdp_id || '';

  const openSessionReplay = (sessionId) => {
    const returnQs = activeCdpId ? `?cdp_id=${encodeURIComponent(activeCdpId)}` : '';
    const returnTo = `/visitors/${encodeURIComponent(resolvedVisitorId)}${returnQs}`;
    navigate(replayUrlWithReturn(sessionId, returnTo), {
      state: {
        visitorId: resolvedVisitorId,
        cdpId: activeCdpId,
        returnTo,
        returnLabel: 'Visitor',
      },
    });
  };

  const traffic = summary.traffic_source || {};
  const guestProfile = visitorIsGuestProfile(cdpProfile);
  const known = visitorIsKnown(cdpProfile);
  const seenLine = `First seen ${formatLocalDateTime(visitor.first_seen_at)} · Last seen ${formatLocalDateTime(visitor.last_seen_at)}`;
  const headerTitle = known || guestProfile ? visitorProfileName(cdpProfile) : resolvedVisitorId;
  const headerSubtitle = known
    ? [visitorProfileHeaderSubtitle(cdpProfile), seenLine].filter(Boolean).join(' · ')
    : seenLine;

  const totalSessions = Number(visitor.total_sessions ?? allSessions.length ?? 0);
  const visitorKindLabel = totalSessions > 1 ? 'Returning visitor' : 'New visitor';

  const profileSection = (
    <section className="visitor-section">
      <h2 className="visitor-section-title">Profile</h2>
      <div className="card">
        {guestProfile ? (
          <>
            <DetailRow label="Method" value="Guest" />
            <DetailRow label="Visitor ID" value={resolvedVisitorId} mono />
            <DetailRow label="Type" value={visitorKindLabel} />
          </>
        ) : !known ? (
          <>
            <DetailRow label="Method" value="Anonymous" />
            <DetailRow label="Visitor ID" value={resolvedVisitorId} mono />
            <DetailRow label="Type" value={visitorKindLabel} />
          </>
        ) : (
          <>
            <DetailRow label="Method" value={visitorContactTypeLabel(cdpProfile)} />
            <DetailRow label="First name" value={cdpProfile.first_name} />
            <DetailRow label="Last name" value={cdpProfile.last_name} />
            <DetailRow label="Email" value={cdpProfile.primary_email} />
            <DetailRow label="Phone" value={cdpProfile.primary_phone} />
            <DetailRow label="Company" value={cdpProfile.company} />
            <DetailRow label="Type" value={visitorKindLabel} />
            {analyticsScope?.scope === 'cdp_linked' && cdpProfile.linked_visitor_ids_count > 1 && (
              <div className="detail-item">
                <span className="key">Same customer ({cdpProfile.linked_visitor_ids_count} visitor IDs)</span>
                <span>
                  {(cdpProfile.linked_visitor_ids || []).map((id) => (
                    <span key={id} style={{ display: 'block', marginTop: '0.25rem' }}>
                      {id === resolvedVisitorId ? (
                        <code className="visitor-detail-mono">{id} (this visit)</code>
                      ) : (
                        <Link to={`/visitors/${encodeURIComponent(id)}`} className="visitor-detail-mono">
                          {id}
                        </Link>
                      )}
                    </span>
                  ))}
                </span>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );

  return (
    <AppShell
      title={headerTitle}
      subtitle={headerSubtitle}
      headerActions={headerRefreshActions(resolvedVisitorId)}
    >
      <div className="container container-in-shell visitor-detail-page">
        {refreshing && (
          <p className="visitors-list-refreshing" style={{ margin: '0 0 0.75rem' }}>
            Updating…
          </p>
        )}

        <VisitorMultiAccountPicker
          analyticsScope={analyticsScope}
          selectedCdpId={activeCdpId}
          onSelect={handleSelectCdpProfile}
        />

        {profileSection}

        <VisitorCombinedScopeBanner analyticsScope={analyticsScope} />

        {productAnalyticsEnabled && (
          <section className="visitor-section">
            <h2 className="visitor-section-title">Revenue</h2>
            <div className="card-grid visitor-metrics-grid visitor-revenue-grid">
              <MetricCard
                label="Net revenue"
                value={formatCommerceMoney(
                  commerceRevenue?.net_revenue != null
                    ? commerceRevenue.net_revenue
                    : netRevenue(commerceRevenue?.purchase_revenue, commerceRevenue?.refund_value),
                  commerceRevenue?.currency,
                )}
                hint={netRevenueBreakdownHint(
                  commerceRevenue?.purchase_revenue,
                  commerceRevenue?.refund_value,
                  commerceRevenue?.currency,
                )}
              />
              <MetricCard
                label="Purchases"
                value={Number(commerceRevenue?.purchases ?? 0).toLocaleString()}
                hint={formatCommerceMoney(commerceRevenue?.purchase_revenue, commerceRevenue?.currency)}
              />
              <MetricCard
                label="Refunds"
                value={Number(commerceRevenue?.refunds ?? 0).toLocaleString()}
                hint={formatCommerceMoney(commerceRevenue?.refund_value, commerceRevenue?.currency)}
              />
            </div>
          </section>
        )}

        <section className="visitor-section">
          <h2 className="visitor-section-title">Overview</h2>
          <div className="card-grid visitor-metrics-grid">
            <MetricCard label="Sessions" value={Number(visitor.total_sessions ?? 0)} />
            <MetricCard label="Page Views" value={Number(summary.total_pageviews ?? 0)} />
            <MetricCard
              label="Session Span"
              value={formatDuration(summary.total_session_duration_sec)}
              hint={summary.session_span_note}
            />
            <MetricCard label="Clicks" value={Number(summary.total_clicks ?? 0)} />
            <MetricCard label="Interactions" value={Number(summary.total_interactions ?? 0)} />
            <MetricCard label="Max Scroll" value={`${Number(summary.max_scroll_depth ?? 0)}%`} />
            <MetricCard label="Rage Clicks" value={Number(summary.rage_clicks ?? 0)} />
            <MetricCard label="Dead Clicks" value={Number(summary.dead_clicks ?? 0)} />
            <MetricCard
              label="Bounce"
              value={summary.is_bounce ? 'Yes' : 'No'}
              hint="Single page session"
            />
          </div>
          {summary.is_bounce ? (
            <div className="visitor-bounce-detail">
              <div className="visitor-bounce-detail-label">Bounced page</div>
              <code
                className="visitor-bounce-detail-path"
                title={bouncePageTitle({ bounce_page: summary.bounce_page, entry_page: summary.bounce_page })}
              >
                {summary.bounce_page || '—'}
              </code>
              <p className="visitor-bounce-detail-hint">
                Left after one page view in under 10 seconds.
              </p>
            </div>
          ) : null}
        </section>

        <VisitorDetailAnalytics
          dailyActivity={dailyActivity}
          topPages={top_pages}
          sessionChannelMix={summary.session_channel_mix}
        />

        {productAnalyticsEnabled && (
          <VisitorRecentActivity
            interactions={recentInteractions}
            productActivity={product_activity}
            conversions={conversions}
          />
        )}

        <section className="visitor-section">
          <h2 className="visitor-section-title">Traffic &amp; Device</h2>
          <div className="detail-grid visitor-traffic-device-grid">
            <div className="card visitor-detail-compact-card">
              <h3>Traffic Source</h3>
              <DetailRow label="Channel" value={traffic.channel_label || traffic.source_label} />
              <DetailRow label="Source" value={traffic.source_label} />
              <DetailRow label="Landing Page" value={traffic.landing_page} mono hideIfEmpty />
              <DetailRow label="Referrer URL" value={resolvedTraffic.referrer} mono hideIfEmpty />
              <DetailRow label="Referrer Domain" value={resolvedTraffic.referrer_domain} hideIfEmpty />
              <DetailRow label="UTM Source" value={resolvedTraffic.utm_source} hideIfEmpty />
              <DetailRow label="UTM Medium" value={resolvedTraffic.utm_medium} hideIfEmpty />
              <DetailRow label="UTM Campaign" value={resolvedTraffic.utm_campaign} hideIfEmpty />
            </div>

            <div className="card visitor-detail-compact-card">
              <h3>Location</h3>
              <DetailRow
                label="Country"
                value={summary.location.country_name || summary.location.country}
                hideIfEmpty
              />
              <DetailRow label="City" value={summary.location.city || 'Unknown'} />
              <DetailRow label="Region" value={summary.location.region} hideIfEmpty />
              <DetailRow
                label="Location Source"
                value={summary.location.location_source_label}
                hideIfEmpty
              />
              <DetailRow label="Timezone" value={summary.location.timezone} hideIfEmpty />
              <DetailRow
                label="Coordinates"
                value={
                  summary.location.latitude != null && summary.location.longitude != null
                    ? `${summary.location.latitude}, ${summary.location.longitude}`
                    : null
                }
                mono
                hideIfEmpty
              />
              {summary.location.accuracy_meters != null && (
                <DetailRow
                  label="GPS Accuracy"
                  value={`±${Math.round(summary.location.accuracy_meters)} meters`}
                />
              )}
              {summary.location.altitude != null && (
                <DetailRow label="Altitude" value={`${Math.round(summary.location.altitude)} m`} />
              )}
              <DetailRow label="IP (masked)" value={summary.location.ip_masked} mono hideIfEmpty />
              {summary.location.accuracy_note && (
                <p className="visitor-muted visitor-note">{summary.location.accuracy_note}</p>
              )}
            </div>

            <div className="card visitor-detail-compact-card">
              <h3>Browser &amp; Device</h3>
              <DetailRow
                label="Browser"
                value={summary.device?.browser_label || summary.device?.browser}
                hideIfEmpty
              />
              <DetailRow label="OS" value={summary.device?.os} hideIfEmpty />
              <DetailRow label="Device" value={summary.device?.device} hideIfEmpty />
              <DetailRow label="Language" value={summary.device?.language} hideIfEmpty />
            </div>
          </div>
        </section>

        <VisitorTouchAttribution
          attribution={summary.touch_attribution}
          sessions={allSessions}
        />

        <section className="visitor-section">
          <h2 className="visitor-section-title">Scroll Depth</h2>
          <div className="card">
            <p className="visitor-muted visitor-note">
              How far this visitor scrolled on each page. Bars show average and maximum scroll depth (%).
            </p>
            <VisitorScrollDepthChart pages={scroll_depth || []} />
          </div>
        </section>

        <section className="visitor-section">
          <h2 className="visitor-section-title">Engagement</h2>
          <div className="detail-grid visitor-engagement-grid">
            <div className="card visitor-engagement-card">
              <h3>Top Pages</h3>
              {top_pages.map((p) => (
                <div className="detail-item visitor-engagement-item" key={p.page_path}>
                  <span className="key visitor-engagement-key">
                    <button
                      type="button"
                      className="visitor-page-heatmap-link"
                      title={formatPagePathTitle(p.page_path)}
                      onClick={() => setHeatmapPage(p.page_path)}
                    >
                      {formatPagePath(p.page_path)}
                    </button>
                  </span>
                  <span className="visitor-engagement-meta">
                    {Number(p.views ?? 0)} views
                  </span>
                </div>
              ))}
              {!top_pages.length && <p className="visitor-muted">No pages</p>}
            </div>

            {productAnalyticsEnabled && (
              <div className="card visitor-engagement-card">
                <h3>Top Products</h3>
                {top_products
                  .map((p) => {
                    const label = formatProductLabel(p);
                    if (!label) return null;
                    const views = Number(p.views ?? 0);
                    const cartAdds = Number(p.cart_adds ?? 0);
                    const interactions = Number(p.interactions ?? p.clicks ?? 0);
                    const tail =
                      cartAdds > 0
                        ? `${cartAdds} cart add${cartAdds === 1 ? '' : 's'}`
                        : interactions > 0
                          ? `${interactions} action${interactions === 1 ? '' : 's'}`
                          : null;
                    return (
                      <div className="detail-item visitor-engagement-item" key={p.product_id || label}>
                        <span className="key visitor-engagement-key" title={label}>
                          {label}
                        </span>
                        <span className="visitor-engagement-meta">
                          {views} view{views === 1 ? '' : 's'}
                          {tail ? ` · ${tail}` : ''}
                        </span>
                      </div>
                    );
                  })
                  .filter(Boolean)}
                {!top_products.some((p) => formatProductLabel(p)) && (
                  <p className="visitor-muted">
                    No named products yet — open Product activity below for checkout and purchase lines.
                  </p>
                )}
              </div>
            )}
          </div>
        </section>

        {productAnalyticsEnabled && (
          <VisitorProductActivity activity={product_activity} />
        )}

        <VisitorJourneySection steps={journeySteps} />

        <section className="visitor-section">
          <h2 className="visitor-section-title">Sessions</h2>
          <p className="visitor-muted visitor-sessions-hint">
            Click a row to open session replay for that visit.
          </p>
          <div className="card">
            <div className="table-wrap">
              <table className="data-table visitor-sessions-table">
                <thead>
                  <tr>
                    <th>Session</th>
                    {showSessionVisitorId && <th>Visitor</th>}
                    <th>Started</th>
                    <th>Ended</th>
                    <th>Span</th>
                    <th>Pages</th>
                    <th>Source</th>
                    <th>Entry</th>
                    <th>Exit</th>
                    <th>Bounced page</th>
                    <th>Replay</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedSessions.map((s) => (
                    <tr
                      key={s.session_id}
                      className="table-row-clickable"
                      onClick={() => openSessionReplay(s.session_id)}
                    >
                      <td className="visitor-sessions-table__session">
                        <span className="visitor-id-row">
                          <code className="visitor-id-inline">{s.session_id}</code>
                          <CopyId value={s.session_id} label="session ID" />
                        </span>
                      </td>
                      {showSessionVisitorId && (
                        <td className="visitor-sessions-table__session">
                          <span className="visitor-id-row">
                            <code className="visitor-id-inline">{s.visitor_id || '—'}</code>
                            {s.visitor_id ? <CopyId value={s.visitor_id} label="visitor ID" /> : null}
                          </span>
                        </td>
                      )}
                      <td className="visitor-sessions-table__time">{formatLocalDateTime(s.started_at)}</td>
                      <td className="visitor-sessions-table__time">{formatLocalDateTime(s.ended_at)}</td>
                      <td>{formatDuration(s.duration_seconds || 0)}</td>
                      <td>{Number(s.pageview_count ?? 0)}</td>
                      <td title={s.touch?.source_label || undefined}>
                        {s.touch?.channel_label || s.touch?.source_label || '—'}
                      </td>
                      <td className="visitor-sessions-table__path" title={formatPagePathTitle(s.entry_page)}>
                        {s.entry_page ? formatPagePath(s.entry_page) : '—'}
                      </td>
                      <td className="visitor-sessions-table__path" title={formatPagePathTitle(s.exit_page)}>
                        {s.exit_page ? formatPagePath(s.exit_page) : '—'}
                      </td>
                      <td
                        className="visitor-sessions-table__path"
                        title={bouncePageTitle(s)}
                      >
                        {formatBounceDisplay(s)}
                      </td>
                      <td>
                        <span className="visitor-sessions-replay-link">Open replay</span>
                      </td>
                    </tr>
                  ))}
                  {!allSessions.length && (
                    <tr><td colSpan={showSessionVisitorId ? 11 : 10} className="visitor-muted">No sessions recorded.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            {allSessions.length > sessionLimit && (
              <Pagination
                offset={sessionOffset}
                limit={sessionLimit}
                total={allSessions.length}
                onOffsetChange={setSessionOffset}
                onLimitChange={handleSessionLimitChange}
                pageSizeOptions={SESSION_PAGE_SIZES}
                itemLabel="sessions"
              />
            )}
          </div>
        </section>

        <section className="visitor-section">
          <h2 className="visitor-section-title">Conversions</h2>
          <div className="card">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Type</th><th>Product</th><th>Value</th><th>Date</th></tr>
                </thead>
                <tbody>
                  {conversions.map((c, i) => (
                    <tr key={`${c.conversion_type}-${c.created_at}-${i}`}>
                      <td>{String(c.conversion_type ?? '').replace(/_/g, ' ')}</td>
                      <td>{c.product_id || '—'}</td>
                      <td>{c.currency ? `${c.currency} ${c.value}` : c.value}</td>
                      <td>{formatLocalDateTime(c.created_at)}</td>
                    </tr>
                  ))}
                  {!conversions.length && (
                    <tr><td colSpan={4} className="visitor-muted">No conversions</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="visitor-section">
          <VisitorHeatmapSection
            visitorId={resolvedVisitorId}
            pages={top_pages}
            sessions={allSessions}
            selectedPage={heatmapPage}
            cdpId={analyticsScope?.scope === 'multi_account_browser' ? activeCdpId : ''}
          />
        </section>
      </div>
    </AppShell>
  );
}
