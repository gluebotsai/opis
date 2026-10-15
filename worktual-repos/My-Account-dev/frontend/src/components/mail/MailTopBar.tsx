// @ts-nocheck
import { useEffect, useRef, useState } from "react";
import { ChevronDown, Filter, RefreshCw, Search, X } from "lucide-react";

import {
  MAIL_LIST_DENSITY_OPTIONS,
  MAIL_LIST_FILTERS,
  MAIL_LIST_SORT_OPTIONS,
} from "../../lib/mailUi.js";

function ToolbarMenu({ open, onClose, children, className = "" }) {
  const menuRef = useRef(null);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    function handlePointerDown(event) {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        onClose();
      }
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return (
    <div className={`mail-topbar__menu ${className}`.trim()} ref={menuRef}>
      {children}
    </div>
  );
}

export function MailTopBar({
  searchQuery,
  onSearchChange,
  listFilter,
  onListFilterChange,
  sortBy,
  onSortByChange,
  listDensity,
  onListDensityChange,
  showPreview,
  onShowPreviewChange,
  onNewMail,
  onRefresh,
  listRefreshing,
  mailConfig,
  onDisconnectOutlook,
  oauthDisconnecting,
  showConnectOutlook = false,
  onConnectOutlook,
  oauthConnecting = false,
  showSetupStatus = false,
  setupStatusDetail = "",
  onDismissSetupStatus,
}) {
  const [filterOpen, setFilterOpen] = useState(false);
  const [viewOpen, setViewOpen] = useState(false);

  const activeFilterLabel =
    MAIL_LIST_FILTERS.find((option) => option.id === listFilter)?.label || "Filter";

  return (
    <header className="mail-topbar">
      <div className="mail-topbar__left">
        <label className="mail-topbar__search">
          <Search size={16} />
          <input
            aria-label="Search in mail"
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search in mail"
            type="search"
            value={searchQuery}
          />
          {searchQuery ? (
            <button
              aria-label="Clear search"
              className="mail-topbar__search-clear"
              onClick={() => onSearchChange("")}
              type="button"
            >
              <X size={14} />
            </button>
          ) : null}
        </label>
        <button className="primary-button mail-topbar__new-mail" onClick={onNewMail} type="button">
          New mail
          <ChevronDown size={14} />
        </button>
        <button
          aria-label="Refresh messages"
          className={`icon-button mail-topbar__icon ${listRefreshing ? "is-spinning" : ""}`}
          disabled={listRefreshing}
          onClick={onRefresh}
          type="button"
        >
          <RefreshCw size={16} />
        </button>

        <div className="mail-topbar__dropdown">
          <button
            className={`secondary-button mail-topbar__filter ${listFilter !== "all" ? "is-active" : ""}`}
            onClick={() => {
              setFilterOpen((current) => !current);
              setViewOpen(false);
            }}
            type="button"
          >
            <Filter size={14} />
            {activeFilterLabel}
            <ChevronDown size={14} />
          </button>
          <ToolbarMenu onClose={() => setFilterOpen(false)} open={filterOpen}>
            {MAIL_LIST_FILTERS.map((option) => (
              <button
                className={listFilter === option.id ? "is-active" : ""}
                key={option.id}
                onClick={() => {
                  onListFilterChange(option.id);
                  setFilterOpen(false);
                }}
                type="button"
              >
                {option.label}
              </button>
            ))}
          </ToolbarMenu>
        </div>

        <div className="mail-topbar__dropdown">
          <button
            className="secondary-button mail-topbar__view"
            onClick={() => {
              setViewOpen((current) => !current);
              setFilterOpen(false);
            }}
            type="button"
          >
            View
            <ChevronDown size={14} />
          </button>
          <ToolbarMenu className="mail-topbar__menu--view" onClose={() => setViewOpen(false)} open={viewOpen}>
            <div className="mail-topbar__menu-section">
              <span>Sort by</span>
              {MAIL_LIST_SORT_OPTIONS.map((option) => (
                <button
                  className={sortBy === option.id ? "is-active" : ""}
                  key={option.id}
                  onClick={() => onSortByChange(option.id)}
                  type="button"
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div className="mail-topbar__menu-section">
              <span>Density</span>
              {MAIL_LIST_DENSITY_OPTIONS.map((option) => (
                <button
                  className={listDensity === option.id ? "is-active" : ""}
                  key={option.id}
                  onClick={() => onListDensityChange(option.id)}
                  type="button"
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div className="mail-topbar__menu-section">
              <span>Layout</span>
              <button
                className={showPreview ? "is-active" : ""}
                onClick={() => onShowPreviewChange(true)}
                type="button"
              >
                Show preview
              </button>
              <button
                className={!showPreview ? "is-active" : ""}
                onClick={() => onShowPreviewChange(false)}
                type="button"
              >
                Subject only
              </button>
            </div>
          </ToolbarMenu>
        </div>
      </div>

      <div className="mail-topbar__right">
        {showConnectOutlook && onConnectOutlook ? (
          <button
            className="primary-button mail-topbar__connect-outlook"
            disabled={oauthConnecting}
            onClick={onConnectOutlook}
            type="button"
          >
            {oauthConnecting ? "Connecting…" : "Sign in with Microsoft"}
          </button>
        ) : null}

        {showSetupStatus && !showConnectOutlook ? (
          <div
            className="mail-topbar__status-pill mail-topbar__status-pill--warning"
            role="status"
            title={setupStatusDetail}
          >
            <span aria-hidden="true" className="mail-topbar__status-pill-dot" />
            <span className="mail-topbar__status-pill-label">Mailbox not available yet</span>
            {onDismissSetupStatus ? (
              <button
                aria-label="Dismiss mailbox setup notice"
                className="mail-topbar__status-pill-dismiss"
                onClick={onDismissSetupStatus}
                type="button"
              >
                <X size={14} strokeWidth={1.75} />
              </button>
            ) : null}
          </div>
        ) : null}

        {mailConfig?.outlookConnected ? (
          <div className="mail-topbar__connection">
            <span aria-hidden="true" className="mail-topbar__connection-dot" />
            <span>
              Outlook connected as <strong>{mailConfig.outlookEmail}</strong>
            </span>
            <button
              className="secondary-button"
              disabled={oauthDisconnecting}
              onClick={onDisconnectOutlook}
              type="button"
            >
              {oauthDisconnecting ? "Disconnecting..." : "Disconnect"}
            </button>
          </div>
        ) : null}
      </div>
    </header>
  );
}
