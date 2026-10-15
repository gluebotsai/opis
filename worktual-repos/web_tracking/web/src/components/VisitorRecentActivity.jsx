import { useMemo } from 'react';
import { formatLocalDateTime } from '../utils/formatDateTime';
import {
  commerceActivitySubtitle,
  interactionEventLabel,
  interactionEventTone,
} from '../utils/visitorInteractionDisplay';
import { resolveVisitorRecentCommerce } from '../utils/visitorCommerceEvents';

const MAX_ITEMS = 5;

export default function VisitorRecentActivity({
  interactions = [],
  productActivity = null,
  conversions = [],
}) {
  const items = useMemo(
    () => resolveVisitorRecentCommerce(interactions, productActivity, conversions).slice(0, MAX_ITEMS),
    [interactions, productActivity, conversions],
  );

  return (
    <section className="visitor-section">
      <h2 className="visitor-section-title">Recent interactions</h2>
      <div className="card visitor-activity-feed-card">
        {!items.length && (
          <p className="visitor-muted">No product or checkout activity recorded yet.</p>
        )}
        <ul className="visitor-activity-feed">
          {items.map((row) => {
            const tone = interactionEventTone(row.event_type);
            const subtitle = commerceActivitySubtitle(row);
            const key = `${row.created_at}-${row.event_type}-${row.product_id ?? ''}`;
            return (
              <li className="visitor-activity-feed-item" key={key}>
                <span className={`visitor-activity-pill visitor-activity-pill--${tone}`}>
                  {interactionEventLabel(row.event_type)}
                </span>
                <div className="visitor-activity-feed-body">
                  <div className="visitor-activity-feed-primary">{subtitle}</div>
                  <div className="visitor-activity-feed-meta">
                    {formatLocalDateTime(row.created_at)}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
