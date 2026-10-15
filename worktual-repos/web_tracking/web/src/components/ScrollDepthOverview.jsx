import ReportsMainPanel from './ReportsMainPanel';
import { formatPagePath } from '../utils/formatDisplayLabels';

export default function ScrollDepthOverview({ data, loading }) {
  const pages = data?.pages || [];

  return (
    <ReportsMainPanel
      className="reports-table-card"
      title="Scroll Depth"
      subtitle="How far visitors scroll on each page"
    >
      <div className="table-wrap">
        <table className="reports-data-table">
          <thead>
            <tr>
              <th>Page Path</th>
              <th>Page Views</th>
              <th>Avg Scroll</th>
              <th>Max Scroll</th>
            </tr>
          </thead>
          <tbody>
            {!loading && pages.map((row) => (
              <tr key={row.page_path}>
                <td title={row.page_path}>{formatPagePath(row.page_path)}</td>
                <td>{Number(row.page_views).toLocaleString()}</td>
                <td>{row.avg_scroll_depth}%</td>
                <td>{row.max_scroll_depth}%</td>
              </tr>
            ))}
            {loading && (
              <tr>
                <td colSpan={4} className="state-cell">Loading scroll depth...</td>
              </tr>
            )}
            {!loading && !pages.length && (
              <tr>
                <td colSpan={4} className="state-cell">No scroll depth data for this period.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </ReportsMainPanel>
  );
}
