import { Link } from 'react-router-dom';

export default function VisitorCombinedScopeBanner({ analyticsScope }) {
  if (!analyticsScope || analyticsScope.scope !== 'cdp_linked') return null;

  const primary = analyticsScope.primary_visitor_id;
  const ids = analyticsScope.combined_visitor_ids ?? [];

  return (
    <div className="visitor-combined-scope-banner" role="status">
      <strong>Combined customer view</strong>
      <p>
        Analytics below include <strong>{ids.length} visitor IDs</strong> linked to the same CDP
        customer. Opening any linked ID shows the same combined data.
      </p>
      <ul className="visitor-combined-scope-ids">
        {ids.map((id) => (
          <li key={id}>
            {id === primary ? (
              <>
                <code className="visitor-detail-mono">{id}</code>
                <span className="visitor-combined-scope-current"> (this page)</span>
              </>
            ) : (
              <Link to={`/visitors/${encodeURIComponent(id)}`} className="visitor-detail-mono">
                {id}
              </Link>
            )}
          </li>
        ))}
      </ul>
      <p className="visitor-muted visitor-combined-scope-hint">
        Heatmaps still use the visitor ID in the URL only.
      </p>
    </div>
  );
}
