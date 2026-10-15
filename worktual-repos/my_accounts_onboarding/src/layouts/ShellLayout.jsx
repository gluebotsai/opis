import { ChevronDown, ChevronRight, Menu, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";

import { BrandLogo } from "../components/BrandLogo.jsx";
import { useMediaQuery } from "../hooks/useMediaQuery.js";

function pathMatches(pathname, path) {
  if (!path) {
    return false;
  }
  return pathname === path || pathname.startsWith(`${path}/`);
}

function collectDescendantPaths(item) {
  if (!item) {
    return [];
  }
  if (item.children?.length) {
    return item.children.flatMap((child) => collectDescendantPaths(child));
  }
  return item.path ? [item.path] : [];
}

function itemOrDescendantActive(item, pathname) {
  return collectDescendantPaths(item).some((path) => pathMatches(pathname, path));
}

function NavLeafLink({ item, depth, showChevron }) {
  const linkClass = depth > 0 ? "sidebar__sublink" : "sidebar__link";

  return (
    <NavLink
      className={({ isActive }) => {
        const shouldHighlight = item.stub ? false : isActive;
        return `${linkClass} ${shouldHighlight ? "is-active" : ""}`;
      }}
      end={item.end}
      to={item.path}
    >
      {item.icon && depth === 0 ? (
        <item.icon className="sidebar__link-icon" size={19} strokeWidth={1.75} />
      ) : null}
      <span>{item.label}</span>
      {showChevron && depth === 0 ? (
        <ChevronRight className="sidebar__link-chevron" size={16} />
      ) : null}
    </NavLink>
  );
}

function NavItemGroup({ item, showChevron = false, depth = 0 }) {
  const location = useLocation();
  const descendantActive = useMemo(
    () => itemOrDescendantActive(item, location.pathname),
    [item, location.pathname],
  );
  const preferExpanded = Boolean(item.defaultExpanded) || descendantActive;
  const [expanded, setExpanded] = useState(preferExpanded);

  useEffect(() => {
    if (descendantActive) {
      setExpanded(true);
    }
  }, [descendantActive]);

  if (!item.children?.length) {
    return <NavLeafLink depth={depth} item={item} showChevron={showChevron} />;
  }

  const groupButtonClass =
    depth === 0
      ? `sidebar__link sidebar__link--group ${descendantActive ? "is-active" : ""}`
      : `sidebar__sublink sidebar__sublink--group ${descendantActive ? "is-active" : ""}`;

  return (
    <div
      className={`sidebar__group ${depth > 0 ? "sidebar__group--nested" : ""} ${
        descendantActive ? "is-active-group" : ""
      }`}
    >
      <button
        aria-expanded={expanded}
        className={groupButtonClass}
        onClick={() => setExpanded((open) => !open)}
        type="button"
      >
        {item.icon ? (
          <item.icon
            className="sidebar__link-icon"
            size={depth === 0 ? 19 : 16}
            strokeWidth={1.75}
          />
        ) : null}
        <span>{item.label}</span>
        {expanded ? (
          <ChevronDown className="sidebar__link-chevron" size={depth === 0 ? 16 : 14} />
        ) : (
          <ChevronRight className="sidebar__link-chevron" size={depth === 0 ? 16 : 14} />
        )}
      </button>
      {expanded ? (
        <div className={`sidebar__subnav ${depth > 0 ? "sidebar__subnav--nested" : ""}`}>
          {item.children.map((child) => (
            <NavItemGroup
              key={`${child.label}-${child.path || "group"}`}
              depth={depth + 1}
              item={child}
              showChevron={showChevron}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function ShellLayout({
  ariaLabel,
  children,
  footer,
  navItems,
  sectionLabel,
  shellClassName = "",
  showChevron = false,
  sidebarClassName = "",
}) {
  const location = useLocation();
  const isCompact = useMediaQuery("(max-width: 1023px)");
  const [drawerOpen, setDrawerOpen] = useState(false);

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

  const shellClasses = ["app-shell", shellClassName].filter(Boolean).join(" ");
  const sidebarClasses = ["sidebar", sidebarClassName, drawerOpen ? "is-open" : ""]
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
            <BrandLogo />
          </div>
        ) : null}

        <nav className="sidebar__nav">
          <div className="sidebar__section-label">{sectionLabel}</div>
          {navItems.map((item) => (
            <NavItemGroup
              key={item.path || item.label}
              item={item}
              showChevron={showChevron}
            />
          ))}
        </nav>

        {footer ? <div className="sidebar__footer">{footer}</div> : null}
      </aside>

      <main className="app-content">{children}</main>
    </div>
  );
}
