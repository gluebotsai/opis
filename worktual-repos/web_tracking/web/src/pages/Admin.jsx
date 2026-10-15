import { useEffect, useState } from 'react';
import AppShell from '../layout/AppShell';
import { getAccount, getTrackingScript } from '../api';

function formatSiteType(siteType, businessType) {
  const type = String(siteType || '').toLowerCase();
  if (type === 'ecommerce') return 'Ecommerce (B2C)';
  if (type === 'b2b') return 'B2B';
  if (businessType) return String(businessType);
  return siteType || '—';
}

export default function Admin() {
  const [account, setAccount] = useState(null);
  const [script, setScript] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    Promise.all([getAccount(), getTrackingScript()])
      .then(([acc, scr]) => {
        setAccount(acc.data);
        setScript(scr.data.script);
      })
      .catch(console.error);
  }, []);

  const copyScript = () => {
    navigator.clipboard.writeText(script);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <AppShell title="Profile">
      <div className="container container-in-shell">

        {account && (
          <div className="detail-grid">
            <div className="card">
              <h3>Account details</h3>
              <div className="detail-item"><span className="key">Admin Name</span><span>{account.admin_name}</span></div>
              <div className="detail-item"><span className="key">Email</span><span>{account.email}</span></div>
              <div className="detail-item"><span className="key">Organization ID</span><span>{account.organization_id ?? '—'}</span></div>
              <div className="detail-item"><span className="key">Website ID</span><span>{account.website_id}</span></div>
              <div className="detail-item"><span className="key">Website URL</span><span>{account.website_url}</span></div>
              <div className="detail-item"><span className="key">Site Type</span><span>{formatSiteType(account.site_type, account.business_type)}</span></div>
              {account.features && (
                <div className="detail-item">
                  <span className="key">Dashboard</span>
                  <span>
                    {account.features.product_analytics ? 'Product analytics enabled' : 'Standard analytics (no products)'}
                  </span>
                </div>
              )}
              <div className="detail-item"><span className="key">Registered</span><span>{new Date(account.created_at).toLocaleDateString()}</span></div>
            </div>
          </div>
        )}

        <div className="card">
          <div className="module-card-header">
            <h3>Tracking script</h3>
            <button className="btn btn-black" onClick={copyScript}>
              {copied ? 'Copied' : 'Copy script'}
            </button>
          </div>
          <p className="module-card-note">
            Add this script to every page on your site (before &lt;/body&gt; or in your site layout).
            <strong> websiteUrl</strong> is your registered full URL{account?.website_url ? ` (${account.website_url})` : ''}. Leave it unchanged unless registration is updated.
          </p>
          <div className="form-group">
            <textarea readOnly value={script} />
          </div>
        </div>
      </div>
    </AppShell>
  );
}
