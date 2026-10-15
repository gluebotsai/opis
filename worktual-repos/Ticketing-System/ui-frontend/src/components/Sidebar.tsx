import React from 'react';
import {
  PlusCircle,
  Home,
  UserCheck,
  Layers,
  BookOpen,
  Users,
  Inbox,
  Settings,
  ChevronLeft,
  ChevronRight,
  X,
  UsersRound,
  UserX,
  LayoutGrid,
  ScrollText,
  Smile,
  MessageSquareText,
  SlidersHorizontal,
  Flag,
  ShieldCheck,
} from 'lucide-react';
import ModuleMark from './layout/ModuleMark';
import {
  canAccessModule,
  canCreateTicket,
  type AppRole,
} from '../rbac';

interface SidebarProps {
  currentView: string;
  onNavigate: (view: string) => void;
  ticketCount: number;
  openTicketCount: number;
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
  ticketCount,
  openTicketCount,
  role,
  open = false,
  onClose,
  collapsed = false,
  onToggleCollapse,
  portalLabel = 'TICKETING PORTAL',
}: SidebarProps) {
  const showCreate = canCreateTicket(role);
  const show = (mod: string) => canAccessModule(role, mod);

  const navigate = (id: string) => {
    onNavigate(id);
    onClose?.();
  };

  const navItem = (id: string, label: string, icon: React.ReactNode, badge?: number) => {
    if (!show(id)) return null;
    const isActive =
      currentView === id ||
      (id === 'agent-queues' && currentView === 'escalation-directory');
    return (
      <button
        id={`sidebar-link-${id}`}
        type="button"
        title={label}
        onClick={() => navigate(id)}
        className={`relative mx-auto flex items-center transition-all cursor-pointer ${
          collapsed
            ? `h-10 w-10 justify-center rounded-xl ${
                isActive ? 'bg-white text-black' : 'text-white/55 hover:bg-white/10 hover:text-white'
              }`
            : `w-[calc(100%-1rem)] justify-between px-3 py-2.5 text-sm rounded-xl ${
                isActive
                  ? 'bg-white/10 text-white font-medium'
                  : 'text-white/55 hover:text-white hover:bg-white/5'
              }`
        }`}
      >
        {!collapsed && isActive && (
          <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-0.5 rounded-full bg-white" />
        )}
        <div className={`flex items-center min-w-0 ${collapsed ? '' : 'gap-3'}`}>
          <span className="shrink-0">{icon}</span>
          {!collapsed && <span className="truncate">{label}</span>}
        </div>
        {!collapsed && badge !== undefined && (
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

  const sectionLabel = (text: string) =>
    collapsed ? null : (
      <div className="px-5 py-1.5 text-[10px] tracking-[0.14em] uppercase text-white/40">{text}</div>
    );

  const showYourTickets =
    show('assigned') ||
    show('agent-queues') ||
    show('team-inbox') ||
    show('unassigned') ||
    show('work-board');
  /** Analytics is opened from Reports (Dashboard) via View Analytics — not sidebar. */
  const showShortcuts =
    show('team-queue') ||
    show('kb') ||
    show('customers') ||
    show('audit') ||
    show('csat-reports') ||
    show('macros') ||
    show('priorities') ||
    show('org-preferences') ||
    show('approvals');

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

        <div className="flex-1 overflow-y-auto py-2 flex flex-col gap-4">
          {showCreate && (
            <div className={isCollapsed ? 'flex justify-center' : 'px-3'}>
              <button
                id="sidebar-create-ticket-btn"
                type="button"
                title="Create Ticket"
                onClick={() => navigate('create-ticket')}
                className={`flex items-center justify-center gap-2 bg-[#7423D7] hover:bg-[#6420c0] text-white font-semibold transition-all cursor-pointer shadow-sm ${
                  isCollapsed
                    ? 'h-10 w-10 rounded-xl'
                    : 'w-full h-10 px-4 rounded-xl text-xs tracking-wide'
                }`}
              >
                <PlusCircle className="h-4 w-4 stroke-[2.5]" />
                {!isCollapsed && <span>Create Ticket</span>}
              </button>
            </div>
          )}

          {show('dashboard') && (
            <div className="space-y-1">
              {navItem('dashboard', 'Dashboard', <Home className="h-4 w-4" />)}
            </div>
          )}

          {showYourTickets && (
            <div className="space-y-1">
              {sectionLabel('Your Tickets')}
              {navItem('assigned', 'Tickets', <UserCheck className="h-4 w-4" />, ticketCount)}
              {navItem('team-inbox', 'Team inbox', <UsersRound className="h-4 w-4" />)}
              {navItem('unassigned', 'Unassigned', <UserX className="h-4 w-4" />)}
              {navItem('work-board', 'Work board', <LayoutGrid className="h-4 w-4" />)}
              {navItem('agent-queues', 'Teams', <Inbox className="h-4 w-4" />)}
            </div>
          )}

          {showShortcuts && (
            <div className="space-y-1">
              {sectionLabel('Shortcuts')}
              {navItem('team-queue', 'All tickets', <Layers className="h-4 w-4" />, openTicketCount)}
              {navItem('kb', 'Knowledge Base', <BookOpen className="h-4 w-4" />)}
              {navItem('customers', 'Customers', <Users className="h-4 w-4" />)}
              {navItem('csat-reports', 'CSAT reports', <Smile className="h-4 w-4" />)}
              {navItem('audit', 'Audit log', <ScrollText className="h-4 w-4" />)}
              {navItem('macros', 'Macros', <MessageSquareText className="h-4 w-4" />)}
              {navItem('priorities', 'Priorities', <Flag className="h-4 w-4" />)}
              {navItem(
                'org-preferences',
                'Org preferences',
                <SlidersHorizontal className="h-4 w-4" />
              )}
              {navItem('approvals', 'Approvals', <ShieldCheck className="h-4 w-4" />)}
            </div>
          )}
        </div>

        <div className={`shrink-0 border-t border-white/10 space-y-1 ${isCollapsed ? 'p-2' : 'p-3'}`}>
          {show('settings') && (
            <button
              type="button"
              title="Account Settings"
              onClick={() => navigate('settings')}
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
            className="absolute top-5 -right-3 z-20 h-6 w-6 rounded-full border border-neutral-200 bg-white text-neutral-600 shadow-sm flex items-center justify-center hover:bg-neutral-50"
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
