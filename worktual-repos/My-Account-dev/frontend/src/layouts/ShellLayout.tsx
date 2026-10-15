// @ts-nocheck
import { Menu, X } from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";

import { BrandLogo } from "../components/BrandLogo.tsx";
import { useMediaQuery } from "../hooks/useMediaQuery.js";
import { prefetchRoute } from "../lib/routePrefetch.js";
import {
  applyUiPreferences,
  getUiPreferences,
  subscribeUiPreferences,
} from "../lib/uiPreferences.js";

export function ShellLayout({
  ariaLabel,
  children,
  footer,
  navItems,
  sectionLabel,
  shellClassName = "",
  sidebarClassName = "",
}) {
  const location = useLocation();
  // Match --bp-shell-compact-max / styles.css @media (max-width: 1280px)
  const isCompact = useMediaQuery("(max-width: 1280px)");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sidebarMode, setSidebarModeState] = useState(
    () => getUiPreferences().sidebarMode || "full",
  );

  useEffect(() => {
    applyUiPreferences();
    return subscribeUiPreferences((prefs) => {
      setSidebarModeState(prefs.sidebarMode || "full");
    });
  }, []);

  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!isCompact) {
      setDrawerOpen(false);
    }
  }, [isCompact]);

  useEffect(() => {
    if (!drawerOpen || !isCompact) {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKeyDown(event) {
      if (event.key === "Escape") {
        setDrawerOpen(false);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [drawerOpen, isCompact]);

  const modeClass =
    !isCompact && sidebarMode === "icons"
      ? "app-shell--sidebar-icons"
      : !isCompact && sidebarMode === "hybrid"
        ? "app-shell--sidebar-hybrid"
        : "app-shell--sidebar-full";

  const sidebarModeClass =
    !isCompact && sidebarMode === "icons"
      ? "sidebar--icons"
      : !isCompact && sidebarMode === "hybrid"
        ? "sidebar--hybrid"
        : "sidebar--full";

  const shellClasses = ["app-shell", modeClass, shellClassName].filter(Boolean).join(" ");
  const sidebarClasses = [
    "sidebar",
    sidebarClassName,
    sidebarModeClass,
    drawerOpen ? "is-open" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={shellClasses}>
      {isCompact ? (
        <header className="shell-header">
          <BrandLogo />
          <button
            aria-expanded={drawerOpen}
            aria-label={drawerOpen ? "Close navigation menu" : "Open navigation menu"}
            className="shell-header__toggle"
            onClick={() => setDrawerOpen((open) => !open)}
            type="button"
          >
            {drawerOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
        </header>
      ) : null}

      {isCompact && drawerOpen ? (
        <button
          aria-label="Close navigation menu"
          className="shell-drawer-backdrop"
          onClick={() => setDrawerOpen(false)}
          type="button"
        />
      ) : null}

      <aside aria-label={ariaLabel} className={sidebarClasses}>
        {!isCompact ? (
          <div className="sidebar__brand">
            <BrandLogo className="sidebar__brand-logo sidebar__brand-logo--full" />
            <BrandLogo className="sidebar__brand-logo sidebar__brand-logo--mark" mark />
          </div>
        ) : null}

        <nav className="sidebar__nav">
          <div className="sidebar__section-label">{sectionLabel}</div>
          {navItems.map((item) => {
            const key = item.id || item.path || item.label;
            const Icon = item.icon;

            function warmRoute() {
              if (item.path) {
                prefetchRoute(item.path);
              }
            }

            if (typeof item.onSelect === "function") {
              return (
                <button
                  aria-current={item.isActive ? "page" : undefined}
                  className={`sidebar__link${item.isActive ? " is-active" : ""}`}
                  key={key}
                  onClick={() => {
                    item.onSelect();
                    setDrawerOpen(false);
                  }}
                  onFocus={warmRoute}
                  onMouseEnter={warmRoute}
                  title={item.label}
                  type="button"
                >
                  <Icon className="sidebar__link-icon" size={19} strokeWidth={1.75} />
                  <span className="sidebar__link-label">{item.label}</span>
                </button>
              );
            }

            return (
              <NavLink
                key={key}
                className={({ isActive }) => `sidebar__link ${isActive ? "is-active" : ""}`}
                onFocus={warmRoute}
                onMouseEnter={warmRoute}
                title={item.label}
                to={item.path}
              >
                <Icon className="sidebar__link-icon" size={19} strokeWidth={1.75} />
                <span className="sidebar__link-label">{item.label}</span>
              </NavLink>
            );
          })}
        </nav>

        {footer ? <div className="sidebar__footer">{footer}</div> : null}
      </aside>

      <main className="app-content">{children}</main>
    </div>
  );
}
