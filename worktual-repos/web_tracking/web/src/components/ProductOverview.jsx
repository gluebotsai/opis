function formatPrice(price, currency) {
  if (price === null || price === undefined || price === '') return '—';
  const amount = Number(price);
  if (Number.isNaN(amount)) return '—';
  if (currency) return `${currency} ${amount.toFixed(2)}`;
  return amount.toFixed(2);
}

export default function ProductOverview({ data, loading }) {
  const products = data?.products || [];

  return (
    <section className="analytics-section">
      <div className="section-header">
        <h2>Product Analytics</h2>
        <p className="section-subtitle">Most viewed products and engagement</p>
      </div>

      <div className="card analytics-table-card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th>Category</th>
                <th>Brand</th>
                <th>Price</th>
                <th>Views</th>
                <th>Actions</th>
                <th>Visitors</th>
                <th>Sessions</th>
              </tr>
            </thead>
            <tbody>
              {!loading && products.map((row) => (
                <tr key={row.product_id}>
                  <td>
                    <div className="product-cell-name">{row.product_name}</div>
                    <div className="product-cell-id">{row.product_id}</div>
                  </td>
                  <td>{row.product_category || '—'}</td>
                  <td>{row.product_brand || '—'}</td>
                  <td>{formatPrice(row.product_price, row.currency)}</td>
                  <td>{Number(row.views ?? 0).toLocaleString()}</td>
                  <td>{Number(row.interactions ?? row.clicks ?? 0).toLocaleString()}</td>
                  <td>{Number(row.unique_visitors).toLocaleString()}</td>
                  <td>{Number(row.sessions).toLocaleString()}</td>
                </tr>
              ))}
              {loading && (
                <tr>
                  <td colSpan={8} className="state-cell">Loading product analytics...</td>
                </tr>
              )}
              {!loading && !products.length && (
                <tr>
                  <td colSpan={8} className="state-cell">No product data for this period.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
