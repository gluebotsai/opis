import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../AuthContext.jsx';
import { LOGO_URL } from '../brand';

// Set hidden: true to hide a nav link without removing the route (toggle to show later).
const NAV_ITEMS = [
  { path: '/', label: 'Dashboard' },
  { path: '/visitors', label: 'Visitors' },
  { path: '/sessions', label: 'Session replay' },
  { path: '/behavior', label: 'Behavior' },
  { path: '/forms', label: 'Forms' },
  { path: '/performance', label: 'Performance', hidden: true },
  { path: '/errors', label: 'Errors', hidden: true },
  { path: '/chat', label: 'AI Assistant', accent: true },
  { path: '/admin', label: 'Profile' },
];

export default function Navbar() {
  const { logout } = useAuth();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  const isActive = (path) => (location.pathname === path ? 'active' : '');
  const closeMenu = () => setMenuOpen(false);
  const visibleItems = NAV_ITEMS.filter((item) => !item.hidden);

  return (
    <nav className="navbar">
      <div className="navbar-inner">
        <Link to="/" className="navbar-brand" onClick={closeMenu}>
          <img src={LOGO_URL} alt="Worktual" />
          <span className="navbar-brand-name">Worktual</span>
        </Link>

        <button
          type="button"
          className="navbar-toggle"
          aria-expanded={menuOpen}
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <span className="navbar-toggle-bar" />
          <span className="navbar-toggle-bar" />
          <span className="navbar-toggle-bar" />
        </button>

        <div className={`navbar-links${menuOpen ? ' is-open' : ''}`}>
          <div className="navbar-nav">
            {visibleItems.map(({ path, label, accent }) => (
              <Link
                key={path}
                to={path}
                className={`navbar-link${isActive(path) ? ' active' : ''}${accent ? ' navbar-link-accent' : ''}`}
                onClick={closeMenu}
              >
                {label}
              </Link>
            ))}
          </div>
          <div className="navbar-actions">
            <button type="button" className="btn btn-nav-logout" onClick={() => { closeMenu(); logout(); }}>
              Logout
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
}
