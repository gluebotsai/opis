import { formatPagePath } from '../utils/formatDisplayLabels';

export default function VisitorScrollDepthChart({ pages = [] }) {
  if (!pages.length) {
    return <p className="visitor-muted">No scroll depth recorded for this visitor.</p>;
  }

  const maxDepth = Math.max(...pages.map((p) => Number(p.max_scroll_depth) || 0), 1);

  return (
    <div className="visitor-scroll-chart" role="img" aria-label="Scroll depth by page">
      {pages.map((page) => {
        const avg = Number(page.avg_scroll_depth) || 0;
        const max = Number(page.max_scroll_depth) || 0;
        const avgWidth = Math.max(4, (avg / maxDepth) * 100);
        const maxWidth = Math.max(4, (max / maxDepth) * 100);

        return (
          <div className="visitor-scroll-row" key={page.page_path}>
            <div className="visitor-scroll-label" title={page.page_path}>
              {formatPagePath(page.page_path)}
            </div>
            <div className="visitor-scroll-bars">
              <div className="visitor-scroll-bar-line">
                <span className="visitor-scroll-bar-caption">Avg {avg}%</span>
                <div className="visitor-scroll-bar-track">
                  <div className="visitor-scroll-bar-fill visitor-scroll-bar-avg" style={{ width: `${avgWidth}%` }} />
                </div>
              </div>
              <div className="visitor-scroll-bar-line">
                <span className="visitor-scroll-bar-caption">Max {max}%</span>
                <div className="visitor-scroll-bar-track">
                  <div className="visitor-scroll-bar-fill visitor-scroll-bar-max" style={{ width: `${maxWidth}%` }} />
                </div>
              </div>
            </div>
            <div className="visitor-scroll-meta">
              {Number(page.scroll_events || 0)} events
            </div>
          </div>
        );
      })}
    </div>
  );
}
