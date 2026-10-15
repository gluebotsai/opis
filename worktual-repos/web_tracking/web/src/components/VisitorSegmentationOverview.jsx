import { useCallback, useEffect, useState } from 'react';
import { AnalyticsDonutChart } from './Charts';
import ReportsMainPanel from './ReportsMainPanel';
import { getVisitorSegmentation } from '../api';
import { useAuth } from '../AuthContext';

const VISITOR_FIELDS = [{ key: 'visitors', label: 'visitors' }];
const EVENT_FIELDS = [{ key: 'events', label: 'events' }];

function SegmentationDonut({
  title,
  hint,
  chartData,
  loading,
  valueKey = 'visitors',
  extraFields = VISITOR_FIELDS,
  size = 'default',
  emptyLabel,
}) {
  return (
    <div className="reports-geo-donut-block visitor-segmentation-donut">
      <h3 className="reports-geo-donut-title">{title}</h3>
      {hint ? <p className="visitor-segmentation-donut-hint">{hint}</p> : null}
      <AnalyticsDonutChart
        chartData={chartData}
        loading={loading}
        labelKey="label"
        valueKey={valueKey}
        percentKey="percentage"
        extraFields={extraFields}
        size={size}
        loadingLabel={`Loading ${title.toLowerCase()}…`}
        emptyLabel={emptyLabel ?? `No data for ${title.toLowerCase()}.`}
      />
    </div>
  );
}

function formatOrgBusinessType(data, userBusinessType) {
  const fromApi = data?.organization_business_type;
  if (fromApi) return fromApi;
  if (userBusinessType) return userBusinessType;
  return null;
}

export default function VisitorSegmentationOverview({ period, loading: parentLoading }) {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [thresholdPct, setThresholdPct] = useState(50);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getVisitorSegmentation(period, thresholdPct);
      setData(res.data);
    } catch (err) {
      console.error(err);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [period, thresholdPct]);

  useEffect(() => {
    load();
  }, [load]);

  const busy = loading || parentLoading;
  const orgBusinessType = formatOrgBusinessType(data, user?.business_type);
  const profileLabel = data?.site_profile === 'b2b'
    ? 'B2B org profile'
    : data?.site_profile === 'b2c'
      ? 'B2C org profile'
      : 'Default profile';
  const pageThresholdHint = data?.page_view_threshold != null
    ? `Dynamic page threshold: ${Number(data.page_view_threshold).toLocaleString()} views (peak page ${Number(data.site_peak_page_views ?? 0).toLocaleString()} × ${data.page_engagement_threshold_pct ?? thresholdPct}%)`
    : null;
  return (
    <ReportsMainPanel
      className="visitor-segmentation-panel"
      title="Visitor segmentation"
      subtitle={data?.panel_subtitle ?? 'Account, conversion, interaction, and engagement splits for the selected period'}
    >
      {orgBusinessType ? (
        <p className="visitor-segmentation-profile-badge">
          PostgreSQL business_type: <strong>{orgBusinessType}</strong>
          {' · '}
          {profileLabel}
        </p>
      ) : null}
      <div className="visitor-segmentation-threshold">
        <label htmlFor="page-engagement-threshold">
          Page engagement threshold
        </label>
        <div className="visitor-segmentation-threshold-controls">
          <input
            id="page-engagement-threshold"
            type="range"
            min={10}
            max={90}
            step={5}
            value={thresholdPct}
            onChange={(event) => setThresholdPct(Number(event.target.value))}
            disabled={busy}
          />
          <span className="visitor-segmentation-threshold-value">{thresholdPct}%</span>
        </div>
        {pageThresholdHint ? (
          <p className="visitor-segmentation-threshold-hint">{pageThresholdHint}</p>
        ) : null}
      </div>

      <div className="analytics-grid visitor-segmentation-grid">
        <SegmentationDonut
          title="Intent level"
          hint={data?.intent_level_hint}
          chartData={data?.intent_level_ba}
          loading={busy}
          emptyLabel="No intent data in this period."
        />
        <SegmentationDonut
          title="Account behaviour"
          chartData={data?.account_behaviour}
          loading={busy}
        />
        <SegmentationDonut
          title="Conversion status"
          chartData={data?.conversion_status}
          loading={busy}
        />
        <SegmentationDonut
          title={data?.interaction_behaviour_title ?? 'Interaction behaviour'}
          chartData={data?.interaction_behaviour}
          loading={busy}
          valueKey="events"
          extraFields={EVENT_FIELDS}
        />
        <SegmentationDonut
          title={data?.page_engagement_title ?? 'Page engagement'}
          hint={data?.page_engagement_hint}
          chartData={data?.page_engagement}
          loading={busy}
        />
        <SegmentationDonut
          title="Engagement level"
          chartData={data?.engagement_level}
          loading={busy}
        />
      </div>
    </ReportsMainPanel>
  );
}
