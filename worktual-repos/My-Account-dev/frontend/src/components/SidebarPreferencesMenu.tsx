// @ts-nocheck
import {
  Check,
  // Monitor,
  // Moon,
  PanelLeft,
  PanelLeftClose,
  Sun,
  UserRound,
} from "lucide-react";

import {
  SIDEBAR_MODE_OPTIONS,
  THEME_OPTIONS,
  setSidebarMode,
  setTheme,
} from "../lib/uiPreferences.js";

const THEME_META = {
  light: { label: "Light", icon: Sun },
  // dark: { label: "Dark", icon: Moon },
  // system: { label: "System", icon: Monitor },
};

const SIDEBAR_META = {
  full: { label: "Full", icon: PanelLeft, hint: "Icons and labels" },
  icons: { label: "Icons only", icon: PanelLeftClose, hint: "Compact icon rail" },
  hybrid: { label: "Hybrid", icon: PanelLeft, hint: "Expand on hover" },
};

export function SidebarPreferencesMenu({
  accountActionLabel = "My Profile",
  className = "",
  menuRef,
  onOpenAccount,
  onRequestClose,
  sidebarMode,
  style,
  theme,
}) {
  return (
    <div
      aria-label="Appearance and sidebar settings"
      className={`sidebar-preferences-menu${className ? ` ${className}` : ""}`}
      ref={menuRef}
      role="menu"
      style={style}
    >
      <section className="sidebar-preferences-menu__group" aria-label="Theme">
        <p className="sidebar-preferences-menu__label">Theme</p>
        <div className="sidebar-preferences-menu__options" role="group">
          {THEME_OPTIONS.map((value) => {
            const meta = THEME_META[value];
            const Icon = meta.icon;
            const selected = theme === value;
            return (
              <button
                aria-checked={selected}
                className={`sidebar-preferences-menu__option${selected ? " is-selected" : ""}`}
                key={value}
                onClick={() => {
                  setTheme(value);
                }}
                role="menuitemradio"
                type="button"
              >
                <Icon aria-hidden="true" size={16} strokeWidth={1.75} />
                <span>{meta.label}</span>
                {selected ? <Check aria-hidden="true" className="sidebar-preferences-menu__check" size={14} /> : null}
              </button>
            );
          })}
        </div>
      </section>

      <section className="sidebar-preferences-menu__group" aria-label="Sidebar">
        <p className="sidebar-preferences-menu__label">Sidebar</p>
        <div className="sidebar-preferences-menu__options" role="group">
          {SIDEBAR_MODE_OPTIONS.map((value) => {
            const meta = SIDEBAR_META[value];
            const Icon = meta.icon;
            const selected = sidebarMode === value;
            return (
              <button
                aria-checked={selected}
                className={`sidebar-preferences-menu__option${selected ? " is-selected" : ""}`}
                key={value}
                onClick={() => {
                  setSidebarMode(value);
                }}
                role="menuitemradio"
                title={meta.hint}
                type="button"
              >
                <Icon aria-hidden="true" size={16} strokeWidth={1.75} />
                <span>{meta.label}</span>
                {selected ? <Check aria-hidden="true" className="sidebar-preferences-menu__check" size={14} /> : null}
              </button>
            );
          })}
        </div>
      </section>

      {typeof onOpenAccount === "function" ? (
        <>
          <div className="sidebar-preferences-menu__divider" />
          <button
            className="sidebar-preferences-menu__option sidebar-preferences-menu__option--action"
            onClick={() => {
              onRequestClose?.();
              onOpenAccount();
            }}
            role="menuitem"
            type="button"
          >
            <UserRound aria-hidden="true" size={16} strokeWidth={1.75} />
            <span>{accountActionLabel}</span>
          </button>
        </>
      ) : null}
    </div>
  );
}
