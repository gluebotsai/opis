import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import {
  getBackLabel,
  getBackPath,
  hasReplayReturnHint,
  parseReturnToLocation,
} from '../utils/backNavigation';

function websiteLabel(url) {
  if (!url) return 'Site';
  try {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return new URL(url).host;
    }
  } catch {
    /* use raw */
  }
  return url;
}

function TopHeaderBack({ pathname, search, state, label }) {
  const navigate = useNavigate();
  const isReplay = /^\/sessions\/[^/]+\/replay$/.test(pathname);
  const returnLocation = parseReturnToLocation(search, state);
  const backPath = getBackPath(pathname, state, search);

  const useHistoryBack =
    isReplay &&
    hasReplayReturnHint(search, state) &&
    typeof window !== 'undefined' &&
    window.history.length > 1;

  const icon = (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );

  if (useHistoryBack) {
    return (
      <button
        type="button"
        className="top-header-back"
        aria-label={`Back to ${label}`}
        onClick={() => navigate(-1)}
      >
        {icon}
      </button>
    );
  }

  if (returnLocation) {
    return (
      <Link
        to={returnLocation}
        className="top-header-back"
        aria-label={`Back to ${label}`}
      >
        {icon}
      </Link>
    );
  }

  if (!backPath) return null;

  return (
    <Link to={backPath} className="top-header-back" aria-label={`Back to ${label}`}>
      {icon}
    </Link>
  );
}

export default function TopHeader({ title, subtitle, actions }) {
  const location = useLocation();
  const { user, selectWebsite } = useAuth();
  const backPath = getBackPath(location.pathname, location.state, location.search);
  const backLabel = getBackLabel(location.pathname, location.state, location.search);
  const adminLabel = user?.admin_name || 'Admin';
  const websites = user?.websites?.length ? user.websites : [];
  const activeWebsiteId = user?.website_id;
  const activeLabel = websiteLabel(user?.website_url) || activeWebsiteId || 'Site';

  const onWebsiteChange = async (event) => {
    const nextId = Number(event.target.value);
    if (!nextId || nextId === activeWebsiteId) return;
    try {
      await selectWebsite(nextId);
      window.location.reload();
    } catch (err) {
      console.error('Failed to switch website', err);
    }
  };

  return (
    <header className="top-header">
      <div className="top-header-left">
        {backPath && (
          <TopHeaderBack
            pathname={location.pathname}
            search={location.search}
            state={location.state}
            label={backLabel}
          />
        )}
        <div className="top-header-titles">
          <h1 className="top-header-title">{title}</h1>
          {subtitle && <p className="top-header-subtitle">{subtitle}</p>}
        </div>
      </div>
      <div className="top-header-right">
        {actions}
        {websites.length > 1 ? (
          <label className="top-header-website-select">
            <span className="sr-only">Website</span>
            <select className="wt-select" value={String(activeWebsiteId)} onChange={onWebsiteChange}>
              {websites.map((site) => (
                <option key={site.website_id} value={site.website_id}>
                  {websiteLabel(site.website_url)}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <div className="top-header-profile-pill" title={`${adminLabel} · ${activeLabel}`}>
            {adminLabel} · {activeLabel}
          </div>
        )}
      </div>
    </header>
  );
}
