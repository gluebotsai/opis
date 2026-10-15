import { Link } from 'react-router-dom';

const PRIORITY_CLASS = {
  High: 'priority-high',
  Medium: 'priority-medium',
  Low: 'priority-low',
};

export default function PrescriptiveSection({ prescriptive }) {
  if (!prescriptive) return null;

  const recommendations = prescriptive.recommendations ?? [];

  return (
    <section className="analytics-section">
      <div className="analytics-section-header">
        <span className="analytics-section-icon analytics-section-icon-prescriptive" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25">
            <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <div>
          <h2>Prescriptive analytics</h2>
          <p>What to do — ranked actions with expected impact.</p>
        </div>
      </div>

      {prescriptive.hint && (
        <div className="analytics-coworker-hint">{prescriptive.hint}</div>
      )}

      <div className="recommendation-grid">
        {recommendations.map((rec) => (
          <div key={rec.title} className="recommendation-card">
            <div className="recommendation-card-top">
              <span className={`recommendation-priority ${PRIORITY_CLASS[rec.priority] ?? 'priority-low'}`}>
                {rec.priority}
              </span>
              <span className="recommendation-star" aria-hidden="true">★</span>
            </div>
            <h3>{rec.title}</h3>
            <p className="recommendation-impact">{rec.impact}</p>
            <p className="recommendation-reason">{rec.reason}</p>
            <Link to={rec.action_href || '/'} className="recommendation-action">
              {rec.action_label} →
            </Link>
          </div>
        ))}
      </div>
    </section>
  );
}
