import { Link, useLocation, useNavigate } from "react-router-dom";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type MouseEvent as ReactMouseEvent } from "react";
import {
  Bell,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  LogOut,
  Menu,
  X,
} from "lucide-react";
import { WorktualLogo } from "@/components/brand/WorktualLogo";
import {
  getModuleByPath,
  getParentModule,
  modulesForSession,
  type AppModule,
} from "@/config/modules";
import { AppBreadcrumb } from "@/components/layout/AppBreadcrumb";
import { SidebarDraftsItem } from "@/components/layout/SidebarDraftsItem";
import {
  getActivePack,
  getActivePackServerSnapshot,
  subscribeActivePack,
} from "@/lib/industry-packs";
import {
  getNavCrumbs,
  getParentHref,
  type NavLabels,
} from "@/lib/nav-hierarchy";
import {
  formatNotificationTime,
  getNotificationsServerSnapshot,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  notificationCanRoute,
  subscribeNotifications,
  syncNotificationsFromRecommendations,
  syncNotificationsFromServer,
  unreadNotificationCount,
  type AppNotification,
} from "@/lib/notifications-store";
import type { CampaignUser } from "@/services/auth.service";
import { useAppDispatch } from "@/hooks/redux";
import { logout } from "@/store/slices/authSlice";
import { SidebarLayoutProvider } from "@/contexts/sidebar-layout";

const SIDEBAR_COLLAPSED_KEY = "worktual.campaign.sidebarCollapsed";
const SIDEBAR_WIDTH_KEY = "worktual.campaign.sidebarWidth";
const SIDEBAR_MIN_W = 72;
const SIDEBAR_DEFAULT_W = 212;
const SIDEBAR_MAX_W = 260;
const SIDEBAR_SNAP_W = 100;

function clampSidebarWidth(n: number) {
  return Math.min(SIDEBAR_MAX_W, Math.max(SIDEBAR_MIN_W, Math.round(n)));
}

function isCreateCampaignPath(pathname: string) {
  return (
    pathname === "/campaigns/create" ||
    pathname.startsWith("/campaigns/create/") ||
    pathname === "/campaigns/new" ||
    pathname.startsWith("/campaigns/new/")
  );
}

function readSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

function writeSidebarCollapsed(collapsed: boolean) {
  try {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? "1" : "0");
  } catch {
    /* ignore */
  }
}

function readSidebarWidth(): number {
  try {
    const raw = Number.parseInt(
      localStorage.getItem(SIDEBAR_WIDTH_KEY) || "",
      10,
    );
    if (Number.isFinite(raw)) return clampSidebarWidth(raw);
  } catch {
    /* ignore */
  }
  return SIDEBAR_DEFAULT_W;
}

function writeSidebarWidth(width: number) {
  try {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, String(clampSidebarWidth(width)));
  } catch {
    /* ignore */
  }
}

function createTool(search: string): string | null {
  return new URLSearchParams(search).get("tool");
}

function isModuleActive(
  href: string,
  pathname: string,
  moduleId: string,
  search = "",
) {
  const tool = createTool(search);
  if (moduleId === "drafts") {
    return (
      (pathname === "/campaigns/create" || pathname === "/campaigns/new") &&
      tool === "drafts"
    );
  }
  if (moduleId === "create_campaign") {
    if (
      (pathname === "/campaigns/create" || pathname === "/campaigns/new") &&
      tool === "drafts"
    ) {
      return false;
    }
    return isCreateCampaignPath(pathname);
  }
  if (moduleId === "calendar") {
    return (
      pathname === "/campaigns/calendar" ||
      pathname.startsWith("/campaigns/calendar/")
    );
  }
  const pathOnly = href.split("?")[0] || href;
  return pathname === pathOnly || pathname.startsWith(`${pathOnly}/`);
}

function isChildActive(child: AppModule, pathname: string, search = "") {
  return isModuleActive(child.href, pathname, child.id, search);
}

function navItemClass(
  active: boolean,
  collapsed?: boolean,
  opts?: { parentWithChild?: boolean },
) {
  const base = `flex items-center rounded-xl text-sm no-underline transition ${
    collapsed ? "justify-center px-2 py-2.5" : "gap-3 px-3 py-2.5"
  }`;
  if (active && opts?.parentWithChild) {
    // Parent of an active child: text emphasis only, no fill (avoids double pill).
    return `${base} text-white`;
  }
  if (active) {
    return `${base} nav-item-active text-white`;
  }
  return `${base} text-white/70 hover:bg-white/5 hover:text-white`;
}

function SidebarNav({
  session,
  showClose,
  onClose,
  collapsed = false,
}: {
  session: CampaignUser;
  showClose?: boolean;
  onClose?: () => void;
  collapsed?: boolean;
}) {
  const { pathname, search } = useLocation();
  const dispatch = useAppDispatch();
  const [pending, setPending] = useState(false);
  const pack = useSyncExternalStore(
    subscribeActivePack,
    getActivePack,
    getActivePackServerSnapshot,
  );
  const modules = useMemo(
    () => modulesForSession(session.role, pack),
    [session.role, pack],
  );

  return (
    <div className="flex h-full flex-col bg-[#111111] text-white">
      <div className={`pb-4 pt-5 ${collapsed ? "px-3" : "px-5"}`}>
        <div
          className={`flex items-start ${collapsed ? "justify-center" : "justify-between"}`}
        >
          <div
            className={
              collapsed ? "flex justify-center" : "flex flex-col items-start"
            }
          >
            <WorktualLogo
              inverted
              markClassName="size-8"
              wordmark={!collapsed}
            />
            {!collapsed ? (
              <p className="mt-2 text-[10px] uppercase tracking-[0.14em] text-white/45">
                CAMPAIGN PORTAL
              </p>
            ) : null}
          </div>
          {showClose ? (
            <button
              type="button"
              className="inline-flex size-9 items-center justify-center rounded-xl text-white/60 hover:bg-white/5 hover:text-white"
              onClick={onClose}
              aria-label="Close menu"
            >
              <X className="size-5" strokeWidth={1.75} />
            </button>
          ) : null}
        </div>
      </div>

      <nav
        className={`sidebar-nav scroll-overlay flex-1 space-y-1 overflow-y-auto py-2 ${
          collapsed ? "px-2" : "px-3"
        }`}
      >
        <ul className="flex flex-col gap-1">
          {modules.map((mod) => {
            const Icon = mod.icon;
            const children = mod.children || [];
            const hasChildren = children.length > 0;
            const active = isModuleActive(mod.href, pathname, mod.id, search);
            const childActive = children.some((c) =>
              isChildActive(c, pathname, search),
            );
            const expanded = hasChildren && !collapsed;

            if (mod.id === "drafts") {
              return (
                <SidebarDraftsItem
                  key={mod.id}
                  mod={mod}
                  collapsed={collapsed}
                  active={active}
                  navItemClass={navItemClass}
                  onNavigate={onClose}
                />
              );
            }

            if (!hasChildren) {
              return (
                <li key={mod.id}>
                  <Link
                    to={mod.href}
                    onClick={() => onClose?.()}
                    title={collapsed ? mod.label : undefined}
                    className={navItemClass(active, collapsed)}
                  >
                    <Icon className="size-4 shrink-0 opacity-90" strokeWidth={1.75} />
                    {!collapsed ? (
                      <span className="truncate text-inherit">{mod.label}</span>
                    ) : null}
                  </Link>
                </li>
              );
            }

            return (
              <li key={mod.id}>
                <div
                  className={`flex items-center ${collapsed ? "justify-center" : "gap-0.5"}`}
                >
                  <Link
                    to={mod.href}
                    onClick={() => onClose?.()}
                    title={collapsed ? mod.label : undefined}
                    className={`min-w-0 flex-1 ${navItemClass(
                      (active && !childActive) || childActive,
                      collapsed,
                      { parentWithChild: childActive },
                    )}`}
                  >
                    <Icon className="size-4 shrink-0 opacity-90" strokeWidth={1.75} />
                    {!collapsed ? (
                      <span className="truncate text-inherit">{mod.label}</span>
                    ) : null}
                  </Link>
                  {!collapsed ? (
                    <button
                      type="button"
                      aria-label={expanded ? "Collapse" : "Expand"}
                      aria-expanded={expanded}
                      onClick={() => {}}
                      className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl text-white/60 hover:bg-white/5 hover:text-white"
                    >
                      <ChevronDown
                        className={`size-4 transition-transform ${expanded ? "rotate-0" : "-rotate-90"}`}
                        strokeWidth={1.75}
                      />
                    </button>
                  ) : null}
                </div>
                {expanded ? (
                  <ul className="mt-0.5 ml-3 space-y-0.5 border-l border-white/10 pl-2">
                    {children.map((child) => {
                      const ChildIcon = child.icon;
                      const cActive = isChildActive(child, pathname, search);
                      return (
                        <li key={child.id}>
                          <Link
                            to={child.href}
                            onClick={() => onClose?.()}
                            className={navItemClass(cActive)}
                          >
                            <ChildIcon
                              className="size-3.5 shrink-0 opacity-90"
                              strokeWidth={1.75}
                            />
                            <span className="truncate text-[13px] text-inherit">
                              {child.label}
                            </span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      </nav>

      <div
        className={`mt-auto space-y-2 border-t border-white/10 ${
          collapsed ? "p-2" : "p-3"
        }`}
      >
        <div
          className={`flex items-center rounded-xl bg-white/5 ${
            collapsed ? "justify-center px-2 py-2.5" : "gap-3 px-3 py-3"
          }`}
          title={collapsed ? session.name : undefined}
        >
          <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-sm font-medium text-white">
            {session.initials}
          </span>
          {!collapsed ? (
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-white">
                {session.name}
              </p>
              <p className="truncate text-xs text-white/45">
                {session.role}
                {session.orgName?.trim() ? ` · ${session.orgName.trim()}` : ""}
              </p>
            </div>
          ) : null}
        </div>
        <button
          type="button"
          disabled={pending}
          title="Logout"
          onClick={() => {
            onClose?.();
            setPending(true);
            void dispatch(logout()).finally(() => setPending(false));
          }}
          className={`flex w-full items-center rounded-xl text-sm text-white/70 transition hover:bg-white/5 hover:text-white disabled:opacity-60 ${
            collapsed ? "justify-center px-2 py-2.5" : "gap-3 px-3 py-2.5"
          }`}
        >
          <LogOut className="size-4" strokeWidth={1.75} />
          {!collapsed ? "Logout" : null}
        </button>
      </div>
    </div>
  );
}

export function Sidebar({
  session,
  open = false,
  onClose,
  collapsed = false,
  width = SIDEBAR_DEFAULT_W,
  onToggleCollapsed,
  onResize,
}: {
  session: CampaignUser;
  open?: boolean;
  onClose?: () => void;
  collapsed?: boolean;
  width?: number;
  onToggleCollapsed?: () => void;
  onResize?: (width: number, collapsed: boolean) => void;
}) {
  const dragRef = useRef<{ startX: number; startW: number } | null>(null);
  const [dragW, setDragW] = useState<number | null>(null);
  const displayW =
    dragW ?? (collapsed ? SIDEBAR_MIN_W : clampSidebarWidth(width));
  const navCollapsed = displayW <= SIDEBAR_SNAP_W;
  const dragging = dragW != null;

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag || !onResize) return;
      const next = clampSidebarWidth(drag.startW + (e.clientX - drag.startX));
      setDragW(next);
      onResize(next, next <= SIDEBAR_SNAP_W);
    };
    const onUp = () => {
      dragRef.current = null;
      setDragW(null);
      document.body.style.removeProperty("cursor");
      document.body.style.removeProperty("user-select");
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.removeProperty("cursor");
      document.body.style.removeProperty("user-select");
    };
  }, [dragging, onResize]);

  return (
    <>
      <aside
        className={`relative hidden h-full shrink-0 md:block ${
          dragging ? "" : "transition-[width] duration-200 ease-out"
        }`}
        style={{ width: displayW }}
      >
        <SidebarNav session={session} collapsed={navCollapsed} />
        {onResize ? (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize sidebar"
            aria-valuemin={SIDEBAR_MIN_W}
            aria-valuemax={SIDEBAR_MAX_W}
            aria-valuenow={displayW}
            title="Drag to resize"
            onMouseDown={(e: ReactMouseEvent) => {
              e.preventDefault();
              dragRef.current = { startX: e.clientX, startW: displayW };
              setDragW(displayW);
              document.body.style.cursor = "col-resize";
              document.body.style.userSelect = "none";
            }}
            className="absolute inset-y-0 -right-1 z-[9] w-2 cursor-col-resize hover:bg-white/20"
          />
        ) : null}
        {onToggleCollapsed ? (
          <button
            type="button"
            onClick={onToggleCollapsed}
            onMouseDown={(e) => e.stopPropagation()}
            className="absolute -right-3 top-7 z-10 flex size-6 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-500 shadow-sm transition hover:bg-neutral-50 hover:text-neutral-800"
            aria-label={navCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {navCollapsed ? (
              <ChevronRight className="size-3.5" strokeWidth={2} />
            ) : (
              <ChevronLeft className="size-3.5" strokeWidth={2} />
            )}
          </button>
        ) : null}
      </aside>

      <div
        className={`fixed inset-0 z-50 md:hidden ${open ? "pointer-events-auto" : "pointer-events-none"}`}
        aria-hidden={!open}
      >
        <button
          type="button"
          className={`absolute inset-0 bg-black/40 transition-opacity ${open ? "opacity-100" : "opacity-0"}`}
          aria-label="Close menu"
          onClick={onClose}
        />
        <aside
          className={`absolute inset-y-0 left-0 flex h-full w-[min(280px,88vw)] flex-col bg-[#111111] text-white shadow-xl transition-transform duration-200 ease-out ${
            open ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <SidebarNav session={session} showClose onClose={onClose} />
        </aside>
      </div>
    </>
  );
}

export function AppShell({
  session,
  children,
  embedMode = false,
}: {
  session: CampaignUser;
  children: React.ReactNode;
  embedMode?: boolean;
}) {
  const { pathname } = useLocation();
  const pack = useSyncExternalStore(
    subscribeActivePack,
    getActivePack,
    getActivePackServerSnapshot,
  );
  const [navOpen, setNavOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readSidebarCollapsed);
  const [sidebarWidth, setSidebarWidth] = useState(readSidebarWidth);

  const applySidebarLayout = useCallback((width: number, collapsed: boolean) => {
    setSidebarCollapsed(collapsed);
    writeSidebarCollapsed(collapsed);
    if (!collapsed) {
      setSidebarWidth(width);
      writeSidebarWidth(width);
    }
  }, []);

  const toggleSidebarCollapsed = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      writeSidebarCollapsed(next);
      return next;
    });
  };

  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!navOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [navOpen]);

  return (
    <div className="flex h-svh overflow-hidden bg-[#f3f4f6]">
      {embedMode ? null : (
        <Sidebar
          session={session}
          open={navOpen}
          onClose={() => setNavOpen(false)}
          collapsed={sidebarCollapsed}
          width={sidebarWidth}
          onToggleCollapsed={toggleSidebarCollapsed}
          onResize={applySidebarLayout}
        />
      )}
      <SidebarLayoutProvider collapsed={embedMode ? true : sidebarCollapsed}>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {embedMode ? (
            <EmbedSubpageChrome />
          ) : (
            <Header session={session} onMenuClick={() => setNavOpen(true)} />
          )}
          {/* Layout §1: main fills remaining height; pages scroll inside or use h-full */}
          <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div
              key={pack.id}
              className="chat-scroll-xs h-full min-h-0 overflow-y-auto"
            >
              {children}
            </div>
          </main>
        </div>
      </SidebarLayoutProvider>
    </div>
  );
}

function formatPageTitle(
  mod: ReturnType<typeof getModuleByPath>,
  parent: ReturnType<typeof getParentModule>,
) {
  // First-class modules use the module label only.
  if (mod?.id === "calendar" || mod?.id === "drafts") {
    return mod.label;
  }
  if (parent && mod) return `${parent.label} · ${mod.label}`;
  return mod?.label ?? "Campaign";
}

/**
 * CRM iframe: hide sidebar + full Campaign chrome, but keep ← Back + page title
 * on Create subpages (Recommendations, drafts, templates, …).
 */
function EmbedSubpageChrome() {
  const location = useLocation();
  const { pathname, search, state } = location;
  const navState = (state || {}) as {
    listHref?: string;
    navLabel?: string;
    campaignName?: string;
    contactName?: string;
  };
  const from = new URLSearchParams(search).get("from");
  const navLabels: NavLabels = {
    entity: navState.navLabel,
    campaign: navState.campaignName,
    contact: navState.contactName,
  };
  const crumbs = getNavCrumbs({
    pathname,
    search,
    from,
    entryHref: navState.listHref,
    labels: navLabels,
  });
  const parentHref = getParentHref({
    pathname,
    search,
    from,
    entryHref: navState.listHref,
    labels: navLabels,
  });

  // Module roots (Create hub, Monitor list, …): CRM already shows Marketing / …
  if (crumbs.length < 2 || !parentHref) return null;

  return (
    <header className="flex shrink-0 items-center gap-3 border-b border-neutral-200/80 bg-[#f3f4f6] px-4 py-3 sm:px-6">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <AppBreadcrumb crumbs={crumbs} parentHref={parentHref} />
      </div>
    </header>
  );
}

function Header({
  session,
  onMenuClick,
}: {
  session: CampaignUser;
  onMenuClick?: () => void;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const { pathname, search, state } = location;
  const mod = getModuleByPath(pathname, search);
  const parent = getParentModule(pathname, search);
  const pageTitle = formatPageTitle(mod, parent);
  const navState = (state || {}) as {
    listHref?: string;
    navLabel?: string;
    campaignName?: string;
    contactName?: string;
  };
  const from = new URLSearchParams(search).get("from");
  const navLabels: NavLabels = {
    entity: navState.navLabel,
    campaign: navState.campaignName,
    contact: navState.contactName,
  };
  const crumbs = getNavCrumbs({
    pathname,
    search,
    from,
    entryHref: navState.listHref,
    labels: navLabels,
  });
  const parentHref = getParentHref({
    pathname,
    search,
    from,
    entryHref: navState.listHref,
    labels: navLabels,
  });
  const showCrumbs = crumbs.length > 1;
  const orgLabel = session.orgName?.trim() || "Worktual";
  const roleLabel = session.role?.trim() || "Admin";
  const [notifOpen, setNotifOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);

  const notifications = useSyncExternalStore(
    subscribeNotifications,
    listNotifications,
    getNotificationsServerSnapshot,
  );
  const unread = useSyncExternalStore(
    subscribeNotifications,
    unreadNotificationCount,
    () => 0,
  );

  useEffect(() => {
    let cancelled = false;
    const syncAll = async () => {
      try {
        syncNotificationsFromRecommendations();
      } catch {
        /* never block shell on notification sync */
      }
      try {
        if (!cancelled) await syncNotificationsFromServer();
      } catch {
        /* backend / DB may be briefly unavailable — cache remains */
      }
    };
    void syncAll();
    // Server list only — no campaign-list polling. Worker emits events.
    const timer = window.setInterval(() => void syncAll(), 90_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!notifOpen) return;
    try {
      syncNotificationsFromRecommendations();
    } catch {
      /* ignore */
    }
    void syncNotificationsFromServer().catch(() => {
      /* ignore */
    });
    const onDoc = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [notifOpen]);

  const openNotification = (n: AppNotification, e?: ReactMouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    if (!n.readAt) markNotificationRead(n.id);

    // Simple / info messages: mark read only — never close the dropdown.
    if (!notificationCanRoute(n)) return;

    setNotifOpen(false);
    navigate((n.href || "").trim());
  };

  return (
    <header className="flex shrink-0 items-center gap-3 border-b border-neutral-200/80 bg-[#f3f4f6] px-4 py-3 sm:px-6 lg:px-8">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {onMenuClick ? (
          <button
            type="button"
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl text-neutral-600 hover:bg-neutral-200/60 md:hidden"
            onClick={onMenuClick}
            aria-label="Open menu"
          >
            <Menu className="size-5" strokeWidth={1.75} />
          </button>
        ) : null}

        {showCrumbs ? (
          <AppBreadcrumb crumbs={crumbs} parentHref={parentHref} />
        ) : (
          <h1 className="min-w-0 truncate text-xl font-semibold tracking-tight text-neutral-900 sm:text-2xl">
            {pageTitle}
          </h1>
        )}
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-3">
        <div className="relative" ref={notifRef}>
          <button
            type="button"
            onClick={() => setNotifOpen((v) => !v)}
            className="relative inline-flex size-9 items-center justify-center rounded-md border border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50"
            aria-label={
              unread > 0
                ? `Notifications, ${unread} unread`
                : "Notifications"
            }
            aria-expanded={notifOpen}
          >
            <Bell className="size-4" strokeWidth={1.75} />
            {unread > 0 ? (
              <span className="absolute -top-1 -right-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-neutral-900 px-1 text-[9px] font-semibold leading-none text-white ring-2 ring-[#f3f4f6]">
                {unread > 9 ? "9+" : unread}
              </span>
            ) : null}
          </button>
          {notifOpen ? (
            <div
              className="absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-xl border border-border-default bg-surface shadow-lg"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-border-default px-3 py-2.5">
                <p className="text-sm font-medium text-text-primary">
                  Notifications
                </p>
                {unread > 0 ? (
                  <button
                    type="button"
                    className="text-xs font-medium text-text-link hover:underline"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      markAllNotificationsRead();
                    }}
                  >
                    Mark all read
                  </button>
                ) : null}
              </div>
              {notifications.length === 0 ? (
                <p className="px-3 py-6 text-center text-sm text-text-caption">
                  No notifications yet
                </p>
              ) : (
                <ul className="scroll-overlay max-h-80 overflow-y-auto">
                  {notifications.map((n) => {
                    const canRoute = notificationCanRoute(n);
                    return (
                      <li
                        key={n.id}
                        className="border-b border-border-default last:border-b-0"
                      >
                        <button
                          type="button"
                          onClick={(e) => openNotification(n, e)}
                          onMouseDown={(e) => e.stopPropagation()}
                          className={`flex w-full flex-col gap-0.5 px-3 py-2.5 text-left transition-colors hover:bg-subtle ${
                            n.readAt ? "opacity-80" : "bg-brand/5"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-sm font-medium text-text-primary">
                              {n.title}
                            </p>
                            {!n.readAt ? (
                              <span className="mt-1 size-1.5 shrink-0 rounded-full bg-brand" />
                            ) : null}
                          </div>
                          <p className="line-clamp-2 text-xs text-text-secondary">
                            {n.body}
                          </p>
                          <p className="text-[11px] text-text-caption">
                            {formatNotificationTime(n.createdAt)}
                            {canRoute ? " · Open" : " · Info"}
                          </p>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          ) : null}
        </div>

        <span className="inline-flex items-center rounded-full bg-neutral-200/80 px-3 py-1 text-xs font-medium text-neutral-700">
          {roleLabel} · {orgLabel}
        </span>
      </div>
    </header>
  );
}
