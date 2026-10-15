export default function DiagnosticSection({ diagnostic, severityLabel, severityClass }) {
  if (!diagnostic) return null;

  const factors = diagnostic.contributing_factors ?? [];
  const evidence = diagnostic.supporting_evidence ?? [];
  const metricLabel = diagnostic.metric?.replace(/_/g, ' ') ?? 'Metric';

  return (
    <section className="analytics-section">
      <div className="analytics-section-header">
        <span className="analytics-section-icon analytics-section-icon-diagnostic" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25">
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.35-4.35" strokeLinecap="round" />
          </svg>
        </span>
        <div>
          <h2>Diagnostic analytics</h2>
          <p>What happened and why — root-cause breakdown for anomalies.</p>
        </div>
      </div>

      <div className="insight-card">
        <div className="insight-card-top">
          <span className="insight-tag">{metricLabel}</span>
          <span className={`insight-badge ${severityClass}`}>{severityLabel}</span>
        </div>
        <h3 className="insight-headline">{diagnostic.headline}</h3>
        <p className="insight-stat">{diagnostic.stat}</p>
        <p className="insight-body">{diagnostic.observation}</p>
        <div className="insight-grid">
          <div>
            <h4>Contributing factors</h4>
            <ul className="factor-bars">
              {factors.map(({ label, pct }) => (
                <li key={label}>
                  <span className="factor-label">{label}</span>
                  <div className="factor-track">
                    <div className="factor-fill" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="factor-pct">{pct}%</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h4>Supporting evidence</h4>
            <div className="evidence-list">
              {evidence.map(({ title, detail }) => (
                <div key={title} className="evidence-item">
                  <strong>{title}</strong>
                  <span>{detail}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
