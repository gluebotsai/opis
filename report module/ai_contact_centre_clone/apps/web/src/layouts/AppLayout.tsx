import { LogoutOutlined } from "@ant-design/icons";
import { Popover, Tooltip } from "antd";
import { ChevronLeft, ChevronRight, Menu, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { NavLink, Navigate, Outlet, useLocation, useNavigate } from "react-router";

import { ModuleMark } from "@/components/brand/ModuleMark";
import { CopilotMark } from "@/components/brand/CopilotMark";
import { AdminNotificationsBell } from "@/components/admin/admin-notifications-bell";
import { IconButton } from "@/components/ui/button";
import { WorkspaceConsultSpeakingBanner } from "@/components/workspace/workspace-consult-speaking-banner";
import { WorkspaceGlobalOffer } from "@/components/workspace/workspace-global-offer";
import { WorkspaceMissedContacts } from "@/components/workspace/workspace-missed-contacts";
import { WorkspaceToolbar } from "@/components/workspace/workspace-toolbar";
import { MainFlushProvider, useMainFlush } from "@/contexts/main-flush";
import { SidebarLayoutProvider } from "@/contexts/sidebar-layout";
import { CopilotPageProvider } from "@/features/assistant/copilot-page-context";
import { useTeamChatPendingCount } from "@/features/internal-chat/use-team-chat-pending-count";
import { PageTitleProvider, usePageTitle } from "@/features/layout/page-title-context";
import { QueueDraftProvider } from "@/features/workforce/queues/queue-draft-context";
import type { AuthUser } from "@/types/auth";
import { getHomePath, getNavForRole, getPortalLabel } from "@/config/navigation";
import { useAuth } from "@/hooks/use-auth";
import { MEDIA_LG, MEDIA_XL } from "@/lib/panel-chrome";
import { cn } from "@/lib/utils";

const SIDEBAR_COLLAPSED_KEY = "cc2-sidebar-collapsed";
const COPILOT_MINIMIZED_KEY = "cc2-copilot-minimized";

function HeaderProfileMenu({ user }: { user: AuthUser }) {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const initial = user.name.charAt(0).toUpperCase();

  const content = (
    <div className="w-56 p-1">
      <div className="flex items-center gap-3 px-2 py-2">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#111111] text-sm font-semibold text-white">
          {initial}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-neutral-900">{user.name}</p>
          <p className="truncate text-xs text-neutral-600">{user.email}</p>
        </div>
      </div>
      <div className="mx-2 my-1 border-t-[0.6px] border-[#bfbfbf]" />
      <dl className="space-y-1.5 px-2 py-1.5 text-xs">
        <div className="flex items-start justify-between gap-3">
          <dt className="shrink-0 text-neutral-400">Role</dt>
          <dd className="truncate font-medium text-neutral-800">{user.roleLabel}</dd>
        </div>
        <div className="flex items-start justify-between gap-3">
          <dt className="shrink-0 text-neutral-400">Org</dt>
          <dd className="truncate font-medium text-neutral-800">{user.organizationName}</dd>
        </div>
      </dl>
      <div className="mx-2 my-1 border-t-[0.6px] border-[#bfbfbf]" />
      <button
        type="button"
        onClick={() => {
          setOpen(false);
          void logout().finally(() => {
            navigate("/login", { replace: true });
          });
        }}
        className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm text-neutral-700 transition hover:bg-neutral-100 hover:text-neutral-950"
      >
        <LogoutOutlined className="text-neutral-600" />
        Logout
      </button>
    </div>
  );

  return (
    <Popover
      trigger="click"
      placement="bottomRight"
      open={open}
      onOpenChange={setOpen}
      arrow={false}
      content={content}
    >
      <button
        type="button"
        className="inline-flex items-center rounded-full transition hover:opacity-90"
        aria-label="Account menu"
        aria-expanded={open}
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#111111] text-sm font-semibold tracking-wide text-white shadow-sm ring-2 ring-white">
          {initial}
        </span>
      </button>
    </Popover>
  );
}

function SidebarNavTooltip({
  label,
  collapsed,
  children,
}: {
  label: string;
  collapsed: boolean;
  children: React.ReactNode;
}) {
  if (!collapsed) return children;

  return (
    <Tooltip title={label} placement="right" color="#171717" mouseEnterDelay={0.35}>
      <span className="block w-full">{children}</span>
    </Tooltip>
  );
}

function RoleGuard({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const location = useLocation();
  if (!user) return null;

  if (user.role === "admin" && location.pathname.startsWith("/agent")) {
    return <Navigate to="/admin/dashboard" replace />;
  }
  if (user.role === "agent" && location.pathname.startsWith("/admin")) {
    return <Navigate to="/agent/workspace" replace />;
  }
  return children;
}

function SidebarContent({
  collapsed,
  onNavigate,
}: {
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const { user } = useAuth();
  const sections = useMemo(() => (user ? getNavForRole(user.role) : []), [user]);
  const pendingTeamChats = useTeamChatPendingCount(user?.id ?? null);

  if (!user) return null;

  return (
    <div className="flex h-full flex-col bg-[#111111] text-white">
      <div className={cn("pb-4 pt-5", collapsed ? "px-3" : "px-5")}>
        <div className={cn("flex", collapsed ? "justify-center" : "justify-start")}>
          <ModuleMark compact={collapsed} />
        </div>
        {!collapsed ? (
          <p className="mt-2 text-[12px] uppercase tracking-[0.14em] text-white/45">
            {getPortalLabel(user.role)}
          </p>
        ) : null}
      </div>

      <nav
        className={cn(
          "sidebar-nav flex-1 space-y-1 overflow-y-auto py-2",
          collapsed ? "px-2" : "px-3",
        )}
      >
        {sections.map((section, index) => (
          <div key={section.label ?? index} className="space-y-1">
            {section.label && !collapsed ? (
              <p className="px-3 pb-1 pt-3 text-[10px] uppercase tracking-[0.14em] text-white/40">
                {section.label}
              </p>
            ) : null}
            {section.items.map((item) => (
              <SidebarNavTooltip key={item.path} label={item.label} collapsed={collapsed}>
                <NavLink
                  to={item.path}
                  onClick={() => onNavigate?.()}
                  end={item.path === "/admin/dashboard" || item.path === "/agent/workspace"}
                  className={({ isActive }) =>
                    cn(
                      "flex items-center rounded-xl text-sm no-underline transition",
                      collapsed ? "justify-center px-2 py-2.5" : "gap-3 px-3 py-2.5",
                      "text-white/70 hover:bg-white/5 hover:text-white",
                      isActive && "nav-item-active text-white",
                    )
                  }
                >
                  <span className="relative text-base text-inherit opacity-90 [&_.anticon]:text-inherit">
                    {item.icon}
                    {item.path.endsWith("/team-chat") && pendingTeamChats > 0 ? (
                      <span
                        className="absolute -top-1.5 -right-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold leading-none text-white"
                        aria-label={`${pendingTeamChats} pending chats`}
                      >
                        {pendingTeamChats > 9 ? "9+" : pendingTeamChats}
                      </span>
                    ) : null}
                  </span>
                  {!collapsed ? <span className="truncate text-inherit">{item.label}</span> : null}
                </NavLink>
              </SidebarNavTooltip>
            ))}
          </div>
        ))}
      </nav>
    </div>
  );
}

function isDesktopXl() {
  return typeof window !== "undefined" && window.matchMedia(MEDIA_XL).matches;
}

function HeaderCopilotButton() {
  const { copilotAvailable, copilotMinimized, setCopilotMinimized } = useMainFlush();
  if (!copilotAvailable) return null;

  return (
    <IconButton
      variant="ghostIcon"
      className="xl:hidden"
      onClick={() => setCopilotMinimized(!copilotMinimized)}
      aria-label={copilotMinimized ? "Open co-worker" : "Close co-worker"}
      title={copilotMinimized ? "Open co-worker" : "Close co-worker"}
    >
      <CopilotMark />
    </IconButton>
  );
}

function AppMainColumn({
  user,
  sidebarCollapsed,
  navOpen,
  onNavOpenChange,
}: {
  user: AuthUser;
  sidebarCollapsed: boolean;
  navOpen: boolean;
  onNavOpenChange: (open: boolean) => void;
}) {
  const pageTitle = usePageTitle();
  const { pathname } = useLocation();
  const workspaceHeader = pathname.endsWith("/workspace");
  const [mainFlush, setMainFlush] = useState(false);
  const [copilotAvailable, setCopilotAvailable] = useState(false);
  const [copilotMinimized, setCopilotMinimized] = useState(() => {
    if (typeof window === "undefined") return false;
    if (!isDesktopXl()) return true;
    return window.localStorage.getItem(COPILOT_MINIMIZED_KEY) === "1";
  });

  useEffect(() => {
    if (!isDesktopXl()) return;
    window.localStorage.setItem(COPILOT_MINIMIZED_KEY, copilotMinimized ? "1" : "0");
  }, [copilotMinimized]);

  useEffect(() => {
    const media = window.matchMedia(MEDIA_XL);
    function onChange() {
      if (media.matches) {
        setCopilotMinimized(window.localStorage.getItem(COPILOT_MINIMIZED_KEY) === "1");
        return;
      }
      setCopilotMinimized(true);
    }
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  return (
    <MainFlushProvider
      flush={mainFlush}
      setFlush={setMainFlush}
      copilotMinimized={copilotMinimized}
      setCopilotMinimized={setCopilotMinimized}
      copilotAvailable={copilotAvailable}
      setCopilotAvailable={setCopilotAvailable}
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <header
          className={cn(
            "relative z-40 flex shrink-0 items-center gap-2 border-b-[0.6px] border-[#bfbfbf]/80 bg-white px-2 py-3 sm:px-3 lg:px-4",
            (workspaceHeader || !copilotMinimized) && "xl:bg-[#f3f4f6]",
          )}
        >
          <IconButton
            variant="ghostIcon"
            className="lg:hidden"
            onClick={() => onNavOpenChange(!navOpen)}
            aria-label={navOpen ? "Close menu" : "Open menu"}
            aria-expanded={navOpen}
          >
            {navOpen ? <X className="size-[18px]" /> : <Menu className="size-[18px]" />}
          </IconButton>
          <h1 className="min-w-0 truncate text-xl font-semibold tracking-tight text-neutral-900 sm:text-2xl">
            {pageTitle}
          </h1>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <HeaderCopilotButton />
            <WorkspaceGlobalOffer user={user} />
            <WorkspaceConsultSpeakingBanner />
            {user.role === "admin" ? <AdminNotificationsBell /> : null}
            {user.role === "agent" ? <WorkspaceMissedContacts /> : null}
            <WorkspaceToolbar showNudges={user.role === "agent"} />
            <HeaderProfileMenu user={user} />
          </div>
        </header>

        <SidebarLayoutProvider collapsed={sidebarCollapsed}>
          <main
            className={cn(
              "relative flex min-h-0 flex-1 flex-col overflow-hidden bg-white p-0 xl:bg-transparent",
              !mainFlush && "xl:p-4",
              mainFlush && "[&_.content-panel-header]:!border-b-0",
            )}
          >
            <QueueDraftProvider>
              <CopilotPageProvider>
                <div className="flex h-0 min-h-0 flex-1 flex-col overflow-hidden">
                  <RoleGuard>
                    <Outlet />
                  </RoleGuard>
                </div>
              </CopilotPageProvider>
            </QueueDraftProvider>
          </main>
        </SidebarLayoutProvider>
      </div>
    </MainFlushProvider>
  );
}

export default function AppLayout() {
  const { user, isAuthenticated } = useAuth();
  const location = useLocation();
  const [navOpen, setNavOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
  });

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, sidebarCollapsed ? "1" : "0");
  }, [sidebarCollapsed]);

  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const media = window.matchMedia(MEDIA_LG);
    function onChange() {
      if (media.matches) setNavOpen(false);
    }
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (!navOpen) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setNavOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navOpen]);

  if (!isAuthenticated || !user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return (
    <div className="flex h-svh overflow-hidden bg-[#f3f4f6]">
      <aside
        className={cn(
          "relative z-[45] hidden shrink-0 transition-[width] duration-200 lg:block",
          sidebarCollapsed ? "w-[72px]" : "w-[260px]",
        )}
      >
        <SidebarContent collapsed={sidebarCollapsed} />

        <button
          type="button"
          onClick={() => setSidebarCollapsed((current) => !current)}
          className="absolute -right-3 top-7 z-10 flex size-6 items-center justify-center rounded-full border-[0.6px] border-[#bfbfbf] bg-white text-neutral-600 shadow-sm transition hover:bg-neutral-50 hover:text-neutral-800"
          aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {sidebarCollapsed ? <ChevronRight className="size-3.5" /> : <ChevronLeft className="size-3.5" />}
        </button>
      </aside>

      {navOpen ? (
        <button
          type="button"
          className="fixed inset-0 z-[70] bg-black/40 lg:hidden"
          aria-label="Close menu"
          onClick={() => setNavOpen(false)}
        />
      ) : null}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-[71] w-[min(260px,85vw)] transition-transform duration-200 lg:hidden",
          navOpen ? "translate-x-0" : "-translate-x-full",
        )}
        aria-hidden={!navOpen}
        inert={navOpen ? undefined : true}
      >
        <SidebarContent collapsed={false} onNavigate={() => setNavOpen(false)} />
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <PageTitleProvider>
          <AppMainColumn
            user={user}
            sidebarCollapsed={sidebarCollapsed}
            navOpen={navOpen}
            onNavOpenChange={setNavOpen}
          />
        </PageTitleProvider>
      </div>
    </div>
  );
}

export function RoleHomeRedirect() {
  const { user, isAuthenticated } = useAuth();
  if (!isAuthenticated || !user) {
    return <Navigate to="/login" replace />;
  }
  return <Navigate to={getHomePath(user.role)} replace />;
}
