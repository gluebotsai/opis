import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  UploadCloud,
  Trash2,
  File,
  User,
  Sparkles,
  Search,
  Mail,
  MessageSquare,
  Phone,
  Globe,
  X,
} from 'lucide-react';
import { Priority, Channel, AuthUser } from '../types';
import { useSetPageTitle } from './layout/PageTitleContext';
import PageShell from './layout/PageShell';
import { useWorkspacePresentation } from './layout/WorkspacePresentationContext';
import CoworkerSplitWorkspace from './coworker/CoworkerSplitWorkspace';
import GuidedTicketPreview, {
  emptyTicketDraft,
  TICKET_GUIDED_STEPS,
  ticketStepIndex,
  TicketDraft,
} from './coworker/GuidedTicketPreview';
import { llmOnlyReply } from './coworker/llmGuidedReply';

interface CreateTicketViewProps {
  onNavigate: (view: string, opts?: { ticketSearch?: string }) => void;
  onCreateTicketSuccess: () => void;
  /** When true (e.g. user said “create ticket” elsewhere), reset guided create. */
  startCreateIntent?: boolean;
  /** Draft fields captured in chat (survives navigate after add-customer). */
  startCreateSeed?: {
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
  } | null;
  onConsumeCreateIntent?: () => void;
  /** Unused for live chat — UI routes only via onCoworkerChatActions. */
  onAgentRoute?: (agent: string) => void;
  onCoworkerChatActions?: (
    actions: Record<string, unknown>[],
    meta: { reply: string; agent: string; userText: string }
  ) => void | Promise<void>;
  currentUser?: AuthUser;
}

const GREETING_FALLBACK =
  'Greet as Worktual co-worker briefly and ask which customer this ticket is for (name, email, or phone). They can pick an existing directory contact or add a new one with name, email, and phone.';

const CUSTOMER_GREETING_FALLBACK =
  'Greet as Worktual co-worker briefly and ask the customer to describe their issue.';

type DirectoryHit = { id: string; name: string; email: string; phone: string };

async function fetchDirectoryHits(q: string): Promise<DirectoryHit[]> {
  const query = q.trim();
  if (query.length < 2) return [];
  try {
    const res = await fetch(`/api/customers?q=${encodeURIComponent(query)}`, {
      credentials: 'include',
    });
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    return data
      .slice(0, 8)
      .map((c: Record<string, unknown>) => ({
        id: String(c.id || ''),
        name: String(c.name || ''),
        email: String(c.email || ''),
        phone: String(c.phone || ''),
      }))
      .filter((c) => c.id);
  } catch {
    return [];
  }
}

function normalizeAgentOptions(data: unknown): string[] {
  if (!Array.isArray(data)) return [];
  return data
    .map((a) => (typeof a === 'string' ? a : String((a as { name?: string })?.name || '')))
    .filter(Boolean);
}

export default function CreateTicketView({
  onNavigate,
  onCreateTicketSuccess,
  startCreateIntent = false,
  startCreateSeed = null,
  onConsumeCreateIntent,
  onAgentRoute,
  onCoworkerChatActions,
  currentUser,
}: CreateTicketViewProps) {
  useSetPageTitle('Create Ticket');
  const { presentation, openFullPage, openSplit } = useWorkspacePresentation();
  const isCustomer = currentUser?.role === 'customer';
  const canAddCustomer = currentUser?.role === 'admin';

  const [draft, setDraft] = useState<TicketDraft>(() => {
    const d = emptyTicketDraft();
    if (currentUser?.role === 'customer') {
      d.customerName = currentUser.name || '';
      d.customerEmail = currentUser.email || '';
    }
    return d;
  });
  const draftRef = React.useRef(draft);
  draftRef.current = draft;

  const [stepIndex, setStepIndex] = useState(() =>
    currentUser?.role === 'customer' ? 2 : 0
  );
  // Progress panel only when create intent is clear (chat / agent), not on page load.
  const [guided, setGuided] = useState(false);
  const [queueOptions, setQueueOptions] = useState<string[]>([]);
  const [priorityOptions, setPriorityOptions] = useState<
    Array<{ priority: string; displayName: string }>
  >([]);
  const [agentOptions, setAgentOptions] = useState<string[]>([]);
  const [attachments, setAttachments] = useState<string[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const [customerQuery, setCustomerQuery] = useState('');
  const [customerHits, setCustomerHits] = useState<
    Array<{ id: string; name: string; email: string; phone: string }>
  >([]);
  const [addingCustomer, setAddingCustomer] = useState(false);
  const [newCustomer, setNewCustomer] = useState({
    name: '',
    email: '',
    phone: '',
  });
  const [savingCustomer, setSavingCustomer] = useState(false);

  const searchCustomers = async (q: string) => {
    setCustomerHits(await fetchDirectoryHits(q));
  };

  const applyCustomer = (c: {
    id: string;
    name: string;
    email: string;
    phone: string;
  }) => {
    setDraft((d) => ({
      ...d,
      customerId: c.id,
      customerName: c.name,
      customerEmail: c.email || '',
      customerPhone: c.phone || '',
    }));
    setCustomerQuery(c.name);
    setCustomerHits([]);
    setAddingCustomer(false);
    setNewCustomer({ name: '', email: '', phone: '' });
  };

  const saveNewCustomer = async () => {
    const name = newCustomer.name.trim();
    const email = newCustomer.email.trim();
    const phone = newCustomer.phone.trim();
    if (!name || !email || !phone) {
      setErrorMsg('Name, email, and phone are required to add a customer.');
      return;
    }
    setSavingCustomer(true);
    setErrorMsg('');
    try {
      const res = await fetch('/api/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name, email, phone }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        id?: string;
        name?: string;
        email?: string;
        phone?: string;
        customer?: {
          id?: string;
          name?: string;
          email?: string;
          phone?: string;
        };
      };
      if (!res.ok) {
        const existing = data.customer;
        if (res.status === 409 && existing?.id) {
          applyCustomer({
            id: String(existing.id),
            name: String(existing.name || name),
            email: String(existing.email || email),
            phone: String(existing.phone || phone),
          });
          showToast('Customer already on file — selected.');
          return;
        }
        setErrorMsg(data.error || 'Could not add customer.');
        return;
      }
      const row = data.customer || data;
      const id = String(row.id || data.id || '').trim();
      if (!id) {
        setErrorMsg('Customer created but id was missing. Search the directory.');
        return;
      }
      applyCustomer({
        id,
        name: String(row.name || name),
        email: String(row.email || email),
        phone: String(row.phone || phone),
      });
      showToast('Customer added');
    } catch {
      setErrorMsg('Could not add customer.');
    } finally {
      setSavingCustomer(false);
    }
  };

  const stepAfterCustomer = (c: { email?: string; phone?: string }) =>
    c.email || c.phone ? 2 : 1;

  useEffect(() => {
    if (!isCustomer || !currentUser) return;
    setDraft((d) => ({
      ...d,
      customerName: currentUser.name || d.customerName,
      customerEmail: currentUser.email || d.customerEmail,
    }));
    setStepIndex((s) => (s < 2 ? 2 : s));
  }, [isCustomer, currentUser]);

  useEffect(() => {
    openSplit();
  }, [openSplit]);

  useEffect(() => {
    if (!startCreateIntent) return;
    setGuided(true);
    openSplit();
    const seed = startCreateSeed;
    const seedName = String(seed?.customerName || '').trim();
    const seedEmail = String(seed?.customerEmail || '').trim();
    const seedPhone = String(seed?.customerPhone || '').trim();
    const seedIssue = String(seed?.issue || '').trim();
    const seedSubject = String(seed?.subject || '').trim();
    const seedId = String(seed?.customerId || '').trim();
    const seedHasFields = Boolean(
      seedName ||
        seedEmail ||
        seedPhone ||
        seedIssue ||
        seedSubject ||
        seedId ||
        seed?.priority ||
        seed?.queue ||
        seed?.assignee ||
        seed?.resolver
    );
    const alreadyCollecting = Boolean(
      draftRef.current.customerName.trim() ||
        draftRef.current.customerEmail.trim() ||
        draftRef.current.customerPhone.trim() ||
        draftRef.current.issue.trim() ||
        draftRef.current.subject.trim()
    );
    // Prefer chat seed (e.g. after add-customer → create-ticket navigate).
    // Do not wipe a live panel that already has progress when seed is empty.
    if (seedHasFields) {
      const looksEmail = (value: string) =>
        /^[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}$/.test(value);
      const looksPhone = (value: string) => value.replace(/\D/g, '').length >= 7;
      const next = emptyTicketDraft();
      if (seedId) next.customerId = seedId;
      if (seedName) next.customerName = seedName;
      if (seedEmail && looksEmail(seedEmail)) next.customerEmail = seedEmail;
      if (seedPhone && looksPhone(seedPhone)) next.customerPhone = seedPhone;
      if (seedIssue) {
        next.issue = seedIssue;
        if (!next.description) next.description = seedIssue;
        if (!next.subject) next.subject = seedIssue.slice(0, 120);
      }
      if (seedSubject) next.subject = seedSubject;
      const description = String(seed?.description || '').trim();
      if (description) next.description = description;
      const priority = String(seed?.priority || '')
        .trim()
        .toLowerCase();
      if (['urgent', 'high', 'medium', 'low'].includes(priority)) {
        next.priority = priority as TicketDraft['priority'];
      }
      if (seed?.queue) next.queue = String(seed.queue).trim();
      if (seed?.assignee && seed.assignee !== 'Unassigned') {
        next.assignee = String(seed.assignee).trim();
      }
      if (seed?.assigneeId) next.assigneeId = String(seed.assigneeId).trim();
      if (seed?.resolver) next.resolver = String(seed.resolver).trim();
      if (seed?.resolverId) next.resolverId = String(seed.resolverId).trim();
      if (seed?.rationale) next.rationale = String(seed.rationale).trim();
      if (seed?.category) next.category = String(seed.category).trim();
      if (seed?.skill) next.skill = String(seed.skill).trim();
      if (seed?.enrichedByAi === true) next.enrichedByAi = true;
      if (
        seed?.resolverConfidence != null &&
        !Number.isNaN(Number(seed.resolverConfidence))
      ) {
        next.resolverConfidence = Number(seed.resolverConfidence);
      }
      setDraft(next);
      if (seedName.length >= 2) setCustomerQuery(seedName);
      const step = String(seed?.step || '')
        .trim()
        .toLowerCase();
      let idx = step ? ticketStepIndex(step) : ticketStepIndex('name');
      const hasContact =
        (seedEmail && looksEmail(seedEmail)) ||
        (seedPhone && looksPhone(seedPhone));
      if (!isCustomer && idx > 1 && !hasContact) idx = 1;
      if (isCustomer && idx < 2) idx = 2;
      setStepIndex(idx);
      if (seedName.length >= 2) {
        void (async () => {
          setCustomerHits(await fetchDirectoryHits(seedName));
        })();
      }
    } else if (alreadyCollecting) {
      onConsumeCreateIntent?.();
      return;
    } else {
      setStepIndex(isCustomer ? 2 : 0);
      setDraft(emptyTicketDraft());
    }
    setAttachments([]);
    setErrorMsg('');
    setEnriching(false);
    onConsumeCreateIntent?.();
  }, [startCreateIntent, startCreateSeed, onConsumeCreateIntent, openSplit, isCustomer]);

  useEffect(() => {
    const loadOptions = async () => {
      try {
        const [qRes, aRes, pRes] = await Promise.all([
          fetch('/api/queues', { credentials: 'include' }),
          fetch('/api/agents', { credentials: 'include' }),
          fetch('/api/priorities', { credentials: 'include' }),
        ]);
        if (qRes.ok) {
          const queues = await qRes.json();
          setQueueOptions((queues as Array<{ queueName: string }>).map((q) => q.queueName));
        }
        if (aRes.ok) {
          setAgentOptions(normalizeAgentOptions(await aRes.json()));
        }
        if (pRes.ok) {
          const list = await pRes.json();
          setPriorityOptions(
            Array.isArray(list)
              ? list.map((p: { priority: string; displayName: string }) => ({
                  priority: p.priority,
                  displayName: p.displayName || p.priority,
                }))
              : []
          );
        } else {
          console.error('Failed to load priorities', pRes.status);
          setPriorityOptions([]);
        }
      } catch (err) {
        console.error('Failed to load queue/agent/priority options', err);
      }
    };
    void loadOptions();
  }, []);

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 3000);
  };

  const applyTicketDraftFromActions = useCallback((actions: Record<string, unknown>[]) => {
    const looksEmail = (value: string) =>
      /^[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}$/.test(value);
    const looksPhone = (value: string) => value.replace(/\D/g, '').length >= 7;
    for (const raw of actions) {
      if (String(raw.type || '').toLowerCase() !== 'create_ticket') continue;
      const done = Boolean(raw.done || raw.refresh);
      const save = Boolean(raw.save || raw.confirm);
      if (done || save) {
        setGuided(false);
        continue;
      }
      setGuided(true);
      const name = String(raw.customerName || raw.customer_name || '').trim();
      const email = String(raw.customerEmail || '').trim();
      const phone = String(raw.customerPhone || '').trim();
      const issue = String(raw.issue || raw.description || '').trim();
      const subject = String(raw.subject || '').trim();
      const priority = String(raw.priority || '').trim().toLowerCase();
      const customerId = String(raw.customerId || raw.customer_id || '').trim();
      const queue = String(raw.queue || '').trim();
      const assignee = String(raw.assignee || '').trim();
      const assigneeId = String(raw.assigneeId || raw.assignee_id || '').trim();
      const resolver = String(raw.resolver || '').trim();
      const resolverId = String(raw.resolverId || raw.resolver_id || '').trim();
      const rationale = String(raw.rationale || '').trim();
      const category = String(raw.category || '').trim();
      const skill = String(raw.skill || '').trim();
      const description = String(raw.description || '').trim();
      const confRaw = raw.resolverConfidence ?? raw.resolver_confidence ?? raw.confidence;
      setDraft((d) => {
        const next = { ...d };
        if (name) next.customerName = name;
        if (email && looksEmail(email)) next.customerEmail = email;
        if (phone && looksPhone(phone)) next.customerPhone = phone;
        if (issue) {
          next.issue = issue;
          if (!next.description) next.description = issue;
          if (!next.subject) next.subject = issue.slice(0, 120);
        }
        if (subject) next.subject = subject;
        if (description) next.description = description;
        if (['urgent', 'high', 'medium', 'low'].includes(priority)) {
          next.priority = priority as TicketDraft['priority'];
        }
        if (customerId) next.customerId = customerId;
        if (queue) next.queue = queue;
        if (assignee && assignee !== 'Unassigned') next.assignee = assignee;
        if (assigneeId) next.assigneeId = assigneeId;
        if (resolver) next.resolver = resolver;
        if (resolverId) next.resolverId = resolverId;
        if (rationale) next.rationale = rationale;
        if (category) next.category = category;
        if (skill) next.skill = skill;
        if (confRaw != null && confRaw !== '') {
          const n = Number(confRaw);
          if (!Number.isNaN(n)) next.resolverConfidence = n;
        }
        if (raw.enrichedByAi === true) next.enrichedByAi = true;
        return next;
      });
      const step = String(raw.step || raw.awaiting || '')
        .trim()
        .toLowerCase();
      if (step) {
        let idx = ticketStepIndex(step);
        const hasContact =
          (email && looksEmail(email)) ||
          (phone && looksPhone(phone)) ||
          looksEmail(draftRef.current.customerEmail) ||
          looksPhone(draftRef.current.customerPhone);
        if (!isCustomer && idx > 1 && !hasContact) idx = 1;
        setStepIndex(idx);
      }
    }
  }, [isCustomer, onNavigate]);

  const getChatContext = useCallback(() => {
    const d = draftRef.current;
    const step = guided ? TICKET_GUIDED_STEPS[stepIndex] : null;
    if (!guided || !step) return { module: 'tickets', surface: 'create', draft: null };
    // Page chrome alone is not an in-progress create. Only hydrate a draft when
    // the user has filled something — otherwise "create priority" on this page
    // is misread as continue-create-ticket.
    const hasProgress = Boolean(
      d.customerId?.trim() ||
        d.customerName?.trim() ||
        d.customerEmail?.trim() ||
        d.customerPhone?.trim() ||
        d.issue?.trim() ||
        d.subject?.trim()
    );
    if (!hasProgress) {
      return { module: 'tickets', surface: 'create', draft: null };
    }
    return {
      module: 'tickets',
      surface: 'create',
      draft: {
        awaiting: step.id === 'customerName' ? 'name' : step.id,
        customerId: d.customerId || undefined,
        customerName: d.customerName || undefined,
        customerEmail: d.customerEmail || undefined,
        customerPhone: d.customerPhone || undefined,
        issue: d.issue || undefined,
        subject: d.subject || undefined,
        priority: d.priority || undefined,
      },
    };
  }, [guided, stepIndex]);

  /**
   * Leave guided create entirely (cancel / chat restart). Staying in guided
   * would make the next message ("continue", "ok") land on the name step.
   */
  const cancelDraft = useCallback(() => {
    setDraft(emptyTicketDraft());
    setAttachments([]);
    setStepIndex(isCustomer ? 2 : 0);
    setGuided(false);
    setErrorMsg('');
    setEnriching(false);
  }, [isCustomer]);

  const submitTicket = async (d: TicketDraft) => {
    let draftToSend = d;
    if (!draftToSend.customerId.trim()) {
      const q = draftToSend.customerEmail.trim() || draftToSend.customerPhone.trim();
      if (q) {
        try {
          const res = await fetch(`/api/customers?q=${encodeURIComponent(q)}`, {
            credentials: 'include',
          });
          const data = await res.json();
          const hit = Array.isArray(data)
            ? data.find(
                (c: { email?: string; phone?: string }) =>
                  (draftToSend.customerEmail &&
                    String(c.email || '').toLowerCase() ===
                      draftToSend.customerEmail.toLowerCase()) ||
                  (draftToSend.customerPhone && c.phone === draftToSend.customerPhone)
              ) || data[0]
            : null;
          if (hit?.id) {
            draftToSend = {
              ...draftToSend,
              customerId: String(hit.id),
              customerName: String(hit.name || draftToSend.customerName),
              customerEmail: String(hit.email || draftToSend.customerEmail),
              customerPhone: String(hit.phone || draftToSend.customerPhone),
            };
            setDraft(draftToSend);
          }
        } catch {
          /* backend will still reject unknown customers */
        }
      }
    }
    const hasContact = Boolean(draftToSend.customerEmail.trim() || draftToSend.customerPhone.trim());
    if (
      !draftToSend.subject.trim() ||
      !draftToSend.description.trim() ||
      !draftToSend.channel ||
      !draftToSend.priority ||
      !draftToSend.queue ||
      !draftToSend.assignee ||
      (!isCustomer && !draftToSend.customerId.trim()) ||
      !draftToSend.customerName.trim() ||
      !hasContact
    ) {
      setErrorMsg(
        isCustomer
          ? 'Add a subject and description before filing.'
          : 'Select or add a customer (name, email, phone), then file.'
      );
      return false;
    }
    setSubmitting(true);
    setErrorMsg('');
    try {
      const res = await fetch('/api/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          subject: draftToSend.subject.trim(),
          description: draftToSend.description.trim(),
          customerId: draftToSend.customerId.trim(),
          customerName: draftToSend.customerName.trim(),
          customerEmail: draftToSend.customerEmail.trim(),
          customerPhone: draftToSend.customerPhone.trim(),
          channel: draftToSend.channel,
          priority: draftToSend.priority,
          status: 'Open',
          queue: draftToSend.queue,
          assignee: draftToSend.assignee,
          assigneeId: draftToSend.assigneeId || undefined,
          resolver: draftToSend.resolver || undefined,
          resolverId: draftToSend.resolverId || undefined,
          category: d.category || undefined,
          skill: d.skill || undefined,
          attachments,
        }),
      });
      if (res.ok) {
        const bodyJson = (await res.json().catch(() => null)) as
          | { id?: string; ticketNumber?: string; ticket_number?: string }
          | null;
        const tid = String(
          bodyJson?.ticketNumber || bodyJson?.ticket_number || bodyJson?.id || ''
        ).trim();
        showToast('Ticket filed');
        onCreateTicketSuccess();
        cancelDraft();
        openSplit();
        if (tid) {
          const search = tid.startsWith('#') ? tid : `#${tid.replace(/^#/, '')}`;
          void onCoworkerChatActions?.(
            [
              {
                type: 'open_ticket',
                id: search,
                ticketNumber: search,
              },
            ],
            { reply: '', agent: 'tickets', userText: '' }
          );
          onNavigate('assigned', { ticketSearch: search });
        } else {
          onNavigate('tickets-list');
        }
        return true;
      }
      const errData = (await res.json().catch(() => ({}))) as { error?: string };
      setErrorMsg(errData.error || 'Failed to submit ticket.');
      return false;
    } catch (err) {
      console.error('Error creating ticket', err);
      setErrorMsg('Unable to reach the server.');
      return false;
    } finally {
      setSubmitting(false);
    }
  };

  const handleChatMessage = useCallback(
    async (raw: string): Promise<string | null> => {
      const text = raw.trim();
      return llmOnlyReply(
        {
          module: 'ticket',
          kind: 'unavailable',
          userText: text,
          pageLabel: 'Create Ticket',
          context: { chatUnavailable: true },
        },
        'Chat is temporarily unavailable. Use the ticket form on the right, or try again shortly.',
        { message: text, page: 'Create Ticket', allowAgentsFallback: false }
      );
    },
    []
  );

  const uploadFiles = async (fileList: FileList) => {
    const form = new FormData();
    Array.from(fileList).forEach((f) => form.append('files', f));
    try {
      const res = await fetch('/api/uploads', {
        method: 'POST',
        credentials: 'include',
        body: form,
      });
      if (res.ok) {
        const data = await res.json();
        setAttachments((prev) => [...prev, ...(data.urls || [])]);
      } else {
        setAttachments((prev) => [...prev, ...Array.from(fileList).map((f) => f.name)]);
      }
    } catch {
      setAttachments((prev) => [...prev, ...Array.from(fileList).map((f) => f.name)]);
    }
  };

  const aiHint = draft.enrichedByAi ? (
    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-violet-700">
      <Sparkles className="h-3 w-3" />
      Filled from the issue
    </span>
  ) : null;

  const fieldLabel = 'text-[10px] font-semibold uppercase tracking-wide text-neutral-500';
  const fieldControl =
    'w-full h-9 rounded-lg border border-neutral-200 bg-white px-3 text-sm text-neutral-900 placeholder:text-neutral-400 transition focus:border-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-900/10 disabled:bg-neutral-50';
  const req = <span className="text-rose-500 font-semibold">*</span>;

  const readyBits = [
    Boolean(draft.subject.trim()),
    Boolean(draft.description.trim()),
    Boolean(draft.channel),
    Boolean(draft.priority),
    queueOptions.length === 0 || Boolean(draft.queue),
    Boolean(draft.assignee),
    Boolean(draft.customerId || (isCustomer && draft.customerName)),
  ];
  const readyCount = readyBits.filter(Boolean).length;
  const readyTotal = readyBits.length;
  const canFile = readyCount === readyTotal && !submitting;

  const channelChoices: Array<{ value: Channel; label: string; Icon: typeof Mail }> = [
    { value: 'Email', label: 'Email', Icon: Mail },
    { value: 'Chat', label: 'Chat', Icon: MessageSquare },
    { value: 'Phone', label: 'Phone', Icon: Phone },
    { value: 'Web', label: 'Web', Icon: Globe },
  ];

  const priorityTone = (name: string) => {
    const n = name.toLowerCase();
    if (n.includes('urgent') || n.includes('critical'))
      return 'border-rose-200 bg-rose-50 text-rose-800 data-[on=true]:border-rose-600 data-[on=true]:bg-rose-600 data-[on=true]:text-white';
    if (n.includes('high'))
      return 'border-orange-200 bg-orange-50 text-orange-800 data-[on=true]:border-orange-500 data-[on=true]:bg-orange-500 data-[on=true]:text-white';
    if (n.includes('medium'))
      return 'border-amber-200 bg-amber-50 text-amber-800 data-[on=true]:border-amber-500 data-[on=true]:bg-amber-500 data-[on=true]:text-white';
    if (n.includes('low'))
      return 'border-sky-200 bg-sky-50 text-sky-800 data-[on=true]:border-sky-600 data-[on=true]:bg-sky-600 data-[on=true]:text-white';
    return 'border-neutral-200 bg-white text-neutral-700 data-[on=true]:border-neutral-900 data-[on=true]:bg-neutral-900 data-[on=true]:text-white';
  };

  const formPanel = (
    <div className="w-full max-w-6xl mx-auto flex-1 min-h-0 flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 shrink-0 mb-2">
        <button
          type="button"
          onClick={() => {
            openSplit();
            // Keep guided only if a draft is in progress; otherwise stay intent-closed.
            const d = draftRef.current;
            const hasProgress = Boolean(
              d.customerName.trim() ||
                d.customerEmail.trim() ||
                d.customerPhone.trim() ||
                d.issue.trim() ||
                d.subject.trim()
            );
            setGuided(hasProgress);
          }}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-neutral-500 hover:text-neutral-900"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to chat
        </button>
        <div className="flex items-center gap-2">
          {draft.enrichedByAi ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-800">
              <Sparkles className="h-3 w-3" />
              AI draft
            </span>
          ) : null}
          <span className="text-[11px] font-medium text-neutral-500 tabular-nums">
            {readyCount}/{readyTotal} ready
          </span>
        </div>
      </div>
      <div className="h-1 rounded-full bg-neutral-200 overflow-hidden mb-2 shrink-0">
        <div
          className="h-full rounded-full bg-neutral-900 transition-all duration-300"
          style={{ width: `${Math.round((readyCount / readyTotal) * 100)}%` }}
        />
      </div>
      {errorMsg && (
        <div className="mb-2 border border-red-200 bg-red-50 px-3 py-2 rounded-lg flex items-start gap-2 text-xs text-red-800 shrink-0">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span>{errorMsg}</span>
        </div>
      )}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          await submitTicket(draft);
        }}
        className="flex-1 min-h-0 flex flex-col"
      >
        <div className="rounded-2xl border border-neutral-200 bg-white shadow-sm overflow-hidden flex-1 min-h-0 flex flex-col">
          <div className="grid grid-cols-1 lg:grid-cols-12 flex-1 min-h-0 overflow-hidden">
            <div className="lg:col-span-7 px-4 py-3 lg:border-r border-neutral-100 min-h-0 flex flex-col">
              <div className="flex items-center gap-2 mb-2.5 shrink-0">
                <span className="h-6 w-6 rounded-md bg-neutral-900 text-white text-[10px] font-bold flex items-center justify-center">
                  1
                </span>
                <h3 className="text-sm font-semibold text-neutral-900">Ticket details</h3>
              </div>
              <div className="space-y-2.5 flex-1 min-h-0 flex flex-col">
                <label className="block space-y-1 shrink-0">
                  <span className={`${fieldLabel} flex items-center gap-2`}>
                    Subject {req}
                    {aiHint}
                  </span>
                  <input
                    required
                    value={draft.subject}
                    onChange={(e) => setDraft((d) => ({ ...d, subject: e.target.value }))}
                    placeholder="Short summary of the issue"
                    className={fieldControl}
                  />
                </label>
                <label className="flex flex-col space-y-1 flex-1 min-h-0">
                  <span className={fieldLabel}>Description {req}</span>
                  <textarea
                    required
                    rows={3}
                    value={draft.description}
                    onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                    placeholder="What happened, and what should happen next"
                    className={`${fieldControl} h-full min-h-0 py-2 resize-none`}
                  />
                </label>
                <div className="space-y-1 shrink-0">
                  <span className={fieldLabel}>Channel {req}</span>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                    {channelChoices.map(({ value, label, Icon }) => {
                      const on = draft.channel === value;
                      return (
                        <button
                          key={value}
                          type="button"
                          onClick={() => setDraft((d) => ({ ...d, channel: value }))}
                          className={`flex items-center justify-center gap-1 rounded-lg border min-h-10 sm:h-8 text-[11px] font-semibold transition ${
                            on
                              ? 'border-neutral-900 bg-neutral-900 text-white'
                              : 'border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300'
                          }`}
                        >
                          <Icon className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate">{label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="space-y-1 shrink-0">
                  <span className={fieldLabel}>Priority {req}</span>
                  <div className="flex flex-wrap gap-1.5">
                    {priorityOptions.map((p) => {
                      const on = draft.priority === p.priority;
                      return (
                        <button
                          key={p.priority}
                          type="button"
                          data-on={on}
                          onClick={() =>
                            setDraft((d) => ({ ...d, priority: p.priority as Priority }))
                          }
                          className={`h-7 px-2.5 rounded-full border text-[11px] font-semibold transition ${priorityTone(
                            p.displayName || p.priority
                          )}`}
                        >
                          {p.displayName}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 shrink-0">
                  <label className="block space-y-1 min-w-0">
                    <span className={fieldLabel}>Team {req}</span>
                    <select
                      required={queueOptions.length > 0}
                      value={draft.queue}
                      onChange={(e) => setDraft((d) => ({ ...d, queue: e.target.value }))}
                      className={fieldControl}
                      disabled={queueOptions.length === 0}
                    >
                      <option value="" disabled>
                        {queueOptions.length === 0 ? 'No teams in MyAccount' : 'Select team'}
                      </option>
                      {queueOptions.map((q) => (
                        <option key={q} value={q}>
                          {q}
                        </option>
                      ))}
                    </select>
                    {queueOptions.length === 0 && (
                      <p className="text-[11px] text-amber-700">
                        No teams configured in MyAccount for this organization.
                      </p>
                    )}
                  </label>
                  <label className="block space-y-1 min-w-0">
                    <span className={fieldLabel}>Agent {req}</span>
                    <select
                      required
                      value={draft.assignee}
                      onChange={(e) => setDraft((d) => ({ ...d, assignee: e.target.value }))}
                      className={fieldControl}
                    >
                      <option value="" disabled>
                        Select agent
                      </option>
                      {!agentOptions.includes(draft.assignee) && draft.assignee && (
                        <option value={draft.assignee}>{draft.assignee}</option>
                      )}
                      {agentOptions.map((a) => (
                        <option key={a} value={a}>
                          {a}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="rounded-lg bg-neutral-50 border border-neutral-100 px-3 py-2 flex items-center justify-between gap-3 shrink-0">
                  <div className="min-w-0">
                    <p className={fieldLabel}>Resolver</p>
                    <p className="text-xs text-neutral-800 truncate">
                      {draft.resolver
                        ? `${draft.resolver}${
                            draft.resolverConfidence != null
                              ? ` · ${Number(draft.resolverConfidence).toFixed(2)}`
                              : ''
                          }`
                        : 'Unassigned — agent can pick later'}
                    </p>
                  </div>
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400 shrink-0">
                    Optional
                  </span>
                </div>
              </div>
            </div>

            <div className="lg:col-span-5 px-4 py-3 bg-neutral-50/70 flex flex-col gap-3 min-h-0 overflow-hidden">
              <div className="shrink-0">
                <div className="flex items-center gap-2 mb-2">
                  <span className="h-6 w-6 rounded-md bg-neutral-900 text-white text-[10px] font-bold flex items-center justify-center">
                    2
                  </span>
                  <h3 className="text-sm font-semibold text-neutral-900">Customer</h3>
                </div>
                {draft.customerId ? (
                  <div className="rounded-xl border border-emerald-200 bg-white px-3 py-2 flex items-center gap-2.5">
                    <span className="h-8 w-8 rounded-full bg-emerald-100 text-emerald-800 flex items-center justify-center shrink-0">
                      <User className="h-3.5 w-3.5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-neutral-900 truncate">
                        {draft.customerName}
                      </p>
                      <p className="text-[11px] text-neutral-500 truncate">
                        {draft.customerEmail || draft.customerPhone}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setCustomerQuery('');
                        setDraft((d) => ({
                          ...d,
                          customerId: '',
                          customerName: '',
                          customerEmail: '',
                          customerPhone: '',
                        }));
                      }}
                      className="text-neutral-400 hover:text-neutral-800"
                      aria-label="Clear customer"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ) : addingCustomer && canAddCustomer ? (
                  <div className="space-y-2 rounded-xl border border-neutral-200 bg-white p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold text-neutral-800">
                        New customer
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          setAddingCustomer(false);
                          setNewCustomer({ name: '', email: '', phone: '' });
                        }}
                        className="text-[11px] font-medium text-neutral-500 hover:text-neutral-800"
                      >
                        Cancel
                      </button>
                    </div>
                    <label className="block space-y-1">
                      <span className={fieldLabel}>Name {req}</span>
                      <input
                        value={newCustomer.name}
                        onChange={(e) =>
                          setNewCustomer((n) => ({ ...n, name: e.target.value }))
                        }
                        placeholder="Full name"
                        className={fieldControl}
                        autoComplete="off"
                      />
                    </label>
                    <label className="block space-y-1">
                      <span className={fieldLabel}>Email {req}</span>
                      <input
                        type="email"
                        value={newCustomer.email}
                        onChange={(e) =>
                          setNewCustomer((n) => ({ ...n, email: e.target.value }))
                        }
                        placeholder="name@example.com"
                        className={fieldControl}
                        autoComplete="off"
                      />
                    </label>
                    <label className="block space-y-1">
                      <span className={fieldLabel}>Phone {req}</span>
                      <input
                        value={newCustomer.phone}
                        onChange={(e) =>
                          setNewCustomer((n) => ({ ...n, phone: e.target.value }))
                        }
                        placeholder="+1…"
                        className={fieldControl}
                        autoComplete="off"
                      />
                    </label>
                    <button
                      type="button"
                      disabled={savingCustomer}
                      onClick={() => void saveNewCustomer()}
                      className="w-full rounded-lg bg-neutral-900 px-3 py-2 text-xs font-semibold text-white hover:bg-neutral-800 disabled:opacity-60"
                    >
                      {savingCustomer ? 'Saving…' : 'Save customer'}
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <label className="block space-y-1 relative">
                      <span className={fieldLabel}>Directory search {req}</span>
                      <span className="relative block">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-neutral-400" />
                        <input
                          required={!isCustomer}
                          value={customerQuery || draft.customerName}
                          onChange={(e) => {
                            const v = e.target.value;
                            setCustomerQuery(v);
                            setDraft((d) => ({ ...d, customerId: '', customerName: v }));
                            void searchCustomers(v);
                          }}
                          placeholder="Search name, email, or phone"
                          className={`${fieldControl} pl-9`}
                        />
                      </span>
                      {customerHits.length > 0 && (
                        <ul className="absolute z-10 left-0 right-0 top-full mt-1 bg-white border border-neutral-200 rounded-xl shadow-lg max-h-36 overflow-auto">
                          {customerHits.map((c) => (
                            <li key={c.id}>
                              <button
                                type="button"
                                onClick={() => applyCustomer(c)}
                                className="w-full text-left px-3 py-2 text-sm hover:bg-neutral-50"
                              >
                                <span className="font-semibold">{c.name}</span>
                                <span className="block text-xs text-neutral-500">
                                  {c.email || c.phone}
                                </span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </label>
                    {canAddCustomer && (
                      <button
                        type="button"
                        onClick={() => {
                          setAddingCustomer(true);
                          setCustomerHits([]);
                          setNewCustomer({
                            name: (customerQuery || draft.customerName || '').trim(),
                            email: '',
                            phone: '',
                          });
                        }}
                        className="text-[11px] font-semibold text-neutral-700 underline-offset-2 hover:underline"
                      >
                        Add new customer
                      </button>
                    )}
                  </div>
                )}
              </div>

              <div className="flex-1 flex flex-col min-h-0">
                <div className="flex items-center gap-2 mb-2 shrink-0">
                  <span className="h-6 w-6 rounded-md bg-neutral-900 text-white text-[10px] font-bold flex items-center justify-center">
                    3
                  </span>
                  <h3 className="text-sm font-semibold text-neutral-900">Attachments</h3>
                  <span className="text-[10px] font-medium uppercase tracking-wide text-neutral-400">
                    Optional
                  </span>
                </div>
                <label
                  onDragEnter={(e) => {
                    e.preventDefault();
                    setDragActive(true);
                  }}
                  onDragLeave={(e) => {
                    e.preventDefault();
                    setDragActive(false);
                  }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={async (e) => {
                    e.preventDefault();
                    setDragActive(false);
                    if (e.dataTransfer.files?.[0]) await uploadFiles(e.dataTransfer.files);
                  }}
                  className={`flex flex-1 min-h-0 flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed px-3 py-3 cursor-pointer transition ${
                    dragActive
                      ? 'border-neutral-900 bg-white'
                      : 'border-neutral-300 bg-white hover:border-neutral-400'
                  }`}
                >
                  <UploadCloud className="h-5 w-5 text-neutral-400" />
                  <span className="text-xs font-medium text-neutral-700">Drop files or click</span>
                  <input
                    type="file"
                    multiple
                    className="hidden"
                    onChange={async (e) => {
                      if (e.target.files?.[0]) await uploadFiles(e.target.files);
                    }}
                  />
                </label>
                {attachments.length > 0 && (
                  <ul className="mt-2 space-y-1 max-h-16 overflow-y-auto shrink-0">
                    {attachments.map((a, i) => (
                      <li
                        key={`${a}-${i}`}
                        className="flex items-center justify-between gap-2 rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-xs"
                      >
                        <span className="flex items-center gap-1.5 truncate">
                          <File className="h-3.5 w-3.5 text-neutral-400" />
                          <span className="truncate">{a}</span>
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setAttachments((prev) => prev.filter((_, idx) => idx !== i))
                          }
                          className="text-neutral-400 hover:text-rose-600"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-col-reverse sm:flex-row sm:items-center justify-between gap-2 border-t border-neutral-100 bg-white px-3 sm:px-4 py-2.5 shrink-0">
            <p className="text-xs text-neutral-500 truncate text-center sm:text-left">
              {canFile
                ? 'Ready to file.'
                : 'Complete the required fields, then file.'}
            </p>
            <button
              type="submit"
              disabled={!canFile}
              className="h-10 sm:h-9 w-full sm:w-auto sm:min-w-[140px] px-5 rounded-lg bg-neutral-950 text-white text-sm font-semibold hover:bg-neutral-800 disabled:opacity-50"
            >
              {submitting ? 'Filing…' : 'File ticket'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );

  if (presentation === 'full') {
    return (
      <PageShell id="create-ticket-form" fillHeight>
        {toast && (
          <div className="fixed bottom-5 right-5 z-[60] rounded-xl bg-neutral-950 text-white text-xs font-medium px-4 py-2.5 shadow-lg">
            {toast}
          </div>
        )}
        {formPanel}
      </PageShell>
    );
  }

  return (
    <>
      {toast && (
        <div className="fixed bottom-5 right-5 z-[60] rounded-xl bg-neutral-950 text-white text-xs font-medium px-4 py-2.5 shadow-lg">
          {toast}
        </div>
      )}
      <CoworkerSplitWorkspace
        pageLabel="Create Ticket"
        contentTitle={guided ? 'Next steps' : 'Tickets'}
        greetingOverride={
          guided
            ? isCustomer
              ? CUSTOMER_GREETING_FALLBACK
              : GREETING_FALLBACK
            : 'Greet as Worktual co-worker briefly. Help with ticket questions, metrics, or filing a new ticket when they ask to create one — do not start create-ticket until they clearly want to file.'
        }
        placeholder="e.g. Why is ticket volume high today?"
        suggestionChips={['create ticket', 'how many open tickets']}
        getChatContext={getChatContext}
        onUserMessage={handleChatMessage}
        onChatRestart={cancelDraft}
        module="tickets"
        surface="create"
        onDraftPatch={(patch) => {
          applyTicketDraftFromActions([{ type: 'create_ticket', ...patch }]);
        }}
        onChatActions={async (actions, meta) => {
          applyTicketDraftFromActions(actions);
          await onCoworkerChatActions?.(actions, meta);
        }}
        onAgentRoute={onAgentRoute}
        contentHeaderActions={
          <button
            type="button"
            onClick={openFullPage}
            className="inline-flex items-center h-8 px-2.5 rounded-lg border border-neutral-200 bg-white text-xs font-semibold text-neutral-800 hover:bg-neutral-50"
          >
            Use form
          </button>
        }
      >
        {guided ? (
          <GuidedTicketPreview
            draft={draft}
            stepIndex={stepIndex}
            submitting={submitting}
            enriching={enriching}
            onCancel={() => {
              cancelDraft();
              openSplit();
            }}
            onUseForm={openFullPage}
            onConfirmCreate={async () => {
              await submitTicket(draft);
            }}
          />
        ) : (
          <div className="p-6 text-center space-y-3 max-w-sm mx-auto">
            <p className="text-sm text-neutral-600">
              Ask about tickets in chat, or say <span className="font-semibold">create ticket</span> to
              open the guided steps.
            </p>
            <button
              type="button"
              onClick={() => {
                setGuided(true);
                setStepIndex(isCustomer ? 2 : 0);
                setDraft(emptyTicketDraft());
              }}
              className="h-9 px-3 rounded-xl bg-black text-white text-xs font-semibold"
            >
              Create ticket
            </button>
          </div>
        )}
      </CoworkerSplitWorkspace>
    </>
  );
}
