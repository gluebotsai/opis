import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { LOGO_URL } from '../brand';
const STORAGE_KEY = 'sidebarExpanded';

const BASE_NAV_ITEMS = [
  {
    path: '/',
    label: 'Dashboard',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" aria-hidden="true">
        <path d="M3 10.5L12 3l9 7.5V20a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1v-9.5z" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    path: '/visitors',
    label: 'Visitors',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" aria-hidden="true">
        <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    path: '/sessions',
    label: 'Session replay',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    path: '/behavior',
    label: 'Behavior',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" aria-hidden="true">
        <path d="M18 20V10M12 20V4M6 20v-6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
];

const FORMS_NAV = {
  path: '/forms',
  label: 'Forms',
  icon: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" aria-hidden="true">
      <path d="M9 11H4a2 2 0 00-2 2v7a2 2 0 002 2h5M9 11V9a2 2 0 012-2h2a2 2 0 012 2v2M9 11h6m4 0h1a2 2 0 012 2v7a2 2 0 01-2 2h-1M15 11V9a2 2 0 00-2-2h-2a2 2 0 00-2 2v2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
};

const PRODUCT_ANALYTICS_NAV = {
  path: '/product-analytics',
  label: 'Product Analytics',
  icon: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" aria-hidden="true">
      <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4H6z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3 6h18M16 10a4 4 0 01-8 0" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
};

function loadExpanded() {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function SidebarLink({ path, label, icon, active, expanded }) {
  return (
    <Link
      to={path}
      className={`sidebar-link${active ? ' active' : ''}`}
      aria-label={label}
      title={label}
    >
      <span className="sidebar-link-icon">{icon}</span>
      <span className="sidebar-link-label">{label}</span>
      {!expanded && <span className="sidebar-tooltip">{label}</span>}
    </Link>
  );
}

export default function Sidebar() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [expanded, setExpanded] = useState(loadExpanded);

  const navItems = useMemo(() => {
    const items = [...BASE_NAV_ITEMS];
    const formsEnabled =
      user?.features?.forms !== false && String(user?.business_type ?? '').toUpperCase() !== 'B2B';
    if (user?.features?.product_analytics) {
      items.push(PRODUCT_ANALYTICS_NAV);
    } else if (formsEnabled) {
      items.push(FORMS_NAV);
    }
    return items;
  }, [user?.features?.product_analytics, user?.features?.forms, user?.business_type]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, expanded ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [expanded]);

  const toggleExpanded = () => setExpanded((v) => !v);

  const handleSidebarClick = (e) => {
    if (e.target.closest('a, button')) return;
    toggleExpanded();
  };

  const isActive = (path) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname === path || location.pathname.startsWith(`${path}/`);
  };

  const profileInitial = (user?.admin_name || user?.email || 'A').charAt(0).toUpperCase();

  return (
    <aside
      className={`sidebar${expanded ? ' sidebar-expanded' : ''}`}
      aria-label="Main navigation"
      aria-expanded={expanded}
      onClick={handleSidebarClick}
    >
      <button
        type="button"
        className="sidebar-expand-toggle"
        onClick={(e) => {
          e.stopPropagation();
          toggleExpanded();
        }}
        aria-label={expanded ? 'Collapse sidebar' : 'Expand sidebar'}
        title={expanded ? 'Collapse menu' : 'Expand menu'}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          {expanded ? (
            <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          ) : (
            <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
          )}
        </svg>
      </button>

      <div className="sidebar-top">
        <div className="sidebar-brand-row">
          <Link to="/" className="sidebar-logo" aria-label="Worktual home">
            <img src={LOGO_URL} alt="" />
          </Link>
          {expanded && <span className="sidebar-brand-text">Worktual</span>}
        </div>

        <nav className="sidebar-nav">
          {navItems.map((item) => (
            <SidebarLink
              key={item.path}
              path={item.path}
              label={item.label}
              icon={item.icon}
              active={isActive(item.path)}
              expanded={expanded}
            />
          ))}
        </nav>
      </div>

      <div
        className="sidebar-spacer"
        aria-hidden="true"
        title={expanded ? 'Click to collapse sidebar' : 'Click to expand sidebar'}
      />

      <div className="sidebar-footer">
        <Link
          to="/admin"
          className={`sidebar-profile${isActive('/admin') ? ' active' : ''}`}
          aria-label="Profile"
          title="Profile"
        >
          <span className="sidebar-profile-initial">{profileInitial}</span>
          <span className="sidebar-link-label">Profile</span>
          {!expanded && <span className="sidebar-tooltip">Profile</span>}
        </Link>
        <button
          type="button"
          className="sidebar-logout"
          onClick={logout}
          aria-label="Log out"
          title="Log out"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" aria-hidden="true">
            <path d="M12 2v10M18.364 5.636a9 9 0 11-12.728 0" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="sidebar-link-label">Log out</span>
          {!expanded && <span className="sidebar-tooltip">Log out</span>}
        </button>
      </div>
    </aside>
  );
}
