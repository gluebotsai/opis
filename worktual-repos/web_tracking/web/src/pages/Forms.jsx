import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import AppShell from '../layout/AppShell';
import { useAuth } from '../AuthContext';
import KpiIcon from '../components/KpiIcon';
import FormDetailDrawer from '../components/FormDetailDrawer';
import { getForms } from '../api';
import {
  conversionRate,
  formatFormLabel,
  FORMS_PERIOD_OPTIONS,
  funnelCount,
} from '../utils/formsUtils';

function KpiCard({ icon, label, value, subtitle }) {
  return (
    <div className="kpi-card-ref">
      <div className="kpi-card-ref-top">
        <KpiIcon name={icon} />
      </div>
      <div className="kpi-card-ref-label">{label}</div>
      <div className="kpi-card-ref-value">{value}</div>
      {subtitle && <div className="kpi-card-ref-subtitle">{subtitle}</div>}
    </div>
  );
}

export default function Forms() {
  const { user } = useAuth();
  const formsEnabled =
    user?.features?.forms !== false && String(user?.business_type ?? '').toUpperCase() !== 'B2B';

  const [period, setPeriod] = useState('month');

  useEffect(() => {
    setAnalyticsPeriod(period);
  }, [period]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [selectedForm, setSelectedForm] = useState(null);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (silent) setRefreshing(true);
    else {
      setLoading(true);
      setError(null);
    }

    try {
      const res = await getForms(period);
      setData(res.data);
    } catch (err) {
      console.error('Failed to load forms analytics', err);
      setError(
        err.response?.data?.detail
          || err.response?.data?.message
          || 'Failed to load form analytics.',
      );
      if (!silent) setData(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [period]);

  useEffect(() => {
    load();
  }, [load]);

  const funnel = data?.funnel || [];
  const byForm = data?.by_form || [];

  const summary = useMemo(() => {
    const views = funnelCount(funnel, 'form_view');
    const submits = funnelCount(funnel, 'form_submit');
    const successes = funnelCount(funnel, 'form_success');
    return {
      views,
      submits,
      successes,
      conversion: conversionRate(submits, views),
    };
  }, [funnel]);

  const tableRows = useMemo(
    () => [...byForm].sort((a, b) => Number(b.submits) - Number(a.submits) || Number(b.views) - Number(a.views)),
    [byForm],
  );

  const hasAnyFormActivity = summary.views > 0 || summary.submits > 0 || tableRows.length > 0;

  if (!formsEnabled) {
    return <Navigate to="/" replace />;
  }

  return (
    <AppShell
      title="Forms"
      subtitle="Form views, submissions, and field capture"
      headerActions={(
        <button className="btn btn-black" onClick={() => load({ silent: true })} disabled={loading || refreshing}>
          {loading || refreshing ? 'Loading…' : 'Refresh'}
        </button>
      )}
    >
      <div className="container container-in-shell forms-page">
        <div className="forms-toolbar">
          <div className="period-pills" role="tablist" aria-label="Forms period">
            {FORMS_PERIOD_OPTIONS.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={period === id}
                className={`period-pill${period === id ? ' active' : ''}`}
                onClick={() => setPeriod(id)}
                disabled={loading}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {loading && !data && (
          <p className="forms-loading">Loading form analytics…</p>
        )}

        {error && (
          <div className="status-banner status-banner-error" role="alert">
            <p className="error-msg">{error}</p>
            <button type="button" className="btn btn-outline" onClick={() => load()}>Retry</button>
          </div>
        )}

        {data && (
          <>
            <div className="reports-kpi-grid">
              <KpiCard icon="pageviews" label="Form Views" value={summary.views.toLocaleString()} />
              <KpiCard
                icon="visitors"
                label="Lead Captures"
                value={Number(data?.lead_captures || 0).toLocaleString()}
                subtitle="Email / mobile / name / company typed or submitted"
              />
              <KpiCard icon="clicks" label="Form Submits" value={summary.submits.toLocaleString()} />
              <KpiCard icon="conversions" label="Form Successes" value={summary.successes.toLocaleString()} />
            </div>

            <p className="forms-page-note">
              Lead captures include visitors who typed email, mobile, name, or company but did not submit. Click a form row to see lead details.
            </p>

            <div className="card forms-table-card">
              <h3 className="card-title-sm">Form Performance</h3>
              {!hasAnyFormActivity ? (
                <p className="table-empty">No form activity for this period. Submit a test form on your site to see data here.</p>
              ) : (
                <div className="table-wrap">
                  <table className="data-table forms-performance-table">
                    <thead>
                      <tr>
                        <th>Form</th>
                        <th>Views</th>
                        <th>Submits</th>
                        <th>Successes</th>
                        <th>Conversion</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tableRows.map((row) => {
                        const formKey = `${row.form_id}::${row.form_name || ''}`;
                        const label = formatFormLabel(row.form_id, row.form_name);
                        return (
                          <tr
                            key={formKey}
                            className="forms-table-row"
                            tabIndex={0}
                            onClick={() => setSelectedForm(row)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                setSelectedForm(row);
                              }
                            }}
                          >
                            <td>
                              <span className="forms-table-name">{label}</span>
                              {!row.form_id && <span className="forms-table-tag">No ID</span>}
                            </td>
                            <td>{Number(row.views) || 0}</td>
                            <td>{Number(row.submits) || 0}</td>
                            <td>{Number(row.successes) || 0}</td>
                            <td>{conversionRate(row.submits, row.views)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <FormDetailDrawer
        open={Boolean(selectedForm)}
        formRow={selectedForm}
        period={period}
        onClose={() => setSelectedForm(null)}
      />
    </AppShell>
  );
}
