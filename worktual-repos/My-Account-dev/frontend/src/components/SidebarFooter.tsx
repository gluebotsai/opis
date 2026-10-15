// @ts-nocheck
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LogOut, Settings } from "lucide-react";

import { getSession, SESSION_UPDATED_EVENT } from "../lib/auth.js";
import {
  CUSTOMER_SESSION_UPDATED_EVENT,
  getCustomerSession,
} from "../lib/customerAuth.js";
import {
  getPartnerSession,
  PARTNER_SESSION_UPDATED_EVENT,
} from "../lib/partnerAuth.js";
import {
  getResellerSession,
  RESELLER_SESSION_UPDATED_EVENT,
} from "../lib/resellerAuth.js";
import {
  applyUiPreferences,
  getUiPreferences,
  subscribeUiPreferences,
} from "../lib/uiPreferences.js";
import { getRoleLabel } from "../lib/users.js";
import { SidebarPreferencesMenu } from "./SidebarPreferencesMenu.tsx";

const MENU_WIDTH = 240;
const MENU_GAP = 10;
const VIEWPORT_PAD = 8;

function resolveSidebarSession() {
  const staff = getSession();
  if (staff?.email || staff?.displayName || staff?.role) {
    return {
      displayName: staff.displayName || "",
      email: staff.email || "",
      roleLabel: getRoleLabel(staff.role) || "User",
    };
  }

  const reseller = getResellerSession();
  if (reseller?.email) {
    return {
      displayName: reseller.displayName || reseller.companyName || "",
      email: reseller.email || "",
      roleLabel: "Reseller",
    };
  }

  const partner = getPartnerSession();
  if (partner?.email) {
    return {
      displayName: partner.displayName || partner.companyName || "",
      email: partner.email || "",
      roleLabel: "Partner",
    };
  }

  const customer = getCustomerSession();
  if (customer?.email) {
    return {
      displayName: customer.displayName || "",
      email: customer.email || "",
      roleLabel: customer.branchId ? "Branch user" : "Customer",
    };
  }

  return {
    displayName: "",
    email: "",
    roleLabel: "User",
  };
}

function getPreferencesMenuPosition(anchorEl, menuEl) {
  if (!anchorEl) {
    return null;
  }

  const rect = anchorEl.getBoundingClientRect();
  const menuHeight = menuEl?.offsetHeight || 280;
  const menuWidth = menuEl?.offsetWidth || MENU_WIDTH;
  const railMode = rect.width < 120;

  let left;
  let top;

  if (railMode) {
    left = rect.right + MENU_GAP;
    if (left + menuWidth > window.innerWidth - VIEWPORT_PAD) {
      left = Math.max(VIEWPORT_PAD, rect.left - menuWidth - MENU_GAP);
    }
    top = rect.bottom - menuHeight;
  } else {
    left = rect.left;
    if (left + menuWidth > window.innerWidth - VIEWPORT_PAD) {
      left = Math.max(VIEWPORT_PAD, window.innerWidth - menuWidth - VIEWPORT_PAD);
    }
    top = rect.top - menuHeight - MENU_GAP;
  }

  top = Math.max(
    VIEWPORT_PAD,
    Math.min(top, window.innerHeight - menuHeight - VIEWPORT_PAD),
  );
  left = Math.max(
    VIEWPORT_PAD,
    Math.min(left, window.innerWidth - menuWidth - VIEWPORT_PAD),
  );

  return { top, left, width: railMode ? MENU_WIDTH : Math.max(menuWidth, rect.width) };
}

export function SidebarRoleCard({ onOpenAccount, accountActionLabel }) {
  const [session, setSession] = useState(() => resolveSidebarSession());
  const [menuOpen, setMenuOpen] = useState(false);
  const [prefs, setPrefs] = useState(() => getUiPreferences());
  const [menuPosition, setMenuPosition] = useState(null);
  const wrapRef = useRef(null);
  const buttonRef = useRef(null);
  const menuRef = useRef(null);
  const displayName = String(session?.displayName || "").trim();
  const primaryLabel = displayName || session.roleLabel;
  const secondaryLabel = displayName
    ? session?.email || session.roleLabel
    : session?.email || "Signed in";

  useEffect(() => {
    function refreshSession() {
      setSession(resolveSidebarSession());
    }

    const events = [
      SESSION_UPDATED_EVENT,
      CUSTOMER_SESSION_UPDATED_EVENT,
      PARTNER_SESSION_UPDATED_EVENT,
      RESELLER_SESSION_UPDATED_EVENT,
      "storage",
    ];

    for (const eventName of events) {
      window.addEventListener(eventName, refreshSession);
    }

    return () => {
      for (const eventName of events) {
        window.removeEventListener(eventName, refreshSession);
      }
    };
  }, []);

  useEffect(() => {
    applyUiPreferences();
  }, []);

  useEffect(() => {
    return subscribeUiPreferences((next) => {
      setPrefs({
        theme: next.theme,
        sidebarMode: next.sidebarMode,
      });
    });
  }, []);

  useLayoutEffect(() => {
    if (!menuOpen) {
      setMenuPosition(null);
      return undefined;
    }

    function updatePosition() {
      setMenuPosition(getPreferencesMenuPosition(buttonRef.current, menuRef.current));
    }

    updatePosition();
    const frame = window.requestAnimationFrame(updatePosition);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [menuOpen, prefs.sidebarMode]);

  useEffect(() => {
    if (!menuOpen) {
      return undefined;
    }

    function onPointerDown(event) {
      const target = event.target;
      if (wrapRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return;
      }
      setMenuOpen(false);
    }

    function onKeyDown(event) {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  const content = (
    <>
      <span className="sidebar__tenant-icon" aria-hidden="true">
        <Settings size={18} strokeWidth={1.75} />
      </span>
      <span className="sidebar__tenant-meta">
        <strong title={primaryLabel}>{primaryLabel}</strong>
        <small title={secondaryLabel}>{secondaryLabel}</small>
      </span>
    </>
  );

  const menu =
    menuOpen && typeof document !== "undefined"
      ? createPortal(
          <SidebarPreferencesMenu
            accountActionLabel={accountActionLabel}
            className="sidebar-preferences-menu--portal"
            menuRef={menuRef}
            onOpenAccount={onOpenAccount}
            onRequestClose={() => setMenuOpen(false)}
            sidebarMode={prefs.sidebarMode}
            style={
              menuPosition
                ? {
                    left: `${menuPosition.left}px`,
                    top: `${menuPosition.top}px`,
                    width: `${menuPosition.width}px`,
                  }
                : { visibility: "hidden" }
            }
            theme={prefs.theme}
          />,
          document.body,
        )
      : null;

  return (
    <div className="sidebar__tenant-wrap" ref={wrapRef}>
      {menu}
      <button
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        aria-label="Open appearance and profile settings"
        className="sidebar__tenant sidebar__tenant--button"
        onClick={() => setMenuOpen((open) => !open)}
        ref={buttonRef}
        title="Settings"
        type="button"
      >
        {content}
      </button>
    </div>
  );
}

export function SidebarFooter({ onLogout, onOpenAccount, accountActionLabel }) {
  return (
    <>
      <SidebarRoleCard accountActionLabel={accountActionLabel} onOpenAccount={onOpenAccount} />
      <button className="sidebar__logout" onClick={onLogout} title="Logout" type="button">
        <LogOut size={17} strokeWidth={1.75} />
        <span className="sidebar__logout-label">Logout</span>
      </button>
    </>
  );
}
