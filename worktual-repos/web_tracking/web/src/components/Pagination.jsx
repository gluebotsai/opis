const DEFAULT_PAGE_SIZES = [10, 25, 50];

function visiblePages(currentPage, totalPages, maxButtons = 5) {
  if (totalPages <= maxButtons) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }

  const half = Math.floor(maxButtons / 2);
  let start = Math.max(1, currentPage - half);
  let end = start + maxButtons - 1;

  if (end > totalPages) {
    end = totalPages;
    start = end - maxButtons + 1;
  }

  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

export default function Pagination({
  offset,
  limit,
  total,
  loading = false,
  onOffsetChange,
  onLimitChange,
  pageSizeOptions = DEFAULT_PAGE_SIZES,
  itemLabel = 'visitors',
}) {
  const page = Math.floor(offset / limit) + 1;
  const totalPages = Math.max(1, Math.ceil(total / limit) || 1);
  const start = total ? offset + 1 : 0;
  const end = Math.min(offset + limit, total);
  const pages = visiblePages(page, totalPages);

  const goToPage = (nextPage) => {
    const safePage = Math.min(Math.max(1, nextPage), totalPages);
    const nextOffset = (safePage - 1) * limit;
    if (nextOffset !== offset) onOffsetChange(nextOffset);
  };

  const handleLimitChange = (event) => {
    const nextLimit = Number(event.target.value);
    if (!Number.isFinite(nextLimit) || nextLimit <= 0) return;
    onLimitChange?.(nextLimit);
  };

  return (
    <div className="pagination-bar" role="navigation" aria-label="Pagination">
      <div className="pagination-meta">
        <span>
          Showing {start}–{end} of {total.toLocaleString()} {itemLabel}
        </span>
        {onLimitChange && (
          <label className="pagination-size">
            <span>Rows per page</span>
            <select
              className="wt-select wt-select-sm"
              value={limit}
              onChange={handleLimitChange}
              disabled={loading}
              aria-label="Rows per page"
            >
              {pageSizeOptions.map((size) => (
                <option key={size} value={size}>{size}</option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div className="pagination-controls">
        <button
          type="button"
          className="btn btn-outline btn-sm"
          disabled={page <= 1 || loading}
          onClick={() => goToPage(1)}
          aria-label="First page"
        >
          First
        </button>
        <button
          type="button"
          className="btn btn-outline btn-sm"
          disabled={page <= 1 || loading}
          onClick={() => goToPage(page - 1)}
          aria-label="Previous page"
        >
          Previous
        </button>

        <div className="pagination-pages" role="group" aria-label="Page numbers">
          {pages.map((pageNumber) => (
            <button
              key={pageNumber}
              type="button"
              className={`btn btn-sm pagination-page${pageNumber === page ? ' active' : ''}`}
              disabled={loading}
              onClick={() => goToPage(pageNumber)}
              aria-current={pageNumber === page ? 'page' : undefined}
            >
              {pageNumber}
            </button>
          ))}
        </div>

        <button
          type="button"
          className="btn btn-outline btn-sm"
          disabled={page >= totalPages || loading}
          onClick={() => goToPage(page + 1)}
          aria-label="Next page"
        >
          Next
        </button>
        <button
          type="button"
          className="btn btn-outline btn-sm"
          disabled={page >= totalPages || loading}
          onClick={() => goToPage(totalPages)}
          aria-label="Last page"
        >
          Last
        </button>
      </div>
    </div>
  );
}
