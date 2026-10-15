import React from 'react';
import {
  PlusCircle,
  Home,
  UserCheck,
  BookOpen,
  Users,
  Inbox,
  Settings,
  ChevronLeft,
  ChevronRight,
  X,
  LayoutGrid,
  ScrollText,
  SlidersHorizontal,
  Flag,
  ShieldCheck,
  MessagesSquare,
} from 'lucide-react';
import ModuleMark from './layout/ModuleMark';
import {
  canAccessModule,
  canCreateTicket,
  isTicketTabView,
  type AppRole,
} from '../rbac';
import type { NavigateOpts } from '../navigation';

interface SidebarProps {
  currentView: string;
  onNavigate: (view: string, opts?: NavigateOpts) => void;
  openTicketCount: number;
  internalChatUnread?: number;
  role: AppRole;
  open?: boolean;
  onClose?: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  portalLabel?: string;
}

export default function Sidebar({
  currentView,
  onNavigate,
  openTicketCount: _openTicketCount,
  internalChatUnread = 0,
  role,
  open = false,
  onClose,
  collapsed = false,
  onToggleCollapse,
  portalLabel = 'TICKETING PORTAL',
}: SidebarProps) {
  const showCreate = canCreateTicket(role);
  const show = (mod: string) => canAccessModule(role, mod);

  const navigate = (id: string, opts?: NavigateOpts) => {
    onNavigate(id, opts);
    onClose?.();
  };

  type NavItemOpts = { active?: boolean; onSelect?: (isActive: boolean) => void };

  const navItem = (
    id: string,
    label: string,
    icon: React.ReactNode,
    badgeOrOpts?: number | NavItemOpts,
    opts?: NavItemOpts
  ) => {
    const badge = typeof badgeOrOpts === 'number' ? badgeOrOpts : undefined;
    const itemOpts = typeof badgeOrOpts === 'object' ? badgeOrOpts : opts;
    if (!show(id)) return null;
    const isActive =
      itemOpts?.active ??
      (currentView === id ||
        (id === 'agent-queues' && currentView === 'escalation-directory'));
    return (
      <button
        id={`sidebar-link-${id}`}
        type="button"
        title={label}
        onClick={() => {
          if (itemOpts?.onSelect) {
            itemOpts.onSelect(isActive);
            onClose?.();
            return;
          }
          navigate(id, isActive ? { reset: true } : undefined);
        }}
        className={`relative mx-auto flex items-center transition-all cursor-pointer ${
          collapsed
            ? `h-10 w-10 justify-center rounded-xl ${
                isActive ? 'bg-white text-black' : 'text-white/55 hover:bg-white/10 hover:text-white'
              }`
            : `w-[calc(100%-1rem)] justify-between px-3 py-2.5 text-sm rounded-xl ${
                isActive
                  ? 'bg-white/10 text-white font-medium'
                  : 'text-white/70 hover:text-white hover:bg-white/5'
              }`
        }`}
      >
        {!collapsed && isActive && (
          <span className="absolute left-0 top-1/2 h-[60%] w-[3px] -translate-y-1/2 rounded-full bg-white" />
        )}
        <div className={`flex items-center min-w-0 ${collapsed ? '' : 'gap-3'}`}>
          <span className="shrink-0">{icon}</span>
          {!collapsed && <span className="truncate">{label}</span>}
        </div>
        {collapsed && badge !== undefined && badge > 0 && (
          <span className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-rose-500" />
        )}
        {!collapsed && badge !== undefined && badge > 0 && (
          <span
            className={`text-[10px] px-2 py-0.5 rounded-full font-semibold tabular-nums ${
              isActive ? 'bg-white text-black' : 'bg-white/10 text-white/60'
            }`}
          >
            {badge}
          </span>
        )}
      </button>
    );
  };

  const sidebarBody = (isMobile = false) => {
    const isCollapsed = !isMobile && collapsed;
    return (
      <>
        <div className={`shrink-0 ${isCollapsed ? 'px-2 pt-3 pb-2' : 'px-3 pt-4 pb-3'}`}>
          <div className="flex items-center justify-between gap-1">
            <ModuleMark
              collapsed={isCollapsed}
              portalLabel={portalLabel}
              onClick={() =>
                navigate(show('dashboard') ? 'dashboard' : show('assigned') ? 'assigned' : 'settings')
              }
            />
            {isMobile && (
              <button
                type="button"
                onClick={onClose}
                className="p-1.5 text-white/50 hover:text-white rounded-lg"
                aria-label="Close menu"
              >
                <X className="h-5 w-5" />
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto py-2 flex flex-col">
          {showCreate && (
            <div className={isCollapsed ? 'mb-1 flex justify-center' : 'mb-1 px-3'}>
              <button
                id="sidebar-create-ticket-btn"
                type="button"
                title="Create Ticket"
                onClick={() =>
                  navigate(
                    'create-ticket',
                    currentView === 'create-ticket' ? { reset: true } : undefined
                  )
                }
                className={`flex items-center justify-center gap-2 bg-black text-white font-semibold shadow-none transition-colors hover:bg-neutral-800 ${
                  isCollapsed
                    ? 'size-[38px] rounded-lg'
                    : 'h-[38px] w-full rounded-lg px-4 text-sm'
                }`}
              >
                <PlusCircle className="size-[18px] stroke-[2.25]" />
                {!isCollapsed && <span>Create Ticket</span>}
              </button>
            </div>
          )}

          <div className="flex flex-col gap-1">
            {navItem('dashboard', 'Dashboard', <Home className="h-4 w-4" />)}
            {show('assigned')
              ? navItem(
                  'assigned',
                  'Tickets',
                  <UserCheck className="h-4 w-4" />,
                  {
                    active: isTicketTabView(currentView),
                    onSelect: (isActive) => {
                      const target = isTicketTabView(currentView)
                        ? currentView
                        : 'assigned';
                      navigate(
                        target,
                        isActive ? { reset: true, keepFilters: true } : undefined
                      );
                    },
                  }
                )
              : null}
            {navItem('work-board', 'Work board', <LayoutGrid className="h-4 w-4" />)}
            {navItem('agent-queues', 'Teams', <Inbox className="h-4 w-4" />)}
            {navItem(
              'internal-chat',
              'Internal Chat',
              <MessagesSquare className="h-4 w-4" />,
              internalChatUnread
            )}
            {navItem('kb', 'Knowledge Base', <BookOpen className="h-4 w-4" />)}
            {navItem('customers', 'Customers', <Users className="h-4 w-4" />)}
            {navItem('audit', 'Audit log', <ScrollText className="h-4 w-4" />)}
            {navItem('priorities', 'Priorities', <Flag className="h-4 w-4" />)}
            {navItem(
              'org-preferences',
              'Support Portal',
              <SlidersHorizontal className="h-4 w-4" />
            )}
            {navItem('approvals', 'Approvals', <ShieldCheck className="h-4 w-4" />)}
          </div>
        </div>

        <div className={`shrink-0 border-t border-white/10 space-y-1 ${isCollapsed ? 'p-2' : 'p-3'}`}>
          {show('settings') && (
            <button
              type="button"
              title="Account Settings"
              onClick={() =>
                navigate(
                  'settings',
                  currentView === 'settings' ? { reset: true } : undefined
                )
              }
              className={`relative flex items-center transition-all rounded-xl cursor-pointer ${
                isCollapsed
                  ? `h-10 w-10 mx-auto justify-center ${
                      currentView === 'settings'
                        ? 'bg-white text-black'
                        : 'text-white/55 hover:bg-white/10 hover:text-white'
                    }`
                  : `w-full gap-3 px-3 py-2.5 text-sm ${
                      currentView === 'settings'
                        ? 'bg-white/10 text-white'
                        : 'text-white/55 hover:text-white hover:bg-white/5'
                    }`
              }`}
            >
              {!isCollapsed && currentView === 'settings' && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-0.5 rounded-full bg-white" />
              )}
              <Settings className="h-4 w-4" />
              {!isCollapsed && <span>Account Settings</span>}
            </button>
          )}
        </div>
      </>
    );
  };

  return (
    <>
      {open && (
        <div className="fixed inset-0 bg-black/50 z-40 md:hidden" onClick={onClose} aria-hidden />
      )}

      <div className="relative hidden md:flex h-svh shrink-0">
        <aside
          id="worktual-sidebar"
          className={`bg-[#111111] text-white flex flex-col h-svh sticky top-0 select-none font-sans border-r border-black/80 transition-[width] duration-200 ${
            collapsed ? 'w-[72px]' : 'w-[260px]'
          }`}
        >
          {sidebarBody(false)}
        </aside>
        {onToggleCollapse && (
          <button
            type="button"
            onClick={onToggleCollapse}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="absolute top-5 -right-3 z-20 flex size-6 items-center justify-center rounded-full border-[0.6px] border-[#bfbfbf] bg-white text-neutral-600 shadow-none hover:bg-neutral-50"
          >
            {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronLeft className="h-3.5 w-3.5" />}
          </button>
        )}
      </div>

      <aside
        className={`fixed top-0 left-0 z-50 h-svh w-[min(16.25rem,85vw)] bg-[#111111] text-white flex flex-col font-sans border-r border-black transition-transform duration-200 md:hidden ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
        aria-hidden={!open}
      >
        {sidebarBody(true)}
      </aside>
    </>
  );
}
