import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getFormLeads, getFormSubmissions } from '../api';
import { formatLocalDateTime } from '../utils/formatDateTime';
import { formatPagePath } from '../utils/formatDisplayLabels';
import {
  conversionRate,
  formatFieldLabel,
  formatFieldValue,
  formatFormLabel,
  isEmailLike,
} from '../utils/formsUtils';

function SubmissionFields({ fields }) {
  if (!fields || typeof fields !== 'object') {
    return <p className="forms-drawer-empty">No field values captured for this submission.</p>;
  }
  const entries = Object.entries(fields).filter(([, value]) => value !== null && value !== undefined && value !== '');

  if (!entries.length) {
    return <p className="forms-drawer-empty">No field values captured for this submission.</p>;
  }

  return (
    <dl className="forms-field-list">
      {entries.map(([key, value]) => {
        const text = formatFieldValue(value);
        const label = formatFieldLabel(key);
        const priority = ['email', 'mobileNo', 'mobile', 'phone', 'name', 'fullName', 'companyName', 'company'].includes(key);
        return (
          <div key={key} className={`forms-field-row${priority ? ' forms-field-row-priority' : ''}`}>
            <dt>{label}</dt>
            <dd className={text.length > 120 ? 'forms-field-value-long' : undefined}>
              {isEmailLike(key, text) ? (
                <a href={`mailto:${text}`}>{text}</a>
              ) : (
                text
              )}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

function LeadCaptureCard({ lead }) {
  const otherEntries = Object.entries(lead.other_fields || {});

  return (
    <article className={`forms-lead-card forms-lead-card--${lead.status}`}>
      <div className="forms-submission-head">
        <strong>{lead.status === 'submitted' ? 'Submitted lead' : 'Partial lead'}</strong>
        <span className={`forms-lead-badge forms-lead-badge--${lead.status}`}>
          {lead.status === 'submitted' ? 'Submitted' : 'Typed only'}
        </span>
      </div>
      <p className="forms-submission-meta">{formatLocalDateTime(lead.last_seen_at)}</p>
      {lead.page_path && <p className="forms-submission-meta">Page: {formatPagePath(lead.page_path)}</p>}
      {lead.visitor_id && (
        <p className="forms-submission-meta">
          Visitor:{' '}
          <Link to={`/visitors/${encodeURIComponent(lead.visitor_id)}`}>{lead.visitor_id}</Link>
        </p>
      )}

      <dl className="forms-field-list forms-lead-contact">
        <div className="forms-field-row forms-field-row-priority">
          <dt>Email</dt>
          <dd>
            {lead.email ? <a href={`mailto:${lead.email}`}>{lead.email}</a> : <span className="muted-cell">—</span>}
          </dd>
        </div>
        <div className="forms-field-row forms-field-row-priority">
          <dt>Mobile</dt>
          <dd>{lead.mobile || <span className="muted-cell">—</span>}</dd>
        </div>
        <div className="forms-field-row forms-field-row-priority">
          <dt>Name</dt>
          <dd>{lead.name || <span className="muted-cell">—</span>}</dd>
        </div>
        <div className="forms-field-row forms-field-row-priority">
          <dt>Company</dt>
          <dd>{lead.company || <span className="muted-cell">—</span>}</dd>
        </div>
        {lead.message && (
          <div className="forms-field-row">
            <dt>Message</dt>
            <dd className="forms-field-value-long">{lead.message}</dd>
          </div>
        )}
        {otherEntries.map(([key, value]) => (
          <div key={key} className="forms-field-row">
            <dt>{formatFieldLabel(key)}</dt>
            <dd>{formatFieldValue(value)}</dd>
          </div>
        ))}
      </dl>
    </article>
  );
}

export default function FormDetailDrawer({ open, formRow, period, onClose }) {
  const [submissions, setSubmissions] = useState([]);
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const formId = formRow?.form_id ?? '';
  const formLabel = formatFormLabel(formId, formRow?.form_name);

  useEffect(() => {
    if (!open || !formRow) return undefined;

    let cancelled = false;
    setLoading(true);
    setError(null);
    setSubmissions([]);
    setLeads([]);

    Promise.all([
      getFormLeads(period, formId, 50),
      getFormSubmissions(period, formId, 20),
    ])
      .then(([leadsRes, submissionsRes]) => {
        if (cancelled) return;
        setLeads(leadsRes.data?.leads || []);
        setSubmissions(submissionsRes.data?.submissions || []);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(
            err.response?.data?.detail
              || err.response?.data?.message
              || 'Failed to load form lead data.',
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, formRow, period, formId]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || !formRow) return null;

  const views = Number(formRow.views) || 0;
  const submits = Number(formRow.submits) || 0;
  const successes = Number(formRow.successes) || 0;
  const partialLeads = leads.filter((l) => l.status === 'partial').length;

  return (
    <div className="forms-drawer-root" role="presentation">
      <button type="button" className="forms-drawer-backdrop" aria-label="Close form details" onClick={onClose} />
      <aside className="forms-drawer-panel" role="dialog" aria-modal="true" aria-labelledby="forms-drawer-title">
        <header className="forms-drawer-header">
          <div>
            <h2 id="forms-drawer-title">{formLabel}</h2>
            {formId ? <p className="forms-drawer-meta">Form ID: {formId}</p> : (
              <p className="forms-drawer-meta">No form ID — matched by page or legacy tracking</p>
            )}
          </div>
          <button type="button" className="btn btn-outline btn-sm" onClick={onClose}>Close</button>
        </header>

        <section className="forms-drawer-stats">
          <div><span>Views</span><strong>{views}</strong></div>
          <div><span>Submits</span><strong>{submits}</strong></div>
          <div><span>Lead captures</span><strong>{leads.length}</strong></div>
          <div><span>Conversion</span><strong>{conversionRate(submits, views)}</strong></div>
        </section>

        <section className="forms-drawer-section">
          <h3>Lead captures</h3>
          <p className="forms-drawer-help">
            Email, mobile, name, and company are captured when a visitor types in a field — even if they do not click Submit.
            {partialLeads > 0 && ` ${partialLeads} partial lead(s) without submit.`}
          </p>
          {loading && <p className="forms-drawer-loading">Loading lead data…</p>}
          {error && <div className="forms-drawer-error">{error}</div>}
          {!loading && !error && leads.length === 0 && (
            <p className="forms-drawer-empty">No email, mobile, name, or company captured yet in this period.</p>
          )}
          {!loading && !error && leads.map((lead) => (
            <LeadCaptureCard key={`${lead.visitor_id}-${lead.last_seen_at}`} lead={lead} />
          ))}
        </section>

        <section className="forms-drawer-section forms-drawer-section-muted">
          <h3>Full submissions</h3>
          <p className="forms-drawer-help">Complete payloads captured when the visitor clicked Submit.</p>
          {!loading && !error && submissions.length === 0 && (
            <p className="forms-drawer-empty">No submit events in this period.</p>
          )}
          {!loading && !error && submissions.map((item) => (
            <article key={item.event_id} className="forms-submission-card">
              <div className="forms-submission-head">
                <strong>Submission</strong>
                <span>{formatLocalDateTime(item.created_at)}</span>
              </div>
              {item.page_path && (
                <p className="forms-submission-meta">Page: {formatPagePath(item.page_path)}</p>
              )}
              {item.visitor_id && (
                <p className="forms-submission-meta">
                  Visitor:{' '}
                  <Link to={`/visitors/${encodeURIComponent(item.visitor_id)}`}>{item.visitor_id}</Link>
                </p>
              )}
              <SubmissionFields fields={item.fields} />
            </article>
          ))}
        </section>
      </aside>
    </div>
  );
}
