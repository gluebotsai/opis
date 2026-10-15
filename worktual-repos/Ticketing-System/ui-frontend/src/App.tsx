import React, { useState, useEffect, useCallback } from 'react';
import Header from './components/Header';
import Sidebar from './components/Sidebar';
import DashboardView from './components/DashboardView';
import TicketsView from './components/TicketsView';
import AgentQueuesView from './components/AgentQueuesView';
import KnowledgeBaseView from './components/KnowledgeBaseView';
import CustomersView from './components/CustomersView';
import AnalyticsView from './components/AnalyticsView';
import CreateTicketView from './components/CreateTicketView';
import SettingsView from './components/SettingsView';
import LoginView from './components/LoginView';
import WorkBoardView from './components/WorkBoardView';
import AuditLogView from './components/AuditLogView';
import CsatReportsView from './components/CsatReportsView';
import MacrosView from './components/MacrosView';
import PrioritiesView from './components/PrioritiesView';
import OrgPreferencesView from './components/OrgPreferencesView';
import ApprovalsView from './components/ApprovalsView';
import SupportPortalApp from './components/support/SupportPortalApp';
import { PageTitleProvider } from './components/layout/PageTitleContext';
import {
  WorkspacePresentationProvider,
  useWorkspacePresentation,
} from './components/layout/WorkspacePresentationContext';
import CoworkerSplitWorkspace from './components/coworker/CoworkerSplitWorkspace';
import {
  applyCoworkerUiActions,
  normalizeCoworkerUiActions,
  isAddTeamMembersUiDraft,
} from './components/coworker/coworkerActions';
import { CoworkerSessionProvider, clearCoworkerSessionStorage } from './components/coworker/CoworkerSessionContext';
import { llmOnlyReply } from './components/coworker/llmGuidedReply';
import { Ticket, DashboardMetrics, Notification, AuthUser } from './types';
import { emptyMetrics } from './mockData';
import {
  canAccessModule,
  canCreateTicket,
  canMutateKnowledge,
  canMutateStaffData,
  dataScopeForRole,
  defaultModuleForRole,
  portalLabelForRole,
  ticketsListModuleForRole,
} from './rbac';
import {
  apiFetchInit,
  clearEmbedJwt,
  getEmbedJwt,
  installEmbedAuthListener,
  isEmbedMode,
} from './config/embedAuth';

const fetchOpts = (): RequestInit => apiFetchInit();

/** Offline / unused live path: specialist labels must not drive navigation. */
const AGENT_VIEW: Record<string, string> = {
  tickets: 'tickets-list', // resolved via ticketsListModuleForRole at navigate time
  teams: 'agent-queues',
  kb: 'kb',
  customers: 'customers',
};

const TICKET_VIEWS = [
  'assigned',
  'team-queue',
  'search',
  'team-inbox',
  'unassigned',
];

const VIEW_PAGE_LABEL: Record<string, string> = {
  dashboard: 'Dashboard',
  assigned: 'My Tickets',
  'team-queue': 'All tickets',
  'team-inbox': 'Team inbox',
  unassigned: 'Unassigned',
  'work-board': 'Work board',
  search: 'Search',
  kb: 'Knowledge Base',
  customers: 'Customers',
  analytics: 'Analytics',
  audit: 'Audit log',
  'csat-reports': 'CSAT reports',
  macros: 'Macros',
  priorities: 'Priorities',
  'escalation-directory': 'Escalation directory',
  'org-preferences': 'Org preferences',
  approvals: 'Approvals',
};

const VIEW_CHAT_MODULE: Record<string, { module: string; surface: string }> = {
  dashboard: { module: 'general', surface: 'list' },
  assigned: { module: 'tickets', surface: 'list' },
  'team-queue': { module: 'tickets', surface: 'list' },
  'team-inbox': { module: 'tickets', surface: 'list' },
  unassigned: { module: 'tickets', surface: 'list' },
  'work-board': { module: 'tickets', surface: 'list' },
  search: { module: 'tickets', surface: 'list' },
  kb: { module: 'kb', surface: 'list' },
  customers: { module: 'customers', surface: 'list' },
  analytics: { module: 'admin', surface: 'analytics' },
  audit: { module: 'admin', surface: 'audit' },
  'csat-reports': { module: 'admin', surface: 'csat' },
  macros: { module: 'macros', surface: 'list' },
  priorities: { module: 'admin', surface: 'priorities' },
  'escalation-directory': { module: 'admin', surface: 'directory' },
  'org-preferences': { module: 'admin', surface: 'prefs' },
  approvals: { module: 'admin', surface: 'list' },
  'agent-queues': { module: 'teams', surface: 'list' },
  'create-ticket': { module: 'tickets', surface: 'create' },
};

function listScopeForView(view: string): string | undefined {
  if (view === 'team-inbox') return 'team';
  if (view === 'unassigned') return 'unassigned';
  if (view === 'work-board') return 'assignee';
  if (view === 'search') return 'search';
  return undefined;
}

export default function App() {
  if (window.location.pathname.startsWith('/support')) {
    return <SupportPortalApp />;
  }
  return (
    <WorkspacePresentationProvider>
      <AppInner />
    </WorkspacePresentationProvider>
  );
}

function AppInner() {
  const { openSplit } = useWorkspacePresentation();
  const [authChecked, setAuthChecked] = useState(false);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [currentView, setCurrentView] = useState<string>('dashboard');
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [metrics, setMetrics] = useState<DashboardMetrics>(emptyMetrics);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [ticketPriorityFilter, setTicketPriorityFilter] = useState<string | undefined>(undefined);
  const [ticketStatusFilter, setTicketStatusFilter] = useState<string | undefined>(undefined);
  const [ticketChannelFilter, setTicketChannelFilter] = useState<string | undefined>(undefined);
  const [ticketCreatorFilter, setTicketCreatorFilter] = useState<string | undefined>(undefined);
  const [ticketAssigneeFilter, setTicketAssigneeFilter] = useState<string | undefined>(undefined);
  const [kbSearch, setKbSearch] = useState<string | undefined>(undefined);
  const [customerSearch, setCustomerSearch] = useState<string | undefined>(undefined);
  const [customerStatusFilter, setCustomerStatusFilter] = useState<string | undefined>(undefined);
  const [customerCreateIntent, setCustomerCreateIntent] = useState(false);
  const [customerCreateSeed, setCustomerCreateSeed] = useState<{
    step?: string;
    name?: string;
    email?: string;
    phone?: string;
  } | null>(null);
  const [customersListRefresh, setCustomersListRefresh] = useState(0);
  const [teamsSearch, setTeamsSearch] = useState<string | undefined>(undefined);
  const [macroSearch, setMacroSearch] = useState<string | undefined>(undefined);
  const [analyticsRange, setAnalyticsRange] = useState<string | undefined>(undefined);
  const [csatRange, setCsatRange] = useState<string | undefined>(undefined);
  const [auditSearch, setAuditSearch] = useState<string | undefined>(undefined);
  const [auditRange, setAuditRange] = useState<string | undefined>(undefined);
  const [directorySearch, setDirectorySearch] = useState<string | undefined>(undefined);
  const [teamsCreateIntent, setTeamsCreateIntent] = useState(false);
  const [teamsCreateSeed, setTeamsCreateSeed] = useState<{
    step?: string;
    name?: string;
    description?: string;
    members?: string[];
  } | null>(null);
  const [teamsListRefresh, setTeamsListRefresh] = useState(0);
  const [ticketCreateIntent, setTicketCreateIntent] = useState(false);
  /** Full create-ticket draft seed so RH panel survives navigate (e.g. after add-customer). */
  const [ticketCreateSeed, setTicketCreateSeed] = useState<{
    step?: string;
    customerId?: string;
    customerName?: string;
    customerEmail?: string;
    customerPhone?: string;
    issue?: string;
    subject?: string;
    description?: string;
    priority?: string;
    queue?: string;
    assignee?: string;
    assigneeId?: string;
    resolver?: string;
    resolverId?: string;
    rationale?: string;
    category?: string;
    skill?: string;
    enrichedByAi?: boolean;
    resolverConfidence?: number | null;
  } | null>(null);
  const [macroCreateIntent, setMacroCreateIntent] = useState(false);
  const [macroCreateSeed, setMacroCreateSeed] = useState<{
    step?: string;
    title?: string;
    body?: string;
  } | null>(null);
  /** Bumped after chat saves a macro so MacrosView reloads the list. */
  const [macroListRefresh, setMacroListRefresh] = useState(0);
  const [kbCreateIntent, setKbCreateIntent] = useState(false);
  const [kbCreateSeed, setKbCreateSeed] = useState<{
    step?: string;
    title?: string;
    category?: string;
    body?: string;
  } | null>(null);
  const [kbListRefresh, setKbListRefresh] = useState(0);
  const [priorityCreateIntent, setPriorityCreateIntent] = useState(false);
  const [priorityCreateStep, setPriorityCreateStep] = useState<string | null>(null);
  const [priorityCreateKind, setPriorityCreateKind] = useState<
    'priority' | 'status' | null
  >(null);
  const [priorityCreateSeed, setPriorityCreateSeed] = useState<{
    label?: string;
    hours?: string | number;
    step?: string;
    kind?: 'priority' | 'status';
  } | null>(null);
  const [prioritiesListRefresh, setPrioritiesListRefresh] = useState(0);
  const [analyticsListRefresh, setAnalyticsListRefresh] = useState(0);
  const [csatListRefresh, setCsatListRefresh] = useState(0);
  const [auditListRefresh, setAuditListRefresh] = useState(0);
  const [orgPrefsListRefresh, setOrgPrefsListRefresh] = useState(0);
  const [directoryListRefresh, setDirectoryListRefresh] = useState(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const [orgBranding, setOrgBranding] = useState<{
    portalLabel: string;
    displayTimezone: string;
  }>({ portalLabel: '', displayTimezone: 'UTC' });
  const [badgeAssignedOpen, setBadgeAssignedOpen] = useState(0);
  const [badgeTeamOpen, setBadgeTeamOpen] = useState(0);
  const ticketsFetchGen = React.useRef(0);

  useEffect(() => {
    openSplit();
  }, [currentView, openSplit]);

  const resolveView = (view: string) => {
    if (!currentUser) return view;
    // Alias used by older callers / chat actions — never a real AppModule.
    if (view === 'tickets-list') {
        return ticketsListModuleForRole(currentUser.role);
      }
    if (view === 'team-queue' && !canAccessModule(currentUser.role, 'team-queue')) {
      return ticketsListModuleForRole(currentUser.role);
    }
    return view;
  };

  type NavigateOpts = {
    /** Keep or set ticket search (notifications / deep links). */
    ticketSearch?: string;
    keepFilters?: boolean;
  };

  const navigateTo = (view: string, opts?: NavigateOpts) => {
    const target = resolveView(view);
    if (currentUser && !canAccessModule(currentUser.role, target)) {
      setCurrentView(defaultModuleForRole(currentUser.role));
      return;
    }
    openSplit();
    if (TICKET_VIEWS.includes(target)) {
      if (opts?.ticketSearch !== undefined) {
        setSearchQuery(opts.ticketSearch);
      } else if (!opts?.keepFilters) {
        setSearchQuery('');
        setTicketPriorityFilter('');
        setTicketStatusFilter('');
        setTicketChannelFilter('');
        setTicketCreatorFilter('');
        setTicketAssigneeFilter('');
      }
    }
    if (target === 'agent-queues' && !opts?.keepFilters) {
      setTeamsSearch(undefined);
    }
    setCurrentView(target);
  };

  /**
   * Legacy specialist-label navigation. Live chat must not call this —
   * pages move only via handleCoworkerChatActions (ui_actions).
   * Customer/client wording must never land on tickets-list → Team inbox.
   */
  const handleAgentRoute = useCallback(
    (agent: string, userText?: string) => {
      const lower = String(userText || '')
        .trim()
        .toLowerCase();
      const customerAsk =
        /\b(customers?|clients?|contacts?|directory)\b/.test(lower) &&
        !/\b(tickets?|cases?)\b/.test(lower);
      const resolvedAgent =
        customerAsk && (agent === 'tickets' || agent === 'general')
          ? 'customers'
          : agent;
      const mapped = AGENT_VIEW[resolvedAgent];
      if (!mapped) return;
      const target = resolveView(mapped);
      // Already inside the ticket views — don't yank the user to another list.
      if (
        (mapped === 'tickets-list' || mapped === 'team-queue') &&
        TICKET_VIEWS.includes(currentView)
      ) {
        return;
      }
      if (target === currentView) return;
      openSplit();
      setCurrentView(target);
    },
    [currentView, openSplit, currentUser]
  );

  /**
   * Apply structured actions from Python LangGraph /chat (filters, navigate, create).
   * Escalate DB writes are already applied by Express when actions are returned.
   */
  const handleCoworkerChatActions = useCallback(
    async (actions: Record<string, unknown>[]) => {
      if (!actions.length || !currentUser) return;

      let wantTicketCreate = false;
      let wantTeamsCreate = false;
      let wantMacroCreate = false;
      let wantKbCreate = false;
      let wantPriorityCreate = false;
      let wantCustomerCreate = false;
      let refreshTickets = false;
      let pendingTicketOpen: string | undefined;

      for (const raw of actions) {
        const type = String(raw.type || '')
          .trim()
          .toLowerCase();
        if (type === 'create_ticket') {
          const done = Boolean(raw.done || raw.refresh);
          if (canCreateTicket(currentUser.role) && !done) {
            wantTicketCreate = true;
            const step = String(raw.step || raw.awaiting || '')
              .trim()
              .toLowerCase();
            const customerName = String(
              raw.customerName || raw.customer_name || ''
            ).trim();
            const customerEmail = String(
              raw.customerEmail || raw.customer_email || ''
            ).trim();
            const customerPhone = String(
              raw.customerPhone || raw.customer_phone || ''
            ).trim();
            const customerId = String(
              raw.customerId || raw.customer_id || ''
            ).trim();
            const issue = String(raw.issue || '').trim();
            const subject = String(raw.subject || '').trim();
            const description = String(raw.description || '').trim();
            const priority = String(raw.priority || '').trim();
            const queue = String(raw.queue || '').trim();
            const assignee = String(raw.assignee || '').trim();
            const assigneeId = String(
              raw.assigneeId || raw.assignee_id || ''
            ).trim();
            const resolver = String(raw.resolver || '').trim();
            const resolverId = String(
              raw.resolverId || raw.resolver_id || ''
            ).trim();
            const rationale = String(raw.rationale || '').trim();
            const category = String(raw.category || '').trim();
            const skill = String(raw.skill || '').trim();
            const confRaw =
              raw.resolverConfidence ?? raw.resolver_confidence ?? raw.confidence;
            const confNum =
              confRaw != null && confRaw !== ''
                ? Number(confRaw)
                : null;
            const hasFields = Boolean(
              customerName ||
                customerEmail ||
                customerPhone ||
                customerId ||
                issue ||
                subject ||
                description ||
                priority ||
                queue ||
                assignee ||
                resolver
            );
            const isFreshStart =
              !hasFields &&
              (!step || step === 'name' || step === 'customername');
            if (isFreshStart) {
              setTicketCreateSeed({ step: step || 'name' });
            } else {
              setTicketCreateSeed((prev) => ({
                step: hasFields ? step || prev?.step : prev?.step || step,
                customerId: customerId || prev?.customerId,
                customerName: customerName || prev?.customerName,
                customerEmail: customerEmail || prev?.customerEmail,
                customerPhone: customerPhone || prev?.customerPhone,
                issue: issue || prev?.issue,
                subject: subject || prev?.subject,
                description: description || prev?.description,
                priority: priority || prev?.priority,
                queue: queue || prev?.queue,
                assignee: assignee || prev?.assignee,
                assigneeId: assigneeId || prev?.assigneeId,
                resolver: resolver || prev?.resolver,
                resolverId: resolverId || prev?.resolverId,
                rationale: rationale || prev?.rationale,
                category: category || prev?.category,
                skill: skill || prev?.skill,
                enrichedByAi:
                  raw.enrichedByAi === true
                    ? true
                    : prev?.enrichedByAi,
                resolverConfidence:
                  confNum != null && !Number.isNaN(confNum)
                    ? confNum
                    : prev?.resolverConfidence,
              }));
            }
          }
          if (done) {
            refreshTickets = true;
            setTicketCreateSeed(null);
          }
        } else if (type === 'create_team') {
          const done = Boolean(raw.done);
          const save = Boolean(raw.save || raw.confirm);
          // Add-members drafts must not arm the create-team progress seed.
          if (
            canAccessModule(currentUser.role, 'agent-queues') &&
            !done &&
            !save &&
            !isAddTeamMembersUiDraft(raw)
          ) {
            wantTeamsCreate = true;
            const step = String(raw.step || raw.awaiting || '')
              .trim()
              .toLowerCase();
            const members = Array.isArray(raw.members)
              ? raw.members.map((m) => String(m || '').trim()).filter(Boolean)
              : [];
            const name = String(raw.name || raw.queueName || '').trim();
            const description = String(raw.description || '').trim();
            const hasFields = Boolean(name || description || members.length);
            const isFreshStart =
              !hasFields && (!step || step === 'name' || step === 'create_name');
            if (isFreshStart) {
              setTeamsCreateSeed({ step: step || 'name' });
            } else {
              setTeamsCreateSeed((prev) => ({
                step: hasFields ? step || prev?.step : prev?.step || step,
                name: name || prev?.name,
                description: description || prev?.description,
                members: members.length ? members : prev?.members,
              }));
            }
          }
          if (
            (done || Boolean(raw.refresh)) &&
            canAccessModule(currentUser.role, 'agent-queues')
          ) {
            setTeamsCreateSeed(null);
            setTeamsListRefresh((n) => n + 1);
          }
        } else if (type === 'delete_team') {
          const done = Boolean(raw.done || raw.refresh);
          if (done && canAccessModule(currentUser.role, 'agent-queues')) {
            setTeamsListRefresh((n) => n + 1);
          }
        } else if (type === 'update_team') {
          const done = Boolean(raw.done || raw.refresh);
          if (done && canAccessModule(currentUser.role, 'agent-queues')) {
            setTeamsListRefresh((n) => n + 1);
          }
        } else if (type === 'refresh_teams') {
          if (canAccessModule(currentUser.role, 'agent-queues')) {
            setTeamsListRefresh((n) => n + 1);
          }
        } else if (type === 'create_macro') {
          const done = Boolean(raw.done);
          if (canAccessModule(currentUser.role, 'macros') && !done) {
            wantMacroCreate = true;
            const step = String(raw.step || raw.awaiting || '')
              .trim()
              .toLowerCase();
            setMacroCreateSeed({
              step: step || 'title',
              title: String(raw.title || '').trim() || undefined,
              body: String(raw.body || '').trim() || undefined,
            });
          }
          // Tool already persisted — still force the Macros list to reload.
          if (
            (done || Boolean(raw.refresh)) &&
            canAccessModule(currentUser.role, 'macros')
          ) {
            setMacroCreateSeed(null);
            setMacroListRefresh((n) => n + 1);
          }
        } else if (type === 'delete_macro') {
          const done = Boolean(raw.done || raw.refresh);
          if (done && canAccessModule(currentUser.role, 'macros')) {
            setMacroListRefresh((n) => n + 1);
          }
        } else if (type === 'create_kb') {
          const done = Boolean(raw.done || raw.save);
          if (canAccessModule(currentUser.role, 'kb') && !done) {
            wantKbCreate = true;
            const step = String(raw.step || raw.awaiting || '')
              .trim()
              .toLowerCase();
            setKbCreateSeed({
              step: step || 'title',
              title: String(raw.title || '').trim() || undefined,
              category: String(raw.category || '').trim() || undefined,
              body: String(raw.body || raw.content || '').trim() || undefined,
            });
          }
          if ((done || Boolean(raw.refresh)) && canAccessModule(currentUser.role, 'kb')) {
            setKbCreateSeed(null);
            setKbListRefresh((n) => n + 1);
          }
        } else if (type === 'refresh_kb') {
          if (canAccessModule(currentUser.role, 'kb')) {
            setKbListRefresh((n) => n + 1);
          }
        } else if (type === 'add_kb_category') {
          if (canAccessModule(currentUser.role, 'kb')) {
            setCurrentView('kb');
            setKbListRefresh((n) => n + 1);
          }
        } else if (type === 'import_kb') {
          if (canAccessModule(currentUser.role, 'kb')) {
            setCurrentView('kb');
          }
        } else if (type === 'export_kb') {
          if (canAccessModule(currentUser.role, 'kb')) {
            setCurrentView('kb');
          }
        } else if (type === 'refresh_customers') {
          if (canAccessModule(currentUser.role, 'customers')) {
            setCustomersListRefresh((n) => n + 1);
          }
        } else if (type === 'open_customer_import') {
          if (
            currentUser.role === 'admin' &&
            canAccessModule(currentUser.role, 'customers')
          ) {
            setCurrentView('customers');
          }
        } else if (type === 'update_priority' || type === 'update_status') {
          if (canAccessModule(currentUser.role, 'priorities')) {
            setPriorityCreateSeed(null);
            setPriorityCreateStep(null);
            setCurrentView('priorities');
            if (Boolean(raw.done || raw.refresh)) {
              setPrioritiesListRefresh((n) => n + 1);
            }
          }
        } else if (type === 'create_priority' || type === 'create_status') {
          const done = Boolean(raw.done || raw.refresh);
          const name = String(raw.displayName || raw.label || raw.name || '').trim();
          const hoursRaw = raw.resolutionHours ?? raw.hours ?? raw.resolution_hours;
          const step = String(raw.step || raw.awaiting || '')
            .trim()
            .toLowerCase();
          // Delete confirm must not seed the create-priority guided panel.
          if (step === 'delete_confirm' || (String(raw.id || '').trim() && !done)) {
            if (canAccessModule(currentUser.role, 'priorities')) {
              setCurrentView('priorities');
              setPriorityCreateSeed(null);
              setPriorityCreateStep(null);
            }
          } else if (canAccessModule(currentUser.role, 'priorities') && !done) {
            wantPriorityCreate = true;
            setPriorityCreateStep(step || 'name');
            setPriorityCreateKind(type === 'create_status' ? 'status' : 'priority');
            setPriorityCreateSeed({
              label: name || undefined,
              hours:
                hoursRaw != null && hoursRaw !== '' ? hoursRaw : undefined,
              step: step || 'name',
              kind: type === 'create_status' ? 'status' : 'priority',
            });
          } else if (done && canAccessModule(currentUser.role, 'priorities')) {
            setPriorityCreateSeed(null);
            setPrioritiesListRefresh((n) => n + 1);
          }
        } else if (type === 'open_priority' || type === 'open_status') {
          if (canAccessModule(currentUser.role, 'priorities')) {
            setCurrentView('priorities');
            setPrioritiesListRefresh((n) => n + 1);
          }
        } else if (
          type === 'delete_priority' ||
          type === 'delete_status'
        ) {
          const done = Boolean(raw.done || raw.refresh);
          if (canAccessModule(currentUser.role, 'priorities')) {
            setPriorityCreateSeed(null);
            setPriorityCreateStep(null);
            setCurrentView('priorities');
            if (done) {
              setPrioritiesListRefresh((n) => n + 1);
            }
          }
        } else if (type === 'create_customer') {
          const done = Boolean(raw.done || raw.refresh);
          const save = Boolean(raw.save || raw.confirm);
          const seed = String(raw.name || raw.customerName || '').trim();
          if (
            currentUser.role === 'admin' &&
            canAccessModule(currentUser.role, 'customers') &&
            !done &&
            !save
          ) {
            wantCustomerCreate = true;
            const step = String(raw.step || raw.awaiting || 'name')
              .trim()
              .toLowerCase();
            setCustomerCreateSeed({
              step: step === 'contact' ? 'email' : step || 'name',
              name: seed,
              email: String(raw.email || raw.customerEmail || '').trim(),
              phone: String(raw.phone || raw.customerPhone || '').trim(),
            });
          }
          if (done && canAccessModule(currentUser.role, 'customers')) {
            setCustomerCreateSeed(null);
            setCustomersListRefresh((n) => n + 1);
          }
        } else if (type === 'refresh_tickets') {
          refreshTickets = true;
        } else if (type === 'open_ticket') {
          const tid = String(raw.id || raw.ticketNumber || raw.ticket_number || '')
            .trim();
          if (tid) {
            refreshTickets = true;
            // Apply after catalog navigates — a later navigate:assigned without
            // ticketSearch would clear the query and skip the right-hand detail.
            pendingTicketOpen = tid.startsWith('#') || !/^\d+$/.test(tid)
              ? tid
              : `#${tid}`;
          }
        } else if (type === 'open_macro') {
          if (canAccessModule(currentUser.role, 'macros')) {
            setCurrentView('macros');
            setMacroListRefresh((n) => n + 1);
          }
        } else if (type === 'open_customer') {
          if (canAccessModule(currentUser.role, 'customers')) {
            setCurrentView('customers');
            setCustomersListRefresh((n) => n + 1);
          }
        } else if (type === 'open_team') {
          if (canAccessModule(currentUser.role, 'agent-queues')) {
            setCurrentView('agent-queues');
            setTeamsListRefresh((n) => n + 1);
          }
        } else if (type === 'refresh_macros') {
          if (canAccessModule(currentUser.role, 'macros')) {
            setMacroListRefresh((n) => n + 1);
          }
        } else if (type === 'refresh_analytics') {
          if (canAccessModule(currentUser.role, 'analytics')) {
            setAnalyticsListRefresh((n) => n + 1);
          }
        } else if (type === 'refresh_csat') {
          if (canAccessModule(currentUser.role, 'csat-reports')) {
            setCsatListRefresh((n) => n + 1);
          }
        } else if (type === 'refresh_audit') {
          if (canAccessModule(currentUser.role, 'audit')) {
            setAuditListRefresh((n) => n + 1);
          }
        } else if (type === 'refresh_priorities') {
          if (canAccessModule(currentUser.role, 'priorities')) {
            setPrioritiesListRefresh((n) => n + 1);
          }
        } else if (type === 'refresh_org_preferences') {
          if (canAccessModule(currentUser.role, 'org-preferences')) {
            setOrgPrefsListRefresh((n) => n + 1);
          }
        } else if (type === 'refresh_directory') {
          if (canAccessModule(currentUser.role, 'escalation-directory')) {
            setDirectoryListRefresh((n) => n + 1);
          }
        } else if (type === 'download') {
          const href = String(raw.href || '').trim();
          if (href.startsWith('/api/')) {
            const filename = String(raw.filename || 'download.csv');
            void (async () => {
              try {
                const res = await fetch(href, { credentials: 'include' });
                if (!res.ok) return;
                const blob = await res.blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                a.remove();
                URL.revokeObjectURL(url);
              } catch {
                /* ignore */
              }
            })();
          }
        }
      }

      // Mutations persist via LangGraph tools → Express. Chat only seeds/refreshes UI.

      // Prefer the create flow that owns the navigation target (macro over stale ticket).
      const createPrefs = [
        { flag: wantMacroCreate, view: 'macros' },
        { flag: wantKbCreate, view: 'kb' },
        { flag: wantTeamsCreate, view: 'agent-queues' },
        { flag: wantCustomerCreate, view: 'customers' },
        { flag: wantPriorityCreate, view: 'priorities' },
        { flag: wantTicketCreate, view: 'create-ticket' },
      ];
      const preferred = createPrefs.find((p) => p.flag);
      if (preferred) {
        if (preferred.view !== 'create-ticket') wantTicketCreate = false;
        if (preferred.view !== 'macros') wantMacroCreate = false;
        if (preferred.view !== 'kb') wantKbCreate = false;
        if (preferred.view !== 'agent-queues') wantTeamsCreate = false;
        if (preferred.view !== 'customers') wantCustomerCreate = false;
        if (preferred.view !== 'priorities') wantPriorityCreate = false;
      }

      // Seed create intents before navigate so the target view mounts with intent=true.
      if (wantTicketCreate) setTicketCreateIntent(true);
      if (wantTeamsCreate) setTeamsCreateIntent(true);
      if (wantMacroCreate) setMacroCreateIntent(true);
      if (wantKbCreate) setKbCreateIntent(true);
      if (wantPriorityCreate) setPriorityCreateIntent(true);
      if (wantCustomerCreate) setCustomerCreateIntent(true);

      let uiOnly = normalizeCoworkerUiActions(actions).filter((a) => {
        if (a.type !== 'navigate') return true;
        const target = resolveView(a.view);
        return canAccessModule(currentUser.role, target);
      });
      if (preferred) {
        const preferredNav = uiOnly.filter(
          (a) => a.type === 'navigate' && resolveView(a.view) === preferred.view
        );
        const nonNav = uiOnly.filter((a) => a.type !== 'navigate');
        uiOnly = preferredNav.length
          ? [...nonNav, preferredNav[preferredNav.length - 1]]
          : [
              ...nonNav,
              {
                type: 'navigate' as const,
                view: preferred.view,
              },
            ];
      }

      applyCoworkerUiActions(uiOnly, {
        navigate: (view, opts) => navigateTo(view, opts),
        setCustomerSearch,
        setCustomerStatus: setCustomerStatusFilter,
        setTicketSearch: setSearchQuery,
        setTicketStatus: setTicketStatusFilter,
        setTicketPriority: setTicketPriorityFilter,
        setTicketChannel: setTicketChannelFilter,
        setTicketCreator: setTicketCreatorFilter,
        setTicketAssignee: setTicketAssigneeFilter,
        setKbSearch,
        setTeamsSearch,
        setMacroSearch,
        setAnalyticsRange,
        setCsatRange,
        setAuditSearch,
        setAuditRange,
        setDirectorySearch,
        clearTicketFacetFilters: () => {
          setTicketPriorityFilter('');
          setTicketStatusFilter('');
          setTicketChannelFilter('');
          setTicketCreatorFilter('');
          setTicketAssigneeFilter('');
        },
      });

      if (pendingTicketOpen) {
        navigateTo('assigned', { ticketSearch: pendingTicketOpen });
      }

      if (refreshTickets) {
        await fetchTickets(
          listScopeForView(pendingTicketOpen ? 'assigned' : currentView)
        );
          await fetchMetrics();
        // Lean create: ICPA/ITRA/TSAA write subject/assignee/ai_summary async.
        const scope = listScopeForView(
          pendingTicketOpen ? 'assigned' : currentView
        );
        window.setTimeout(() => {
          void fetchTickets(scope);
        }, 8000);
        window.setTimeout(() => {
          void fetchTickets(scope);
        }, 16000);
      }
    },
    [currentUser, currentView]
  );

  /**
   * Offline fallback when LangGraph agents are unreachable.
   * Live chat meaning lives in Python; do not run a second English wizard.
   */
  const handleCoworkerMessage = useCallback(
    async (text: string): Promise<string | null> => {
      const pageForActions =
        VIEW_PAGE_LABEL[currentView] || currentView || 'Worktual';
        return llmOnlyReply(
        {
          module: 'nav',
          kind: 'unavailable',
          userText: text,
          pageLabel: pageForActions,
          context: { chatUnavailable: true },
        },
        'Chat is temporarily unavailable. Use the forms on the right, or try again shortly.',
        { message: text, page: pageForActions, allowAgentsFallback: false }
      );
    },
    [currentView]
  );

  useEffect(() => {
    const reloadAuth = async () => {
      try {
        const res = await fetch('/api/auth/me', apiFetchInit());
        if (res.ok) {
          const data = await res.json();
          setCurrentUser(data.user);
        }
      } catch {
        /* not logged in */
      } finally {
        setAuthChecked(true);
      }
    };
    void reloadAuth();
    return installEmbedAuthListener(() => {
      setAuthChecked(false);
      void reloadAuth();
    });
  }, []);

  const fetchTickets = async (listScope?: string) => {
    const gen = ++ticketsFetchGen.current;
    try {
      const params = new URLSearchParams();
      const effectiveScope =
        ticketCreatorFilter === 'me'
          ? 'created'
          : listScope && listScope !== 'default'
            ? listScope
            : '';
      if (effectiveScope) params.set('scope', effectiveScope);
      if (searchQuery.trim()) params.set('q', searchQuery.trim());
      if (ticketStatusFilter) params.set('status', ticketStatusFilter);
      if (ticketPriorityFilter) params.set('priority', ticketPriorityFilter);
      if (ticketChannelFilter) params.set('channel', ticketChannelFilter);
      if (ticketCreatorFilter === 'me') params.set('createdBy', 'SELF');
      if (ticketAssigneeFilter === 'me') params.set('assignedTo', 'SELF');
      else if (ticketAssigneeFilter && ticketAssigneeFilter !== 'unassigned') {
        params.set('assignedTo', ticketAssigneeFilter);
      }
      params.set('limit', '100');
      const qs = params.toString();
      const res = await fetch(`/api/tickets${qs ? `?${qs}` : ''}`, fetchOpts());
      if (res.status === 401) {
        setCurrentUser(null);
        return false;
      }
      if (!res.ok) throw new Error('Tickets request failed');
      const data: Ticket[] = await res.json();
      // Ignore stale responses from earlier scope navigations / polls
      if (gen !== ticketsFetchGen.current) return true;
      setTickets(data);
      return true;
    } catch (err) {
      console.error('Failed to load tickets', err);
      return false;
    }
  };

  const refreshBadgeCounts = async () => {
    if (!currentUser) return;
    try {
      const assignedScope =
        currentUser.role === 'admin' || currentUser.role === 'viewer'
          ? 'assignee'
          : undefined;
      const teamScope = canAccessModule(currentUser.role, 'team-queue')
        ? 'org'
        : canAccessModule(currentUser.role, 'team-inbox')
          ? 'team'
          : undefined;
      const [aRes, tRes] = await Promise.all([
        fetch(
          `/api/tickets${assignedScope ? `?scope=${assignedScope}` : ''}`,
          fetchOpts()
        ),
        teamScope
          ? fetch(`/api/tickets?scope=${teamScope}`, fetchOpts())
          : Promise.resolve(null),
      ]);
      if (aRes.ok) {
        const list = (await aRes.json()) as Ticket[];
        const mine = list.filter(
          (t) =>
            t.status !== 'Resolved' &&
            (currentUser.role === 'admin' || currentUser.role === 'viewer'
              ? t.assignee === currentUser.name
              : true)
        );
        // For agent/resolver default list is already assignee-scoped
        setBadgeAssignedOpen(
          currentUser.role === 'admin' || currentUser.role === 'viewer'
            ? mine.length
            : list.filter((t) => t.status !== 'Resolved').length
        );
      }
      if (tRes && tRes.ok) {
        const list = (await tRes.json()) as Ticket[];
        setBadgeTeamOpen(list.filter((t) => t.status !== 'Resolved').length);
      } else if (canAccessModule(currentUser.role, 'team-queue')) {
        // Admin all-open from metrics when no separate fetch
        setBadgeTeamOpen(metrics.openTickets || 0);
      }
    } catch {
      /* ignore badge errors */
    }
  };

  const fetchNotifications = async () => {
    try {
      const res = await fetch('/api/notifications', fetchOpts());
      if (res.status === 401) {
        setCurrentUser(null);
        return false;
      }
      if (!res.ok) throw new Error('Notifications request failed');
      const data: Notification[] = await res.json();
      setNotifications(data);
      return true;
    } catch (err) {
      console.error('Failed to load notifications', err);
      return false;
    }
  };

  const handleMarkAsRead = async (id: string) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    try {
      await fetch(`/api/notifications/${encodeURIComponent(id)}/read`, {
        method: 'PATCH',
        credentials: 'include',
      });
    } catch (err) {
      console.error('Failed to mark notification read', err);
    }
  };
  const handleMarkAllAsRead = async () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    try {
      await fetch('/api/notifications/read-all', {
        method: 'POST',
        credentials: 'include',
      });
    } catch (err) {
      console.error('Failed to mark all notifications read', err);
    }
  };
  const handleClearAllNotifications = async () => {
    setNotifications([]);
    try {
      await fetch('/api/notifications', {
        method: 'DELETE',
        credentials: 'include',
      });
    } catch (err) {
      console.error('Failed to clear notifications', err);
    }
  };

  const handleNotificationClick = (notification: Notification) => {
    void handleMarkAsRead(notification.id);
    if (notification.ticketId) {
      navigateTo(
        currentUser
          ? ticketsListModuleForRole(currentUser.role)
          : 'assigned',
        { ticketSearch: notification.ticketId }
      );
    }
  };

  const fetchMetrics = async () => {
    try {
      const res = await fetch('/api/metrics', fetchOpts());
      if (!res.ok) throw new Error('Metrics request failed');
      const data = (await res.json()) as Partial<DashboardMetrics>;
      setMetrics({
        ...emptyMetrics,
        ...data,
        priorityCounts: {
          ...emptyMetrics.priorityCounts,
          ...(data.priorityCounts || {}),
        },
        topQueues: Array.isArray(data.topQueues) ? data.topQueues : [],
      });
      return true;
    } catch (err) {
      console.error('Failed to load metrics', err);
      setMetrics(emptyMetrics);
      return false;
    }
  };

  const handleRefresh = async () => {
    setLoading(true);
    setLoadError(null);
    const watchdog = window.setTimeout(() => {
      setLoading(false);
      setLoadError((prev) => prev || 'Unable to sync workspace data.');
    }, 15_000);
    try {
    const scope = listScopeForView(currentView);
    const [ticketsOk, metricsOk, notifsOk] = await Promise.all([
      fetchTickets(scope),
      fetchMetrics(),
      fetchNotifications(),
    ]);
    await refreshBadgeCounts();
    if (!ticketsOk || !metricsOk || !notifsOk) {
        setLoadError('Unable to sync workspace data.');
      } else {
        setLoadError(null);
    }
    } finally {
      window.clearTimeout(watchdog);
    setLoading(false);
    }
  };

  useEffect(() => {
    if (currentUser) handleRefresh();
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser) return;
    const timer = window.setTimeout(() => {
    if (
      TICKET_VIEWS.includes(currentView) ||
      currentView === 'work-board' ||
      currentView === 'dashboard'
    ) {
      void fetchTickets(listScopeForView(currentView));
    }
    }, 200);
    return () => window.clearTimeout(timer);
  }, [
    currentView,
    currentUser,
    searchQuery,
    ticketStatusFilter,
    ticketPriorityFilter,
    ticketChannelFilter,
    ticketCreatorFilter,
    ticketAssigneeFilter,
  ]);

  useEffect(() => {
    if (!currentUser) return;
    const id = window.setInterval(() => {
      void fetchNotifications();
      void fetchTickets(listScopeForView(currentView));
      void refreshBadgeCounts();
    }, 30000);
    return () => window.clearInterval(id);
  }, [
    currentUser,
    currentView,
    searchQuery,
    ticketStatusFilter,
    ticketPriorityFilter,
    ticketChannelFilter,
    ticketCreatorFilter,
    ticketAssigneeFilter,
  ]);

  const handleUpdateTicket = async (
    id: string,
    updates: Partial<Ticket> & { escalate?: boolean }
  ): Promise<boolean> => {
    try {
      const res = await fetch(`/api/tickets/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(updates),
      });
      if (res.ok) {
        const scope = listScopeForView(currentView);
        await fetchTickets(scope);
        await fetchMetrics();
        // TSAA rewrites ai_summary async on status changes — refresh list once.
        if (updates.status) {
          window.setTimeout(() => {
            void fetchTickets(listScopeForView(currentView));
          }, 12000);
        }
        return true;
      }
      console.error('Failed to update ticket', await res.text().catch(() => res.status));
      return false;
    } catch (err) {
      console.error('Failed to update ticket', err);
      return false;
    }
  };

  const handleLogout = async () => {
    if (currentUser?.id) {
      clearCoworkerSessionStorage(currentUser.id);
    } else {
      clearCoworkerSessionStorage();
    }
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    clearEmbedJwt();
    setCurrentUser(null);
    setTickets([]);
    setNotifications([]);
    setCurrentView('dashboard');
  };

  const handleQueueFilterRedirect = (queueName: string) => {
    navigateTo(
      currentUser ? ticketsListModuleForRole(currentUser.role) : 'assigned',
      { ticketSearch: queueName }
    );
  };

  // Keep current view legal for this role (must be before any early return)
  useEffect(() => {
    if (!currentUser) return;
    if (!canAccessModule(currentUser.role, currentView)) {
      setCurrentView(defaultModuleForRole(currentUser.role));
    }
  }, [currentUser, currentView]);

  const handleAgentRouteScoped = useCallback(
    (agent: string, userText?: string) => {
      if (!currentUser) return;
      const lower = String(userText || '')
        .trim()
        .toLowerCase();
      const customerAsk =
        /\b(customers?|clients?|contacts?|directory)\b/.test(lower) &&
        !/\b(tickets?|cases?)\b/.test(lower);
      const resolvedAgent =
        customerAsk && (agent === 'tickets' || agent === 'general')
          ? 'customers'
          : agent;
      const raw = AGENT_VIEW[resolvedAgent];
      if (!raw) return;
      const target = resolveView(raw);
      if (!canAccessModule(currentUser.role, target)) {
        if (canAccessModule(currentUser.role, 'assigned')) {
          openSplit();
          setCurrentView('assigned');
        }
        return;
      }
      handleAgentRoute(resolvedAgent, userText);
    },
    [currentUser, handleAgentRoute, openSplit]
  );

  useEffect(() => {
    if (!currentUser) return;
    (async () => {
      try {
        const res = await fetch('/api/org-branding', fetchOpts());
        if (!res.ok) return;
        const data = await res.json();
        setOrgBranding({
          portalLabel: String(data.portalLabel || ''),
          displayTimezone: String(data.displayTimezone || 'UTC'),
        });
      } catch {
        /* ignore */
      }
    })();
  }, [currentUser?.organizationId]);

  if (!authChecked) {
    return (
      <div className="h-svh flex items-center justify-center bg-[#f3f4f6] text-neutral-500 text-sm">
        Loading…
      </div>
    );
  }

  if (!currentUser) {
    if (isEmbedMode() && !getEmbedJwt()) {
      return (
        <div className="h-svh flex items-center justify-center bg-[#f3f4f6] text-neutral-500 text-sm px-6 text-center">
          Waiting for host authentication…
        </div>
      );
    }
    if (isEmbedMode()) {
      return (
        <div className="h-svh flex items-center justify-center bg-[#f3f4f6] text-neutral-500 text-sm px-6 text-center">
          Session unavailable. Ask the host to re-authenticate Ticketing.
        </div>
      );
    }
    return (
      <LoginView
        onLoginSuccess={(user) => {
          setCurrentUser(user);
          setCurrentView(defaultModuleForRole(user.role));
        }}
      />
    );
  }

  const assignedTicketsCount = badgeAssignedOpen;
  const openTeamTicketsCount = badgeTeamOpen;
  const portalLabel =
    orgBranding.portalLabel.trim() || portalLabelForRole(currentUser.role);
  const isStaff = canMutateStaffData(currentUser.role);
  const scope = dataScopeForRole(currentUser.role);

  const wrapSplit = (
    viewKey: string,
    contentTitle: string,
    children: React.ReactNode,
    chips?: string[],
    opts?: {
      contentSubtitle?: string;
      contentHeaderActions?: React.ReactNode;
      /** Full-page expand — Dashboard / Analytics only. */
      allowFullPageExpand?: boolean;
    }
  ) => {
    const roleChips =
      currentUser.role === 'resolver'
        ? ['my tickets', 'dashboard', 'knowledge base', 'work board']
        : currentUser.role === 'customer'
          ? ['create ticket', 'my tickets']
          : ['my tickets', 'open tickets', 'create ticket', 'find customer', 'KB articles'];
    return (
    <CoworkerSplitWorkspace
      pageLabel={VIEW_PAGE_LABEL[viewKey] || contentTitle}
      contentTitle={contentTitle}
      contentSubtitle={opts?.contentSubtitle}
      contentHeaderActions={opts?.contentHeaderActions}
      allowFullPageExpand={opts?.allowFullPageExpand === true}
      onUserMessage={handleCoworkerMessage}
      onChatActions={handleCoworkerChatActions}
      onAgentRoute={handleAgentRouteScoped}
      suggestionChips={chips || roleChips}
      placeholder="Ask your Worktual co-worker..."
      module={VIEW_CHAT_MODULE[viewKey]?.module}
      surface={VIEW_CHAT_MODULE[viewKey]?.surface}
    >
      {children}
    </CoworkerSplitWorkspace>
    );
  };

  const renderMainContent = () => {
    if (loading && tickets.length === 0) {
      return (
        <div className="flex items-center justify-center h-full min-h-[400px] text-xs text-neutral-500 select-none animate-pulse">
          <div className="flex flex-col items-center space-y-3">
            <div className="h-5 w-5 border-2 border-black border-t-transparent rounded-full animate-spin" />
            <span>Synchronizing workspace…</span>
          </div>
        </div>
      );
    }

    const content = (() => {
      switch (currentView) {
        case 'dashboard':
          return (
            <DashboardView
              metrics={metrics}
              onNavigate={navigateTo}
              onRefresh={handleRefresh}
              onCoworkerMessage={handleCoworkerMessage}
              onCoworkerChatActions={handleCoworkerChatActions}
              onAgentRoute={handleAgentRouteScoped}
              showTriageStats={
                currentUser.role === 'agent' || currentUser.role === 'admin'
              }
              role={currentUser.role}
              displayTimezone={orgBranding.displayTimezone}
            />
          );
        case 'assigned':
        case 'team-queue':
        case 'team-inbox':
        case 'unassigned':
        case 'search': {
          const mode =
            currentView === 'assigned'
              ? 'assigned'
              : currentView === 'search'
                ? 'search'
                : currentView === 'team-inbox'
                  ? 'team-inbox'
                  : currentView === 'unassigned'
                    ? 'unassigned'
                    : 'team-queue';
          const title =
            currentView === 'assigned'
              ? 'Tickets'
              : currentView === 'search'
                ? 'Search'
                : currentView === 'team-inbox'
                  ? 'Team inbox'
                  : currentView === 'unassigned'
                    ? 'Unassigned'
                    : 'All tickets';
          return wrapSplit(
            currentView,
            title,
            <TicketsView
              viewMode={mode}
              tickets={tickets}
              onUpdateTicket={handleUpdateTicket}
              currentUser={currentUser}
              searchQuery={searchQuery}
              onSearchQueryChange={setSearchQuery}
              canMutate={isStaff}
              dataScope={scope}
              externalPriorityFilter={ticketPriorityFilter}
              externalStatusFilter={ticketStatusFilter}
              externalChannelFilter={ticketChannelFilter}
              externalCreatorFilter={ticketCreatorFilter}
              externalAssigneeFilter={ticketAssigneeFilter}
              onFacetFiltersChange={(facets) => {
                if (facets.priority !== undefined) {
                  setTicketPriorityFilter(facets.priority);
                }
                if (facets.status !== undefined) {
                  setTicketStatusFilter(facets.status);
                }
                if (facets.channel !== undefined) {
                  setTicketChannelFilter(facets.channel);
                }
                if (facets.creator !== undefined) {
                  setTicketCreatorFilter(facets.creator);
                }
                if (facets.assignee !== undefined) {
                  setTicketAssigneeFilter(facets.assignee);
                }
              }}
              embedded
            />
          );
        }
        case 'work-board':
          return wrapSplit(
            'work-board',
            'Work board',
            <WorkBoardView
              currentUser={currentUser}
              onUpdateTicket={handleUpdateTicket}
              displayTimezone={orgBranding.displayTimezone}
              onOpenTicket={(id) => {
                const q = id.startsWith('#') ? id : id;
                navigateTo('assigned', { ticketSearch: q });
              }}
              embedded
            />,
            ['my tickets', 'knowledge base']
          );
        case 'agent-queues':
          return (
            <AgentQueuesView
              onNavigate={navigateTo}
              onSetStatusFilter={handleQueueFilterRedirect}
              canCreate={currentUser.role === 'admin'}
              section="teams"
              externalSearchQuery={teamsSearch}
              startCreateIntent={teamsCreateIntent}
              startCreateSeed={teamsCreateSeed}
              onConsumeCreateIntent={() => setTeamsCreateIntent(false)}
              listRefreshToken={teamsListRefresh}
              directorySearchQuery={directorySearch}
              directoryListRefreshToken={directoryListRefresh}
              onCoworkerMessage={handleCoworkerMessage}
              onCoworkerChatActions={handleCoworkerChatActions}
              onAgentRoute={handleAgentRouteScoped}
            />
          );
        case 'kb':
          return (
            <KnowledgeBaseView
              canMutate={canMutateKnowledge(currentUser.role)}
              externalSearchQuery={kbSearch}
              embedded
              currentUserName={currentUser.name}
              startCreateIntent={kbCreateIntent}
              startCreateSeed={kbCreateSeed}
              onConsumeCreateIntent={() => {
                setKbCreateIntent(false);
                setKbCreateSeed(null);
              }}
              listRefreshToken={kbListRefresh}
              onCoworkerMessage={handleCoworkerMessage}
              onCoworkerChatActions={handleCoworkerChatActions}
              onAgentRoute={handleAgentRouteScoped}
            />
          );
        case 'customers':
          return wrapSplit(
            'customers',
            'Directory',
            <CustomersView
              canMutate={currentUser.role === 'admin'}
              externalSearchQuery={customerSearch}
              externalStatusFilter={customerStatusFilter}
              embedded
              startCreateIntent={customerCreateIntent}
              startCreateSeed={customerCreateSeed}
              onConsumeCreateIntent={() => {
                setCustomerCreateIntent(false);
                setCustomerCreateSeed(null);
              }}
              listRefreshToken={customersListRefresh}
            />,
            ['find customer', 'create ticket', 'my tickets']
          );
        case 'analytics':
          return wrapSplit(
            'analytics',
            'Analytics',
            <AnalyticsView
              embedded
              listRefreshToken={analyticsListRefresh}
              externalRange={analyticsRange}
              onNavigate={navigateTo}
            />,
            ['open tickets', 'my tickets', 'teams'],
            {
              allowFullPageExpand: true,
              contentSubtitle: 'Diagnostic, predictive, and prescriptive insights',
              contentHeaderActions: canAccessModule(currentUser.role, 'dashboard') ? (
                <button
                  type="button"
                  title="Back to Reports"
                  onClick={() => navigateTo('dashboard')}
                  className="inline-flex items-center gap-1 h-8 px-2.5 rounded-lg border border-neutral-950 bg-neutral-950 text-[11px] font-semibold text-white hover:bg-neutral-800 transition-colors"
                >
                  <span aria-hidden>←</span>
                  Reports
                </button>
              ) : null,
            }
          );
        case 'audit':
          return wrapSplit(
            'audit',
            'Audit log',
            <AuditLogView
              embedded
              listRefreshToken={auditListRefresh}
              externalSearchQuery={auditSearch}
              externalRange={auditRange}
            />,
            ['tickets', 'teams']
          );
        case 'csat-reports':
          return wrapSplit(
            'csat-reports',
            'CSAT reports',
            <CsatReportsView
              embedded
              listRefreshToken={csatListRefresh}
              externalRange={csatRange}
            />,
            ['analytics', 'tickets']
          );
        case 'macros':
          return (
            <MacrosView
              startCreateIntent={macroCreateIntent}
              startCreateSeed={macroCreateSeed}
              onConsumeCreateIntent={() => {
                setMacroCreateIntent(false);
                setMacroCreateSeed(null);
              }}
              listRefreshToken={macroListRefresh}
              externalSearchQuery={macroSearch}
              onCoworkerMessage={handleCoworkerMessage}
              onCoworkerChatActions={handleCoworkerChatActions}
              onAgentRoute={handleAgentRouteScoped}
            />
          );
        case 'priorities':
          return (
            <PrioritiesView
              startCreateIntent={priorityCreateIntent}
              startCreateStep={priorityCreateStep}
              startCreateKind={priorityCreateKind}
              startCreateSeed={priorityCreateSeed}
              onConsumeCreateIntent={() => {
                setPriorityCreateIntent(false);
                setPriorityCreateStep(null);
                setPriorityCreateKind(null);
                setPriorityCreateSeed(null);
              }}
              listRefreshToken={prioritiesListRefresh}
              onCoworkerMessage={handleCoworkerMessage}
              onCoworkerChatActions={handleCoworkerChatActions}
              onAgentRoute={handleAgentRouteScoped}
            />
          );
        case 'escalation-directory':
          return (
            <AgentQueuesView
              onNavigate={navigateTo}
              onSetStatusFilter={handleQueueFilterRedirect}
              canCreate={currentUser.role === 'admin'}
              section="escalation"
              externalSearchQuery={teamsSearch}
              listRefreshToken={teamsListRefresh}
              directorySearchQuery={directorySearch}
              directoryListRefreshToken={directoryListRefresh}
              onCoworkerMessage={handleCoworkerMessage}
              onCoworkerChatActions={handleCoworkerChatActions}
              onAgentRoute={handleAgentRouteScoped}
            />
          );
        case 'org-preferences':
          return wrapSplit(
            'org-preferences',
            'Org preferences',
            <OrgPreferencesView embedded listRefreshToken={orgPrefsListRefresh} />,
            ['settings', 'teams']
          );
        case 'approvals':
          return wrapSplit(
            'approvals',
            'Approvals',
            <ApprovalsView embedded />,
            ['tickets']
          );
        case 'create-ticket':
          return (
            <CreateTicketView
              onNavigate={navigateTo}
              onCreateTicketSuccess={handleRefresh}
              startCreateIntent={ticketCreateIntent}
              startCreateSeed={ticketCreateSeed}
              onConsumeCreateIntent={() => {
                setTicketCreateIntent(false);
                setTicketCreateSeed(null);
              }}
              onAgentRoute={handleAgentRouteScoped}
              onCoworkerChatActions={handleCoworkerChatActions}
              currentUser={currentUser}
            />
          );
        case 'settings':
          return (
            <SettingsView
              currentUser={currentUser}
              onLogout={handleLogout}
              onUserUpdate={setCurrentUser}
            />
          );
        default:
          return (
            <div className="p-6 text-center text-xs text-neutral-400">
              View "{currentView}" is not implemented yet.
            </div>
          );
      }
    })();

    return (
      <>
        {loadError && (
          <div className="mx-4 sm:mx-6 mt-3 border border-amber-200 bg-amber-50 text-amber-800 text-xs px-4 py-3 rounded-xl">
            {loadError}
          </div>
        )}
        {content}
      </>
    );
  };

  return (
    <CoworkerSessionProvider userKey={currentUser.id}>
      <PageTitleProvider>
        <div
          id="worktual-app"
          className="flex h-svh w-full max-w-[100vw] overflow-hidden bg-[#f3f4f6] select-none font-sans"
        >
          <Sidebar
            currentView={currentView}
            onNavigate={navigateTo}
            ticketCount={assignedTicketsCount}
            openTicketCount={openTeamTicketsCount}
            role={currentUser.role}
            open={sidebarOpen}
            onClose={() => setSidebarOpen(false)}
            collapsed={sidebarCollapsed}
            onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
            portalLabel={portalLabel}
          />
          <div className="flex flex-1 flex-col min-w-0 min-h-0 overflow-hidden">
            <Header
              onNavigate={navigateTo}
              currentUser={currentUser}
              notifications={notifications}
              onMarkAsRead={handleMarkAsRead}
              onMarkAllAsRead={handleMarkAllAsRead}
              onClearAll={handleClearAllNotifications}
              onNotificationClick={handleNotificationClick}
              onLogout={handleLogout}
              onMenuClick={() => setSidebarOpen(true)}
            />
            <main
              id="main-scrollable-body"
              className="flex-1 overflow-hidden bg-[#f3f4f6] min-h-0 min-w-0 relative"
            >
              <div className="animate-[fadeIn_0.2s_ease-out] h-full min-h-0">{renderMainContent()}</div>
            </main>
          </div>
        </div>
      </PageTitleProvider>
    </CoworkerSessionProvider>
  );
}
