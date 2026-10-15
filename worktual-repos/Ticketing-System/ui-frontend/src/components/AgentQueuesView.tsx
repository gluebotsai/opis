import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Inbox,
  Layers,
  Plus,
  Search,
  ChevronRight,
  ArrowLeft,
  Pencil,
  Trash2,
  Network,
} from 'lucide-react';
import { AgentQueue } from '../types';
import { useSetPageTitle } from './layout/PageTitleContext';
import PageShell from './layout/PageShell';
import EscalationDirectoryView from './EscalationDirectoryView';
import { useWorkspacePresentation } from './layout/WorkspacePresentationContext';
import CoworkerSplitWorkspace, {
  useCoworkerSplitExpandOptional,
} from './coworker/CoworkerSplitWorkspace';
import { llmOnlyReply } from './coworker/llmGuidedReply';
import {
  useReportFocusedEntity,
  useCoworkerSendUserText,
} from './coworker/CoworkerSessionContext';
import GuidedTeamPreview, {
  TEAM_GUIDED_STEPS,
  isTeamConfirmStep,
  teamStepIndex,
} from './coworker/GuidedTeamPreview';
import GuidedDeletePreview, {
  type PendingDelete,
} from './coworker/GuidedDeletePreview';
import { isAddTeamMembersUiDraft } from './coworker/coworkerActions';

type StaffOption = {
  id: string;
  name: string;
  email: string;
  role: string;
  skills: string[];
};

/** Widen the right panel while the create form is open in chat split. */
function TeamCreateFocus() {
  const split = useCoworkerSplitExpandOptional();
  useEffect(() => {
    split?.focusContent();
    return () => split?.clearContentFocus();
  }, [split]);
  return null;
}

interface AgentQueuesViewProps {
  onNavigate: (view: string) => void;
  onSetStatusFilter: (status: string) => void;
  canCreate?: boolean;
  externalSearchQuery?: string;
  /** Which Teams section to show (Escalation lives under Teams). */
  section?: 'teams' | 'escalation';
  directorySearchQuery?: string;
  directoryListRefreshToken?: number;
  startCreateIntent?: boolean;
  startCreateSeed?: {
    step?: string;
    name?: string;
    description?: string;
    members?: string[];
  } | null;
  onConsumeCreateIntent?: () => void;
  /** Bumped after chat creates/deletes a team — reload list. */
  listRefreshToken?: number;
  onCoworkerMessage?: (text: string) => string | null | Promise<string | null>;
  onCoworkerChatActions?: (
    actions: Record<string, unknown>[],
    meta: { reply: string; agent: string; userText: string }
  ) => void | Promise<void>;
  onAgentRoute?: (agent: string, userText?: string) => void;
}

export default function AgentQueuesView({
  onNavigate,
  onSetStatusFilter,
  canCreate = false,
  externalSearchQuery,
  section = 'teams',
  directorySearchQuery,
  directoryListRefreshToken = 0,
  startCreateIntent = false,
  startCreateSeed = null,
  onConsumeCreateIntent,
  listRefreshToken = 0,
  onCoworkerMessage,
  onCoworkerChatActions,
  onAgentRoute,
}: AgentQueuesViewProps) {
  useSetPageTitle(section === 'escalation' ? 'Escalation directory' : 'Teams');
  const { presentation, openFullPage, openSplit } = useWorkspacePresentation();
  const sendUserText = useCoworkerSendUserText();

  const [queues, setQueues] = useState<AgentQueue[]>([]);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [focusedTeamId, setFocusedTeamId] = useState<string | null>(null);
  /** Create form beside chat (do not hide chat with full-page). */
  const [splitCreate, setSplitCreate] = useState(false);

  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formMemberIds, setFormMemberIds] = useState<string[]>([]);
  const [pendingAddMemberNames, setPendingAddMemberNames] = useState<string[]>(
    []
  );
  const [guidedTeam, setGuidedTeam] = useState(false);
  const [guidedStepIndex, setGuidedStepIndex] = useState(0);
  const [guidedConfirming, setGuidedConfirming] = useState(false);
  const [guidedName, setGuidedName] = useState('');
  const [guidedRoster, setGuidedRoster] = useState<string[]>([]);
  const [guidedMemberNames, setGuidedMemberNames] = useState<string[]>([]);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [deleting, setDeleting] = useState(false);
  const recentlyDeletedRef = useRef(new Set<string>());
  const pendingOpenTeamRef = useRef<{ id?: string; name?: string } | null>(null);
  const guidedCollectingRef = useRef({
    guided: false,
    name: '',
    description: '',
    members: [] as string[],
  });
  guidedCollectingRef.current = {
    guided: guidedTeam,
    name: formName || guidedName,
    description: formDescription,
    members: guidedMemberNames,
  };
  const activeTeamId = editingId || focusedTeamId;
  const focusedTeam = queues.find((q) => q.id === activeTeamId) || null;
  useReportFocusedEntity(
    focusedTeam
      ? { type: 'team', id: focusedTeam.id, name: focusedTeam.queueName }
      : null
  );

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 3200);
  };

  const fetchQueues = useCallback(async () => {
    try {
      const res = await fetch('/api/queues', { credentials: 'include' });
      const data = await res.json();
      setQueues(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Failed to fetch queues', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchStaff = async () => {
    try {
      const res = await fetch('/api/agents', { credentials: 'include' });
      const data = await res.json();
      if (!Array.isArray(data)) {
        setStaff([]);
        return;
      }
      setStaff(
        data
          .map((a: unknown) => {
            if (typeof a === 'string') {
              return { id: '', name: a, email: '', role: '', skills: [] as string[] };
            }
            const row = a as Partial<StaffOption>;
            return {
              id: String(row.id || ''),
              name: String(row.name || ''),
              email: String(row.email || ''),
              role: String(row.role || ''),
              skills: Array.isArray(row.skills) ? row.skills.map(String) : [],
            };
          })
          .filter((a: StaffOption) => a.name)
      );
    } catch (err) {
      console.error('Failed to fetch agents', err);
    }
  };

  useEffect(() => {
    void fetchQueues();
    void fetchStaff();
  }, [fetchQueues]);

  useEffect(() => {
    if (!listRefreshToken) return;
    void fetchQueues();
  }, [listRefreshToken, fetchQueues]);

  useEffect(() => {
    if (externalSearchQuery !== undefined) setSearch(externalSearchQuery);
  }, [externalSearchQuery]);

  useEffect(() => {
    if (!pendingAddMemberNames.length || !staff.length) return;
    const wanted = new Set(
      pendingAddMemberNames.map((n) => n.trim().toLowerCase()).filter(Boolean)
    );
    const extra = staff
      .filter((s) => wanted.has(String(s.name || '').trim().toLowerCase()))
      .map((s) => s.id)
      .filter(Boolean);
    if (!extra.length) return;
    setFormMemberIds((prev) => [...new Set([...prev, ...extra])]);
  }, [staff, pendingAddMemberNames]);

  const resetForm = () => {
    setEditingId(null);
    setFormName('');
    setFormDescription('');
    setFormMemberIds([]);
    setPendingAddMemberNames([]);
  };

  /** Full-page form (no chat) — toolbar "New team". */
  const openCreateFull = useCallback(() => {
    if (!canCreate) return;
    resetForm();
    setSplitCreate(false);
    openFullPage();
  }, [canCreate, openFullPage]);

  /** Chat create — keep chat left, guided steps on the right (same as create ticket). */
  const openCreateBesideChat = useCallback(
    (opts?: { reset?: boolean }) => {
      if (!canCreate) return;
      if (opts?.reset !== false) {
        resetForm();
        setGuidedName('');
        setGuidedStepIndex(0);
        setGuidedConfirming(false);
        setGuidedRoster([]);
        setGuidedMemberNames([]);
      }
      openSplit();
      setSplitCreate(true);
      setGuidedTeam(true);
      void fetchStaff();
    },
    [canCreate, openSplit]
  );

  /** Chat-driven edit: keep chat left, staff checklist on the right. */
  const openEditBesideChat = useCallback(
    (q: AgentQueue) => {
      if (!canCreate) return;
      setEditingId(q.id);
      setFormName(q.queueName);
      setFormDescription(q.description || '');
      setFormMemberIds(q.memberIds?.length ? [...q.memberIds] : []);
      setGuidedTeam(false);
      setGuidedStepIndex(0);
        setGuidedConfirming(false);
      openSplit();
      setSplitCreate(true);
      void fetchStaff();
    },
    [canCreate, openSplit]
  );

  useEffect(() => {
    const pending = pendingOpenTeamRef.current;
    if (!pending || !queues.length) return;
    pendingOpenTeamRef.current = null;
    const hit = pending.id
      ? queues.find((q) => q.id === pending.id)
      : pending.name
        ? queues.find(
            (q) =>
              String(q.queueName || '').trim().toLowerCase() ===
              pending.name!.trim().toLowerCase()
          )
        : undefined;
    if (hit && canCreate) {
      openEditBesideChat(hit);
      return;
    }
    if (pending.id) setFocusedTeamId(pending.id);
    else if (pending.name) setSearch(pending.name);
  }, [queues, canCreate, openEditBesideChat]);

  useEffect(() => {
    if (!startCreateIntent) return;
    onConsumeCreateIntent?.();
    if (!canCreate) {
      showToast('Only admins can create teams.');
      return;
    }
    if (section === 'escalation') {
      onNavigate('agent-queues');
    }
    const name = String(startCreateSeed?.name || '').trim();
    const description = String(startCreateSeed?.description || '').trim();
    const members = Array.isArray(startCreateSeed?.members)
      ? startCreateSeed.members.map((m) => String(m || '').trim()).filter(Boolean)
      : [];
    const incomingFields = Boolean(name || description || members.length);
    openCreateBesideChat({ reset: !incomingFields });
    if (name) {
      setFormName(name);
      setGuidedName(name);
    }
    if (description) setFormDescription(description);
    if (members.length) setGuidedMemberNames(members);
    const step = String(startCreateSeed?.step || '')
      .trim()
      .toLowerCase();
    setGuidedStepIndex(
      teamStepIndex(
        step || (name && description ? 'members' : name ? 'description' : 'name')
      )
    );
    setGuidedConfirming(isTeamConfirmStep(step));
  }, [
    startCreateIntent,
    startCreateSeed,
    onConsumeCreateIntent,
    canCreate,
    openCreateBesideChat,
    section,
    onNavigate,
  ]);

  useEffect(() => {
    if (!startCreateSeed) return;
    const name = String(startCreateSeed.name || '').trim();
    const description = String(startCreateSeed.description || '').trim();
    const members = Array.isArray(startCreateSeed.members)
      ? startCreateSeed.members.map((m) => String(m || '').trim()).filter(Boolean)
      : [];
    const step = String(startCreateSeed.step || '')
      .trim()
      .toLowerCase();
    if (!name && !description && !members.length) {
      setFormName('');
      setGuidedName('');
      setFormDescription('');
      setGuidedMemberNames([]);
      setFormMemberIds([]);
      setGuidedStepIndex(teamStepIndex(step || 'name'));
      setGuidedConfirming(false);
      return;
    }
    if (name) {
      setFormName(name);
      setGuidedName(name);
    }
    if (description) setFormDescription(description);
    if (members.length) setGuidedMemberNames(members);
    // Absolute step so corrections (e.g. re-ask name) move the progress panel back.
    setGuidedStepIndex(
      teamStepIndex(
        step || (name && description ? 'members' : name ? 'description' : 'name')
      )
    );
    setGuidedConfirming(isTeamConfirmStep(step));
  }, [startCreateSeed]);

  const applyTeamDraftFromActions = useCallback(
    (actions: Record<string, unknown>[]) => {
      const teamActions = actions.filter((raw) => {
        const type = String(raw.type || '').toLowerCase();
        const awaiting = String(raw.awaiting || raw.step || '')
          .trim()
          .toLowerCase();
        if (type === 'delete_team' || awaiting === 'delete_confirm') return false;
        // Add-members uses update_team — never drive the create-team progress panel.
        if (type === 'update_team' || isAddTeamMembersUiDraft(raw)) return false;
        return (
          type === 'create_team' ||
          (!type &&
            (raw.name ||
              raw.queueName ||
              raw.description ||
              raw.awaiting ||
              raw.step ||
              raw.members))
        );
      });
      if (!teamActions.length) return;
      const anyFields = teamActions.some((raw) => {
        const name = String(raw.name || raw.queueName || '').trim();
        const description = String(raw.description || '').trim();
        const members = Array.isArray(raw.members) ? raw.members : [];
        return Boolean(name || description || members.length);
      });
      for (const raw of teamActions) {
        const done = Boolean(raw.done);
        const save = Boolean(raw.save || raw.confirm);
        const name = String(raw.name || raw.queueName || '').trim();
        const description = String(raw.description || '').trim();
        const memberNames = Array.isArray(raw.members)
          ? raw.members.map((m) => String(m || '').trim()).filter(Boolean)
          : [];
        const isBareStart =
          !done &&
          !save &&
          !anyFields &&
          (!String(raw.step || raw.awaiting || '').trim() ||
            String(raw.step || raw.awaiting || '')
              .trim()
              .toLowerCase() === 'name');
        if (name) {
          setFormName(name);
          setGuidedName(name);
        }
        if (description) setFormDescription(description);
        if (memberNames.length) {
          setGuidedMemberNames(memberNames);
          if (staff.length) {
            const wanted = new Set(memberNames.map((n) => n.toLowerCase()));
            const ids = staff
              .filter((s) => wanted.has(s.name.toLowerCase()))
              .map((s) => s.id)
              .filter(Boolean);
            if (ids.length) setFormMemberIds(ids);
          }
        }
        const roster = Array.isArray(raw.availableMembers)
          ? raw.availableMembers.map((n) => String(n || '').trim()).filter(Boolean)
          : Array.isArray(raw.available_members)
            ? raw.available_members.map((n) => String(n || '').trim()).filter(Boolean)
            : [];
        if (roster.length) setGuidedRoster(roster);
        if (!done && !save) {
          openCreateBesideChat({ reset: isBareStart });
          const step = String(raw.step || raw.awaiting || '')
            .trim()
            .toLowerCase();
          const inferred =
            step ||
            (name && description ? 'members' : name ? 'description' : 'name');
          const nextIndex = teamStepIndex(inferred);
          setGuidedStepIndex(nextIndex);
          setGuidedConfirming(isTeamConfirmStep(step));
        }
        if (done || Boolean(raw.refresh)) {
          setSplitCreate(false);
          setGuidedTeam(false);
          setGuidedStepIndex(0);
          setGuidedConfirming(false);
          setGuidedRoster([]);
          setGuidedMemberNames([]);
          const tid = String(raw.id || '').trim();
          const tname = String(raw.name || raw.queueName || '').trim();
          if (tid || tname) {
            pendingOpenTeamRef.current = tid ? { id: tid } : { name: tname };
          }
          if (name) setSearch(name);
        }
      }
    },
    [openCreateBesideChat, staff]
  );

  const handleChatActions = useCallback(
    async (
      actions: Record<string, unknown>[],
      meta: { reply: string; agent: string; userText: string }
    ) => {
      applyTeamDraftFromActions(actions);
      let reload = false;
      for (const raw of actions) {
        let type = String(raw.type || '').toLowerCase();
        if (type === 'create_team' && isAddTeamMembersUiDraft(raw)) {
          type = 'update_team';
        }
        if (type === 'create_team') {
          if (Boolean(raw.done) || Boolean(raw.refresh)) {
            reload = true;
            setGuidedTeam(false);
            setSplitCreate(false);
            const tid = String(raw.id || '').trim();
            const tname = String(raw.name || raw.queueName || '').trim();
            if (tid || tname) {
              pendingOpenTeamRef.current = tid ? { id: tid } : { name: tname };
            }
          }
        } else if (type === 'open_team') {
          const tid = String(raw.id || '').trim();
          const tname = String(raw.name || raw.queueName || '').trim();
          if (tid || tname) {
            pendingOpenTeamRef.current = tid ? { id: tid } : { name: tname };
          }
          setGuidedTeam(false);
          setSplitCreate(false);
          reload = true;
        } else if (type === 'delete_team') {
          const done = Boolean(raw.done || raw.refresh);
          const name = String(raw.name || raw.queueName || '').trim();
          const id = String(raw.id || '').trim();
          if (done) {
            setPendingDelete(null);
            setSplitCreate(false);
            setGuidedTeam(false);
            reload = true;
          } else if (id || name) {
            const gone =
              (id && recentlyDeletedRef.current.has(id)) ||
              (name && recentlyDeletedRef.current.has(name.toLowerCase()));
            if (!gone) {
              setGuidedTeam(false);
              setSplitCreate(false);
              setPendingDelete({
                kind: 'team',
                id,
                name: name || 'this team',
              });
            }
          }
        } else if (type === 'update_team') {
          const done = Boolean(raw.done) || Boolean(raw.confirm) || Boolean(raw.refresh);
          const step = String(raw.step || raw.awaiting || '').trim().toLowerCase();
          const openForm =
            Boolean(raw.open) ||
            step === 'members' ||
            step === 'members_names' ||
            step === 'members_team' ||
            isAddTeamMembersUiDraft(raw);
          const teamId = String(raw.id || '').trim();
          const teamName = String(raw.name || raw.queueName || '').trim();
          // Always leave create-team "Next steps" when add-members is active.
          setGuidedTeam(false);
          setGuidedStepIndex(0);
          setGuidedConfirming(false);
          if (openForm && !done) {
            const match =
              queues.find((q) => q.id === teamId) ||
              queues.find(
                (q) => q.queueName.toLowerCase() === teamName.toLowerCase()
              );
            const pendingNames = Array.isArray(raw.members)
              ? raw.members.map((m) => String(m || '').trim()).filter(Boolean)
              : [];
            setPendingAddMemberNames(pendingNames);
            if (match) {
              openEditBesideChat(match);
            } else if (teamId || teamName) {
              setEditingId(teamId || null);
              setFormName(teamName);
              openSplit();
              setSplitCreate(true);
              void fetchStaff();
            } else {
              // Still picking which team — close stale create progress; keep list.
              setSplitCreate(false);
            }
          }
          if (done) {
            setPendingAddMemberNames([]);
            setSplitCreate(false);
            setGuidedTeam(false);
            setEditingId(null);
            reload = true;
            if (teamName) setSearch(teamName);
          }
        } else if (type === 'refresh_teams') {
          reload = true;
        } else if (type === 'set_filter' && String(raw.module || '') === 'teams') {
          setSearch(String(raw.query || ''));
        } else if (type === 'clear_filters') {
          const mod = String(raw.module || '').toLowerCase();
          if (mod === 'teams' || mod === 'all') setSearch('');
        }
      }
      await onCoworkerChatActions?.(actions, meta);
      if (reload) await fetchQueues();
    },
    [
      applyTeamDraftFromActions,
      onCoworkerChatActions,
      openEditBesideChat,
      openSplit,
      fetchQueues,
      queues,
    ]
  );
  const handleChatMessage = useCallback(
    async (raw: string): Promise<string | null> => {
      const text = raw.trim();
      if (onCoworkerMessage) return onCoworkerMessage(text);
      return llmOnlyReply(
        {
          module: 'team',
          kind: 'unavailable',
          userText: text,
          pageLabel: 'Teams',
          context: { chatUnavailable: true },
        },
        'Chat is temporarily unavailable. Use the team form on the right, or try again shortly.',
        { message: text, page: 'Teams', allowAgentsFallback: false }
      );
    },
    [onCoworkerMessage]
  );

  const openEdit = (q: AgentQueue) => {
    if (!canCreate) return;
    setGuidedTeam(false);
    setGuidedStepIndex(0);
        setGuidedConfirming(false);
    openEditBesideChat(q);
  };

  const saveTeam = async (): Promise<boolean> => {
    const name = formName.trim();
    const description = formDescription.trim();
    if (name.length < 2) {
      showToast('Team name is required.');
      return false;
    }
    if (!description) {
      showToast('Team description is required.');
      return false;
    }
    if (!editingId && formMemberIds.length === 0) {
      showToast('Select at least one team member before creating.');
      return false;
    }
    setCreating(true);
    try {
      const payload = {
        queueName: name,
        description,
        memberIds: formMemberIds,
      };
      const res = await fetch(
        editingId ? `/api/queues/${encodeURIComponent(editingId)}` : '/api/queues',
        {
          method: editingId ? 'PATCH' : 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        showToast(String((err as { error?: string }).error || 'Could not save team'));
        return false;
      }
      showToast(editingId ? 'Team updated' : 'Team created');
      await fetchQueues();
      resetForm();
      setSplitCreate(false);
      setGuidedTeam(false);
      setGuidedStepIndex(0);
        setGuidedConfirming(false);
      openSplit();
      return true;
    } catch {
      showToast('Could not save team');
      return false;
    } finally {
      setCreating(false);
    }
  };

  const executeDeleteTeam = async (q: { id: string; queueName: string }) => {
    if (!canCreate) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/queues/${encodeURIComponent(q.id)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok && res.status !== 204) {
        const err = await res.json().catch(() => ({}));
        showToast(String((err as { error?: string }).error || 'Could not delete team'));
        return;
      }
      showToast('Team deleted');
      recentlyDeletedRef.current.add(q.id);
      recentlyDeletedRef.current.add(q.queueName.toLowerCase());
      setPendingDelete(null);
      await fetchQueues();
    } catch {
      showToast('Could not delete team');
    } finally {
      setDeleting(false);
    }
  };

  const requestDeleteTeam = (q: AgentQueue) => {
    if (!canCreate) return;
    setGuidedTeam(false);
    setSplitCreate(false);
    setPendingDelete({ kind: 'team', id: q.id, name: q.queueName });
    void sendUserText?.(`delete team ${q.queueName}`);
  };

  const toggleMember = (id: string) => {
    if (!id) return;
    setFormMemberIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const filtered = queues.filter((q) => {
    if (!search.trim()) return true;
    const s = search.toLowerCase();
    return (
      q.queueName.toLowerCase().includes(s) ||
      (q.description || '').toLowerCase().includes(s) ||
      (q.members || []).some((m) => m.toLowerCase().includes(s)) ||
      (q.memberDetails || []).some(
        (m) =>
          m.name.toLowerCase().includes(s) ||
          String(m.email || '').toLowerCase().includes(s) ||
          String(m.role || '').toLowerCase().includes(s) ||
          (m.skills || []).some((sk) => sk.toLowerCase().includes(s))
      )
    );
  });

  const activeCount = queues.filter((q) => q.openTickets > 0).length;
  const memberSlots = queues.reduce((sum, q) => sum + (q.members?.length || 0), 0);

  if (presentation === 'full') {
    return (
      <PageShell id="agent-queues-form" embedded={false}>
        {toast && (
          <div className="fixed bottom-5 right-5 z-[60] rounded-xl bg-neutral-950 text-white text-xs font-medium px-4 py-2.5 shadow-lg">
            {toast}
          </div>
        )}
        <div className="mx-auto max-w-2xl space-y-6">
          <button
            type="button"
            onClick={() => {
              resetForm();
              setSplitCreate(false);
              openSplit();
            }}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-neutral-600 hover:text-neutral-900"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to Teams
          </button>
          <div>
            <h2 className="text-lg font-semibold text-neutral-900">
              {editingId ? 'Edit team' : 'Create team'}
            </h2>
            <p className="mt-1 text-sm text-neutral-500">
              Name, description, and at least one member are required. Members show roles and
              skills from MyAccount (synced into Ticketing).
            </p>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void saveTeam();
            }}
            className="space-y-5 rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm"
          >
            <div className="space-y-1.5">
              <label className="block text-[10px] font-bold uppercase tracking-wider text-neutral-500">
                Team name
              </label>
              <input
                required
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="e.g. Network Support"
                className="h-10 w-full rounded-xl border border-neutral-200 px-3 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <label className="block text-[10px] font-bold uppercase tracking-wider text-neutral-500">
                Description
              </label>
              <textarea
                required
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                rows={3}
                placeholder="What this team handles — used to route new tickets"
                className="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm"
              />
            </div>
            <div className="space-y-2">
              <label className="block text-[10px] font-bold uppercase tracking-wider text-neutral-500">
                Members
              </label>
              {staff.length === 0 ? (
                <p className="text-xs text-neutral-400">No active staff found.</p>
              ) : (
                <ul className="max-h-64 space-y-1.5 overflow-y-auto rounded-xl border border-neutral-200 p-2">
                  {staff.map((a) => {
                    const selected = a.id ? formMemberIds.includes(a.id) : false;
                    return (
                      <li key={a.id || a.name}>
                      <button
                        type="button"
                          disabled={!a.id}
                          onClick={() => toggleMember(a.id)}
                          className={`flex w-full items-start gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors ${
                          selected
                            ? 'border-neutral-900 bg-neutral-900 text-white'
                              : 'border-transparent bg-neutral-50 text-neutral-800 hover:border-neutral-200'
                          }`}
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs font-semibold">{a.name}</span>
                            <span
                              className={`mt-0.5 block text-[11px] ${
                                selected ? 'text-neutral-300' : 'text-neutral-500'
                              }`}
                            >
                              {a.role || '—'}
                              {a.skills.length ? ` · ${a.skills.join(', ')}` : ''}
                            </span>
                          </span>
                      </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            <div className="flex flex-wrap gap-2 pt-2">
              <button
                type="submit"
                disabled={creating}
                className="h-10 rounded-xl bg-black px-4 text-xs font-semibold text-white hover:bg-neutral-800 disabled:opacity-50"
              >
                {creating ? 'Saving…' : editingId ? 'Save changes' : 'Create team'}
              </button>
              <button
                type="button"
                onClick={() => {
                  resetForm();
                  setSplitCreate(false);
                  openSplit();
                }}
                className="h-10 rounded-xl border border-neutral-200 bg-white px-4 text-xs font-semibold text-neutral-700"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      </PageShell>
    );
  }

  const selectSection = (next: 'teams' | 'escalation') => {
    if (next === section) return;
    if (next === 'escalation') {
      resetForm();
      setSplitCreate(false);
      setGuidedTeam(false);
      setPendingDelete(null);
      onNavigate('escalation-directory');
      return;
    }
    onNavigate('agent-queues');
  };

  const sectionTabs = (
    <div
      role="tablist"
      aria-label="Teams sections"
      className="flex shrink-0 gap-1 rounded-xl border border-neutral-200 bg-neutral-50 p-1"
    >
      <button
        type="button"
        role="tab"
        aria-selected={section === 'teams'}
        onClick={() => selectSection('teams')}
        className={`inline-flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
          section === 'teams'
            ? 'bg-white text-neutral-900 shadow-sm'
            : 'text-neutral-500 hover:text-neutral-800'
        }`}
      >
        <span
          className={`inline-flex h-6 w-6 items-center justify-center rounded-md ${
            section === 'teams'
              ? 'bg-neutral-900 text-white'
              : 'bg-neutral-200 text-neutral-600'
          }`}
        >
          <Inbox className="h-3.5 w-3.5" strokeWidth={2.25} />
        </span>
        Teams
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={section === 'escalation'}
        onClick={() => selectSection('escalation')}
        className={`inline-flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
          section === 'escalation'
            ? 'bg-white text-neutral-900 shadow-sm'
            : 'text-neutral-500 hover:text-neutral-800'
        }`}
      >
        <span
          className={`inline-flex h-6 w-6 items-center justify-center rounded-md ${
            section === 'escalation'
              ? 'bg-neutral-900 text-white'
              : 'bg-neutral-200 text-neutral-600'
          }`}
        >
          <Network className="h-3.5 w-3.5" strokeWidth={2.25} />
        </span>
        Escalation
      </button>
    </div>
  );

  const listPanel = (
    <div className="space-y-4 px-5 sm:px-6 py-5">
      {sectionTabs}

      {section === 'escalation' ? (
        <EscalationDirectoryView
          embedded
          nested
          listRefreshToken={directoryListRefreshToken}
          externalSearchQuery={directorySearchQuery}
        />
      ) : (
        <>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-neutral-900">Teams</h2>
          <p className="mt-0.5 text-[13px] text-neutral-500">
            Admin-managed teams in Ticketing. Routing uses each team&apos;s description and member
            skills.
          </p>
        </div>
        {canCreate && (
          <button
            type="button"
            onClick={openCreateFull}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl bg-neutral-900 px-3 text-xs font-semibold text-white"
          >
            <Plus className="h-3.5 w-3.5" />
            New team
          </button>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2.5">
        {[
          { label: 'Teams', value: queues.length },
          { label: 'Active', value: activeCount },
          { label: 'Members', value: memberSlots },
        ].map((s) => (
          <div
            key={s.label}
            className="rounded-xl border border-neutral-200 bg-neutral-50/80 px-3 py-2.5"
          >
            <p className="text-[10px] font-medium uppercase tracking-wide text-neutral-400">
              {s.label}
            </p>
            <p className="mt-0.5 text-sm font-semibold tabular-nums text-neutral-900">{s.value}</p>
          </div>
        ))}
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search teams..."
          className="h-10 w-full rounded-xl border border-neutral-200 bg-neutral-50 pl-9 pr-3 text-sm placeholder:text-neutral-400"
        />
      </div>

      {loading ? (
        <p className="py-8 text-center text-xs text-neutral-400">Loading teams…</p>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-neutral-200 px-4 py-10 text-center">
          <Layers className="mx-auto mb-2 h-6 w-6 text-neutral-300" />
          <p className="text-sm font-medium text-neutral-700">
            {search.trim() ? 'No matching teams' : 'No teams yet'}
          </p>
          <p className="mx-auto mt-1 max-w-[260px] text-xs leading-relaxed text-neutral-500">
            {search.trim()
              ? 'Try a different search, or clear the filter.'
              : canCreate
                ? 'Create a team with a description and members. New tickets route by description, then skills.'
                : 'Ask an admin to create teams in Ticketing.'}
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {filtered.map((q) => (
            <li
              key={q.id}
              className="rounded-xl border border-neutral-200 bg-white px-3.5 py-3"
            >
              <div className="flex items-start gap-3">
              <button
                type="button"
                onClick={() => {
                    setFocusedTeamId(q.id);
                    // Opens the role-correct ticket list filtered by this team name.
                    // Do not also navigate to legacy "tickets-list" (not an AppModule).
                  onSetStatusFilter(q.queueName);
                }}
                  className="flex min-w-0 flex-1 items-start gap-3 text-left"
              >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-neutral-100">
                  <Inbox className="h-4 w-4 text-neutral-500" />
                </div>
                <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-neutral-900">{q.queueName}</p>
                    {q.description ? (
                      <p className="mt-0.5 line-clamp-2 text-[12px] text-neutral-500">
                        {q.description}
                      </p>
                    ) : null}
                    <p className="mt-1 text-[11px] text-neutral-400">
                      {q.members?.length || 0} member
                      {(q.members?.length || 0) === 1 ? '' : 's'} · {q.openTickets} open
                    {q.slaStatus === 'At Risk' ? ' · At risk' : ''}
                  </p>
                    {q.memberDetails && q.memberDetails.length > 0 ? (
                      <p className="mt-0.5 truncate text-[11px] text-neutral-400">
                        {q.memberDetails
                          .map((m) => `${m.name} (${m.role})`)
                          .join(', ')}
                      </p>
                    ) : q.members && q.members.length > 0 ? (
                      <p className="mt-0.5 truncate text-[11px] text-neutral-400">
                      {q.members.join(', ')}
                    </p>
                    ) : null}
                </div>
                  <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-neutral-400" />
              </button>
                {canCreate && (
                  <div className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      aria-label={`Edit ${q.queueName}`}
                      onClick={() => openEdit(q)}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-neutral-200 text-neutral-600 hover:bg-neutral-50"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete ${q.queueName}`}
                      onClick={() => requestDeleteTeam(q)}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-neutral-200 text-neutral-600 hover:bg-red-50 hover:text-red-700"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
        </>
      )}
    </div>
  );

  const cancelGuidedCreate = useCallback(() => {
    resetForm();
    setGuidedName('');
    setGuidedStepIndex(0);
    setGuidedConfirming(false);
    setGuidedRoster([]);
    setGuidedMemberNames([]);
    setGuidedTeam(false);
    setSplitCreate(false);
    setPendingDelete(null);
  }, []);

  useEffect(() => {
    if (!guidedMemberNames.length || !staff.length) return;
    const wanted = new Set(guidedMemberNames.map((n) => n.toLowerCase()));
    const ids = staff
      .filter((s) => s.id && wanted.has(s.name.toLowerCase()))
      .map((s) => s.id);
    if (!ids.length) return;
    setFormMemberIds((prev) => {
      const same =
        prev.length === ids.length && prev.every((id, i) => id === ids[i]);
      return same ? prev : ids;
    });
  }, [guidedMemberNames, staff]);

  const toggleMemberByName = useCallback(
    (name: string) => {
      const match = staff.find((s) => s.name.toLowerCase() === name.toLowerCase());
      setGuidedMemberNames((prev) => {
        const has = prev.some((n) => n.toLowerCase() === name.toLowerCase());
        if (has) return prev.filter((n) => n.toLowerCase() !== name.toLowerCase());
        return [...prev, match?.name || name];
      });
      if (!match?.id) return;
      setFormMemberIds((prev) =>
        prev.includes(match.id) ? prev.filter((id) => id !== match.id) : [...prev, match.id]
      );
    },
    [staff]
  );

  const getChatContext = useCallback(() => {
    if (pendingDelete) {
      return {
        module: 'teams',
        surface: 'list',
        draft: {
          awaiting: 'delete_confirm',
          name: pendingDelete.name || undefined,
          id: pendingDelete.id || undefined,
        },
        focusedEntity: pendingDelete.id
          ? { type: 'team' as const, id: pendingDelete.id, name: pendingDelete.name }
          : undefined,
      };
    }
    const memberNames = staff
      .filter((s) => s.id && formMemberIds.includes(s.id))
      .map((s) => s.name);
    const members = memberNames.length ? memberNames : guidedMemberNames;
    const formOpen = Boolean(splitCreate || editingId || guidedTeam);
    const focus =
      focusedTeam
        ? { type: 'team' as const, id: focusedTeam.id, name: focusedTeam.queueName }
        : undefined;

    if (formOpen) {
      const step = TEAM_GUIDED_STEPS[guidedStepIndex] || TEAM_GUIDED_STEPS[0];
      return {
        module: 'teams',
        surface: editingId ? 'detail' : 'create',
        draft: {
          awaiting: guidedConfirming
            ? 'confirm'
            : guidedTeam
              ? step.id === 'members'
                ? 'create_members'
                : step.id
              : editingId
                ? 'members'
                : 'name',
          id: editingId || focusedTeam?.id || undefined,
          name: formName || guidedName || focusedTeam?.queueName || undefined,
          description: formDescription || focusedTeam?.description || undefined,
          members,
          flow: editingId ? 'add_team_members' : 'create_team',
        },
        focusedEntity: focus,
      };
    }

    return {
      module: 'teams',
      surface: 'list',
      draft: null,
      focusedEntity: focus,
    };
  }, [pendingDelete, guidedTeam, guidedStepIndex, guidedConfirming, formName, guidedName, formDescription, formMemberIds, guidedMemberNames, staff, splitCreate, editingId, focusedTeam]);

  const memberPickNames =
    staff.length > 0 ? staff.map((s) => s.name) : guidedRoster;
  const selectedMemberNames = staff
    .filter((s) => s.id && formMemberIds.includes(s.id))
    .map((s) => s.name);
  const previewMembers = selectedMemberNames.length
    ? selectedMemberNames
    : guidedMemberNames;

  const guidedPanel = (
    <GuidedTeamPreview
      draft={{
        name: formName || guidedName,
        description: formDescription,
        members: previewMembers,
      }}
      stepIndex={guidedStepIndex}
      confirming={guidedConfirming}
      creating={creating}
      availableAgents={memberPickNames}
      onCancel={cancelGuidedCreate}
      onUseForm={() => {
        setGuidedTeam(false);
        setSplitCreate(false);
        openFullPage();
      }}
      onConfirmCreate={() => {
        void saveTeam();
      }}
      onToggleAgent={toggleMemberByName}
    />
  );

  const createFormInSplit = (
    <div className="px-5 sm:px-6 py-5 space-y-5">
      <TeamCreateFocus />
      <button
        type="button"
        onClick={() => {
          resetForm();
          setSplitCreate(false);
          setGuidedTeam(false);
          setGuidedStepIndex(0);
        setGuidedConfirming(false);
        }}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-neutral-600 hover:text-neutral-900"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to Teams
      </button>
      <div>
        <h2 className="text-lg font-semibold text-neutral-900">
          {editingId ? 'Edit team' : 'Create team'}
        </h2>
        <p className="mt-1 text-sm text-neutral-500">
          {editingId
            ? 'Update the name, description, or members. Chat stays on the left.'
            : 'Chat stays on the left — name, description, and at least one member are required.'}
        </p>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void saveTeam();
        }}
        className="space-y-5 rounded-2xl border border-neutral-200 bg-white p-5 sm:p-6 shadow-sm"
      >
        <div className="space-y-1.5">
          <label className="block text-[10px] font-bold uppercase tracking-wider text-neutral-500">
            Team name
          </label>
          <input
            required
            value={formName}
            onChange={(e) => setFormName(e.target.value)}
            placeholder="e.g. Network Support"
            className="h-10 w-full rounded-xl border border-neutral-200 px-3 text-sm"
          />
        </div>
        <div className="space-y-1.5">
          <label className="block text-[10px] font-bold uppercase tracking-wider text-neutral-500">
            Description
          </label>
          <textarea
            required
            value={formDescription}
            onChange={(e) => setFormDescription(e.target.value)}
            rows={3}
            placeholder="What this team handles — used to route new tickets"
            className="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm"
          />
        </div>
        <div className="space-y-2">
          <label className="block text-[10px] font-bold uppercase tracking-wider text-neutral-500">
            Members
          </label>
          {staff.length === 0 ? (
            <p className="text-xs text-neutral-400">No active staff found.</p>
          ) : (
            <ul className="max-h-64 space-y-1.5 overflow-y-auto rounded-xl border border-neutral-200 p-2">
              {staff.map((a) => {
                const selected = a.id ? formMemberIds.includes(a.id) : false;
                return (
                  <li key={a.id || a.name}>
                    <button
                      type="button"
                      disabled={!a.id}
                      onClick={() => toggleMember(a.id)}
                      className={`flex w-full items-start gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors ${
                        selected
                          ? 'border-neutral-900 bg-neutral-900 text-white'
                          : 'border-transparent bg-neutral-50 text-neutral-800 hover:border-neutral-200'
                      }`}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-semibold">{a.name}</span>
                        <span
                          className={`mt-0.5 block text-[11px] ${
                            selected ? 'text-neutral-300' : 'text-neutral-500'
                          }`}
                        >
                          {a.role || '—'}
                          {a.skills.length ? ` · ${a.skills.join(', ')}` : ''}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div className="flex flex-wrap gap-2 pt-2">
          <button
            type="submit"
            disabled={creating}
            className="h-10 rounded-xl bg-black px-4 text-xs font-semibold text-white hover:bg-neutral-800 disabled:opacity-50"
          >
            {creating ? 'Saving…' : editingId ? 'Save changes' : 'Create team'}
          </button>
          <button
            type="button"
            onClick={() => {
              resetForm();
              setSplitCreate(false);
              setGuidedTeam(false);
              setGuidedStepIndex(0);
        setGuidedConfirming(false);
            }}
            className="h-10 rounded-xl border border-neutral-200 bg-white px-4 text-xs font-semibold text-neutral-700"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );

  return (
    <>
      {toast && (
        <div className="fixed bottom-5 right-5 z-[60] rounded-xl bg-neutral-950 px-4 py-2.5 text-xs font-medium text-white shadow-lg">
          {toast}
        </div>
      )}
      <CoworkerSplitWorkspace
        pageLabel="Teams"
        contentTitle={
          pendingDelete
            ? 'Next steps'
            : splitCreate && guidedTeam && !editingId
            ? 'Next steps'
            : splitCreate
              ? editingId
                ? 'Edit team'
                : 'Create team'
              : section === 'escalation'
                ? 'Escalation directory'
                : 'Your teams'
        }
        placeholder={
          section === 'escalation'
            ? 'Ask who to escalate to, or open a team…'
            : 'e.g. create team, delete team frontend, list my teams'
        }
        suggestionChips={
          pendingDelete
            ? ['confirm', 'cancel']
            : section === 'escalation'
              ? ['list teams', 'who can take escalations', 'open tickets']
            : guidedTeam && !editingId && guidedStepIndex >= 2 && memberPickNames.length > 0
            ? [...memberPickNames, 'add all']
            : canCreate
              ? ['create team', 'list my teams', 'delete team']
              : ['list my teams', 'what can you help with?']
        }
        getChatContext={getChatContext}
        onUserMessage={handleChatMessage}
        onChatActions={handleChatActions}
        onChatRestart={cancelGuidedCreate}
        onAgentRoute={onAgentRoute}
        module={section === 'escalation' ? 'admin' : 'teams'}
        surface={
          section === 'escalation'
            ? 'directory'
            : splitCreate || guidedTeam
              ? editingId
                ? 'detail'
                : 'create'
              : 'list'
        }
        onDraftPatch={(patch) => {
          const awaiting = String(patch.awaiting || patch.step || '')
            .trim()
            .toLowerCase();
          if (awaiting === 'delete_confirm') {
            void handleChatActions(
              [{ type: 'delete_team', ...patch, step: 'confirm' }],
              { reply: '', agent: 'teams', userText: '' }
            );
            return;
          }
          if (isAddTeamMembersUiDraft(patch)) {
            void handleChatActions(
              [{ type: 'update_team', ...patch, open: true }],
              { reply: '', agent: 'teams', userText: '' }
            );
            return;
          }
          applyTeamDraftFromActions([{ type: 'create_team', ...patch }]);
        }}
        contentHeaderActions={
          splitCreate && guidedTeam && !editingId && !pendingDelete ? (
            <button
              type="button"
              onClick={() => {
                setGuidedTeam(false);
                setSplitCreate(false);
                openFullPage();
              }}
              className="inline-flex items-center h-8 px-2.5 rounded-lg border border-neutral-200 bg-white text-xs font-semibold text-neutral-800 hover:bg-neutral-50"
            >
              Use form
            </button>
          ) : null
        }
      >
        {pendingDelete ? (
          <GuidedDeletePreview
            pending={pendingDelete}
            deleting={deleting}
            onCancel={() => setPendingDelete(null)}
            onConfirm={() => {
              void executeDeleteTeam({
                id: pendingDelete.id,
                queueName: pendingDelete.name,
              });
            }}
          />
        ) : splitCreate
          ? editingId
            ? createFormInSplit
            : guidedTeam
              ? guidedPanel
              : createFormInSplit
          : listPanel}
      </CoworkerSplitWorkspace>
    </>
  );
}
