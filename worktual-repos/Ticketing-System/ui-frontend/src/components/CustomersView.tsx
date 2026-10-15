import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Users, Search, Mail, Phone, Calendar, AlertTriangle, Plus, Upload, CheckCircle2, ArrowLeft } from 'lucide-react';
import { Customer } from '../types';
import { useSetPageTitle } from './layout/PageTitleContext';
import PageShell from './layout/PageShell';
import { useReportFocusedEntity } from './coworker/CoworkerSessionContext';
import { useCoworkerPageBridge } from './coworker/CoworkerSplitWorkspace';
import {
  isGuidedCreateDone,
  pendingOpenFromAction,
  type PendingEntityOpen,
} from './coworker/coworkerActions';

const CUSTOMER_GUIDED_STEPS = [
  { id: 'name', title: 'Customer name', prompt: 'their full name' },
  { id: 'email', title: 'Email address', prompt: 'their email address' },
  { id: 'phone', title: 'Phone number', prompt: 'their phone number' },
  { id: 'confirm', title: 'Ready to add', prompt: 'tell me to add them, or change a field' },
] as const;

type CustomerGuidedStepId = (typeof CUSTOMER_GUIDED_STEPS)[number]['id'];

function normalizeCustomerStep(raw: string | undefined | null): CustomerGuidedStepId {
  const step = String(raw || 'name').trim().toLowerCase();
  if (step === 'contact') return 'email';
  if (step === 'email' || step === 'phone' || step === 'confirm') return step;
  return 'name';
}

function customerStepIndex(id: string | undefined | null): number {
  const mapped = normalizeCustomerStep(id);
  const idx = CUSTOMER_GUIDED_STEPS.findIndex((s) => s.id === mapped);
  return idx >= 0 ? idx : 0;
}

function GuidedCustomerPreview({
  draft,
  stepIndex,
  saving = false,
  complete = false,
  onCancel,
  onUseForm,
  onConfirmCreate,
}: {
  draft: { name: string; email: string; phone: string };
  stepIndex: number;
  saving?: boolean;
  complete?: boolean;
  onCancel: () => void;
  onUseForm?: () => void;
  onConfirmCreate?: () => void;
}) {
  const total = CUSTOMER_GUIDED_STEPS.length;
  const hasName = Boolean(draft.name.trim());
  const hasEmail = Boolean(draft.email.trim());
  const hasPhone = Boolean(draft.phone.trim());
  const filed = complete;
  let displayStep = stepIndex;
  if (filed) {
    displayStep = total;
  } else if (displayStep > 0 && !hasName) displayStep = 0;
  else if (displayStep > 1 && !hasEmail) displayStep = 1;
  else if (displayStep > 2 && !hasPhone) displayStep = 2;
  const pct = Math.min(100, Math.round((displayStep / total) * 100));
  const current = CUSTOMER_GUIDED_STEPS[Math.min(displayStep, total - 1)];
  const completed = (
    filed ? CUSTOMER_GUIDED_STEPS : CUSTOMER_GUIDED_STEPS.slice(0, displayStep)
  ).filter((s) => {
    if (filed) return true;
    if (s.id === 'name') return hasName;
    if (s.id === 'email') return hasEmail;
    if (s.id === 'phone') return hasPhone;
    return true;
  });
  const pending = filed ? [] : CUSTOMER_GUIDED_STEPS.slice(displayStep + 1);
  const label = draft.name.trim() || 'New customer';
  const canSave = hasName && hasEmail && hasPhone;

  return (
    <div className="h-full min-h-0 flex flex-col border border-neutral-200 bg-white rounded-2xl shadow-sm overflow-hidden">
      <div className="px-4 py-4 border-b border-neutral-100 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-medium uppercase tracking-wide text-neutral-400">
              Creating with co-worker
            </p>
            <h3 className="text-base font-semibold text-neutral-900 truncate">{label}</h3>
            {draft.email ? (
              <p className="text-xs text-neutral-500 mt-0.5 truncate">{draft.email}</p>
            ) : null}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {onUseForm && (
              <button
                type="button"
                onClick={onUseForm}
                className="text-xs font-semibold text-neutral-700 hover:text-black underline-offset-2 hover:underline"
              >
                Use form
              </button>
            )}
            <button
              type="button"
              onClick={onCancel}
              className="text-xs font-medium text-neutral-500 hover:text-neutral-900"
            >
              Cancel
            </button>
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between text-[11px] text-neutral-500 mb-1.5">
            <span>
              {filed
                ? `Step ${total} of ${total}`
                : `Step ${Math.min(displayStep + 1, total)} of ${total}`}
            </span>
            <span className="tabular-nums">{pct}%</span>
          </div>
          <div className="h-2 rounded-full bg-neutral-100 overflow-hidden">
            <div className="h-full bg-black transition-all duration-300" style={{ width: `${pct}%` }} />
          </div>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-5">
        <section className="space-y-2">
          <p className="text-[10px] font-medium uppercase tracking-wide text-neutral-400">
            {filed ? 'Added' : 'Up next'}
          </p>
          {!filed && (
          <div className="rounded-xl border border-neutral-200 bg-neutral-50/80 p-4">
            <p className="text-sm font-semibold text-neutral-900">{current.title}</p>
            <p className="text-xs text-neutral-500 mt-1 leading-relaxed">
              Next in chat: {current.prompt}
            </p>
            {current.id === 'confirm' && (
              <div className="mt-3 space-y-3">
                <dl className="text-xs space-y-1.5 text-neutral-600">
                  <div className="flex gap-2">
                    <dt className="w-20 shrink-0 text-neutral-400">Name</dt>
                    <dd className="font-medium text-neutral-900">{draft.name || '—'}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-20 shrink-0 text-neutral-400">Email</dt>
                    <dd className="font-medium text-neutral-900">{draft.email || '—'}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-20 shrink-0 text-neutral-400">Phone</dt>
                    <dd className="font-medium text-neutral-900">{draft.phone || '—'}</dd>
                  </div>
                </dl>
                {onConfirmCreate && (
                  <button
                    type="button"
                    disabled={saving || !canSave}
                    onClick={onConfirmCreate}
                    className="h-9 px-3 rounded-xl bg-black text-white text-xs font-semibold hover:bg-neutral-800 disabled:opacity-50"
                  >
                    {saving ? 'Saving…' : 'Save customer'}
                  </button>
                )}
              </div>
            )}
          </div>
          )}
          {!filed && pending.length > 0 && (
            <ul className="space-y-1.5 pt-1">
              {pending.map((s) => (
                <li
                  key={s.id}
                  className="text-xs text-neutral-400 px-3 py-2 rounded-lg border border-dashed border-neutral-200"
                >
                  {s.title}
                </li>
              ))}
            </ul>
          )}
        </section>
        {completed.length > 0 && (
          <section className="space-y-2">
            <p className="text-[10px] font-medium uppercase tracking-wide text-neutral-400">
              Completed
            </p>
            <ul className="space-y-2">
              {completed.map((s) => (
                <li
                  key={s.id}
                  className="flex items-start gap-2 rounded-lg border border-neutral-100 bg-white px-3 py-2"
                >
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-neutral-900" />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-neutral-800">{s.title}</p>
                    <p className="text-[11px] text-neutral-500 truncate">
                      {s.id === 'name'
                        ? draft.name
                        : s.id === 'email'
                          ? draft.email
                          : s.id === 'phone'
                            ? draft.phone
                            : ''}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}

export default function CustomersView({
  externalSearchQuery,
  externalStatusFilter,
  embedded = false,
  canMutate = false,
  startCreateIntent = false,
  startCreateSeed = null,
  onConsumeCreateIntent,
  listRefreshToken = 0,
}: {
  canMutate?: boolean;
  externalSearchQuery?: string;
  /** Active | Inactive — from co-worker filter actions. */
  externalStatusFilter?: string;
  embedded?: boolean;
  startCreateIntent?: boolean;
  startCreateSeed?: {
    step?: string;
    name?: string;
    email?: string;
    phone?: string;
  } | null;
  onConsumeCreateIntent?: () => void;
  listRefreshToken?: number;
}) {
  useSetPageTitle('Customers');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [showAdd, setShowAdd] = useState(false);
  const [guided, setGuided] = useState(false);
  const [guidedStepIndex, setGuidedStepIndex] = useState(0);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [formMsg, setFormMsg] = useState('');
  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    accountName: '',
    externalId: '',
  });
  const [businessType, setBusinessType] = useState<'b2b' | 'b2c'>('b2c');
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const selectedCustomer = customers.find((c) => c.id === selectedCustomerId) || null;
  const pendingOpenCustomerRef = useRef<PendingEntityOpen | null>(null);
  const pageBridge = useCoworkerPageBridge();

  const resolveOpenCustomer = useCallback(
    (rows: Customer[], pending: PendingEntityOpen | null) => {
      if (!pending) return;
      const byId = pending.id ? rows.find((c) => c.id === pending.id) : undefined;
      const needle = String(pending.title || pending.name || '')
        .trim()
        .toLowerCase();
      const byName = needle
        ? rows.find((c) => String(c.name || '').trim().toLowerCase() === needle)
        : undefined;
      const byEmail = pending.email
        ? rows.find(
            (c) =>
              String(c.email || '').trim().toLowerCase() ===
              pending.email!.trim().toLowerCase()
          )
        : undefined;
      const hit = byId || byName || byEmail;
      if (hit?.id) setSelectedCustomerId(hit.id);
      else if (needle) setSearchQuery(String(pending.title || pending.name || ''));
    },
    []
  );
  useReportFocusedEntity(
    selectedCustomer
      ? { type: 'customer', id: selectedCustomer.id, name: selectedCustomer.name }
      : null
  );

  useEffect(() => {
    if (externalSearchQuery !== undefined) setSearchQuery(externalSearchQuery);
  }, [externalSearchQuery]);

  useEffect(() => {
    if (!startCreateIntent) return;
    onConsumeCreateIntent?.();
    if (!canMutate) return;
    setShowAdd(false);
    setGuided(true);
    setGuidedStepIndex(customerStepIndex(startCreateSeed?.step || 'name'));
    setForm((f) => ({
      ...f,
      name: String(startCreateSeed?.name || f.name || '').trim() || f.name,
      email: String(startCreateSeed?.email || f.email || '').trim() || f.email,
      phone: String(startCreateSeed?.phone || f.phone || '').trim() || f.phone,
    }));
  }, [startCreateIntent, startCreateSeed, canMutate, onConsumeCreateIntent]);

  const fetchCustomers = useCallback(async (q?: string) => {
    try {
      const query = (q ?? searchQuery).trim();
      const qs = query ? `?q=${encodeURIComponent(query)}` : '';
      const res = await fetch(`/api/customers${qs}`, { credentials: 'include' });
      const data = await res.json();
      const rows = Array.isArray(data) ? data : [];
      setCustomers(rows);
      const pending = pendingOpenCustomerRef.current;
      if (pending) {
        pendingOpenCustomerRef.current = null;
        resolveOpenCustomer(rows, pending);
      }
      return rows;
    } catch (err) {
      console.error('Failed to load customers directory', err);
      return [];
    } finally {
      setLoading(false);
    }
  }, [resolveOpenCustomer, searchQuery]);

  const applyCustomerChatActions = useCallback(
    (actions: Record<string, unknown>[]) => {
      for (const raw of actions) {
        const type = String(raw.type || '').trim().toLowerCase();
        if (type === 'open_customer') {
          const pending = pendingOpenFromAction(raw);
          if (pending) {
            pendingOpenCustomerRef.current = pending;
            void fetchCustomers();
          }
          setGuided(false);
          setShowAdd(false);
          continue;
        }
        if (type !== 'create_customer') continue;
        const done = isGuidedCreateDone(raw);
        const step = String(raw.step || raw.awaiting || '')
          .trim()
          .toLowerCase();
        const seed = String(raw.name || raw.customerName || '').trim();
        if (done) {
          const pending = pendingOpenFromAction(raw);
          if (pending) pendingOpenCustomerRef.current = pending;
          setGuided(false);
          setShowAdd(false);
          void fetchCustomers();
          continue;
        }
        if (!canMutate) continue;
        setShowAdd(false);
        setGuided(true);
        setSelectedCustomerId(null);
        if (step) setGuidedStepIndex(customerStepIndex(step));
        setForm((f) => ({
          ...f,
          name: seed || String(raw.name || raw.customerName || f.name || ''),
          email: String(raw.email || raw.customerEmail || f.email || ''),
          phone: String(raw.phone || raw.customerPhone || f.phone || ''),
        }));
      }
    },
    [canMutate, fetchCustomers]
  );

  useEffect(() => {
    if (!pageBridge) return;
    pageBridge.setPageHandlers({
      module: 'customers',
      surface: guided || showAdd ? 'create' : selectedCustomerId ? 'detail' : 'list',
      getChatContext: () => ({
        module: 'customers',
        surface: guided || showAdd ? 'create' : selectedCustomerId ? 'detail' : 'list',
        entityId: selectedCustomerId,
        draft:
          guided || showAdd
            ? {
                awaiting: !form.name.trim()
                  ? 'name'
                  : !form.email.trim()
                    ? 'email'
                    : !form.phone.trim()
                      ? 'phone'
                      : 'confirm',
                name: form.name || undefined,
                email: form.email || undefined,
                phone: form.phone || undefined,
                customerName: form.name || undefined,
                customerEmail: form.email || undefined,
                customerPhone: form.phone || undefined,
              }
            : null,
      }),
      onChatActions: async (actions) => {
        applyCustomerChatActions(actions);
      },
      onDraftPatch: (patch) => {
        if (!canMutate) return;
        const foreign =
          patch.title != null ||
          patch.category != null ||
          patch.body != null ||
          patch.content != null ||
          patch.displayName != null ||
          patch.resolutionHours != null ||
          patch.issue != null ||
          patch.members != null;
        if (foreign) return;
        if (patch.done || patch.refresh) {
          setGuided(false);
          setShowAdd(false);
          const cid = String(patch.id || patch.customerId || '').trim();
          if (cid) setSelectedCustomerId(cid);
          return;
        }
        const hasCustomerField =
          patch.customerName != null ||
          patch.name != null ||
          patch.customerEmail != null ||
          patch.email != null ||
          patch.phone != null ||
          patch.awaiting != null ||
          patch.step != null;
        if (!showAdd && !guided && !hasCustomerField) return;
        setShowAdd(false);
        setGuided(true);
        const step = String(patch.step || patch.awaiting || '').trim().toLowerCase();
        if (step) setGuidedStepIndex(customerStepIndex(step));
        setForm((f) => ({
          ...f,
          name: String(patch.name || patch.customerName || f.name || ''),
          email: String(patch.email || patch.customerEmail || f.email || ''),
          phone: String(patch.phone || patch.customerPhone || f.phone || ''),
        }));
      },
    });
    return () => pageBridge.setPageHandlers(null);
  }, [pageBridge, showAdd, guided, selectedCustomerId, form, canMutate, applyCustomerChatActions]);

  useEffect(() => {
    if (!listRefreshToken) return;
    void fetchCustomers();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh token from chat create
  }, [listRefreshToken]);

  useEffect(() => {
    if (externalStatusFilter) {
      setStatusFilter(externalStatusFilter);
    } else if (externalStatusFilter === '') {
      setStatusFilter('All');
    }
  }, [externalStatusFilter]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      void fetchCustomers(searchQuery);
    }, searchQuery.trim() ? 250 : 0);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refetch when the search box changes
  }, [searchQuery]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/org-branding', { credentials: 'include' });
        if (!res.ok) return;
        const data = await res.json();
        if (data.businessType === 'b2b') setBusinessType('b2b');
      } catch {
        /* ignore */
      }
    })();
  }, []);

  const saveCustomer = async () => {
    setSaving(true);
    setFormError('');
    setFormMsg('');
    try {
      const res = await fetch('/api/customers', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          email: form.email,
          phone: form.phone,
          accountName: form.accountName,
          externalId: form.externalId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFormError(data.error || 'Could not add customer.');
        if (res.status === 409) {
          const existing = data.customer && typeof data.customer === 'object' ? data.customer : null;
          const lookup =
            data.conflict === 'phone'
              ? form.phone.trim() || existing?.phone || form.email.trim()
              : form.email.trim() || existing?.email || form.phone.trim();
          if (existing?.id) {
            setCustomers([existing]);
          }
          if (lookup) {
            setSearchQuery(lookup);
            if (!existing?.id) await fetchCustomers(lookup);
          }
        }
        return;
      }
      setFormMsg('Customer added.');
      setForm({ name: '', email: '', phone: '', accountName: '', externalId: '' });
      setShowAdd(false);
      setGuided(false);
      await fetchCustomers();
    } catch {
      setFormError('Could not add customer.');
    } finally {
      setSaving(false);
    }
  };

  const submitAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    await saveCustomer();
  };

  const fileToBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result || "");
        const comma = result.indexOf(",");
        resolve(comma >= 0 ? result.slice(comma + 1) : result);
      };
      reader.onerror = () => reject(reader.error || new Error("read failed"));
      reader.readAsDataURL(file);
    });

  const importOneFile = async (file: File) => {
    const name = String(file.name || "").toLowerCase();
    const isExcel = name.endsWith(".xlsx") || name.endsWith(".xls");
    const body: Record<string, string> = { filename: file.name };
    if (isExcel) {
      body.contentBase64 = await fileToBase64(file);
    } else {
      body.csv = await file.text();
    }
    const res = await fetch('/api/customers/import', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `Import failed for ${file.name}`);
    }
    return {
      created: Number(data.created || 0),
      errors: Array.isArray(data.errors) ? data.errors.length : 0,
      fileName: file.name,
    };
  };

  const importFiles = async (files: FileList | File[]) => {
    setFormError('');
    setFormMsg('');
    const list = Array.from(files || []).filter(Boolean);
    if (!list.length) return;
    let createdTotal = 0;
    let errorTotal = 0;
    const fileErrors: string[] = [];
    for (const file of list) {
      try {
        const r = await importOneFile(file);
        createdTotal += r.created;
        errorTotal += r.errors;
      } catch (err) {
        fileErrors.push(err instanceof Error ? err.message : `Failed: ${file.name}`);
      }
    }
    if (fileErrors.length && !createdTotal) {
      setFormError(fileErrors.join(' '));
      return;
    }
    const parts = [
      `Imported ${createdTotal} customer(s) from ${list.length} file(s)`,
    ];
    if (errorTotal) parts.push(`${errorTotal} row(s) skipped`);
    if (fileErrors.length) parts.push(`${fileErrors.length} file(s) failed`);
    setFormMsg(`${parts.join('; ')}.`);
    if (fileErrors.length) setFormError(fileErrors.join(' '));
    await fetchCustomers();
  };

  const filteredCustomers = customers.filter((c) => {
    const matchesStatus = statusFilter === 'All' || c.status === statusFilter;
    const q = searchQuery.trim().toLowerCase();
    const qDigits = searchQuery.replace(/\D/g, '');
    const phoneDigits = String(c.phone || '').replace(/\D/g, '');
    const matchesSearch =
      q === '' ||
      String(c.name || '').toLowerCase().includes(q) ||
      String(c.email || '').toLowerCase().includes(q) ||
      String(c.phone || '').toLowerCase().includes(q) ||
      (qDigits.length >= 7 && phoneDigits.includes(qDigits));
    return matchesStatus && matchesSearch;
  });

  return (
    <PageShell
      id="customers-view-container"
      embedded={embedded}
      actions={
        canMutate ? (
          <div className="flex items-center gap-2">
            <label className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-neutral-200 bg-white text-xs font-medium cursor-pointer">
              <Upload className="h-3.5 w-3.5" />
              Import
              <input
                type="file"
                multiple
                accept=".csv,.tsv,.xls,.xlsx,text/csv,text/tab-separated-values"
                className="hidden"
                onChange={(e) => {
                  const files = e.target.files;
                  if (files?.length) void importFiles(files);
                  e.target.value = '';
                }}
              />
            </label>
            <button
              type="button"
              onClick={() => {
                setGuided(false);
                setShowAdd((v) => !v);
              }}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-neutral-950 text-white text-xs font-semibold"
            >
              <Plus className="h-3.5 w-3.5" />
              Add customer
            </button>
          </div>
        ) : (
          <p className="text-sm text-neutral-500">
            Search the customer directory. Only admins can add or import customers.
          </p>
        )
      }
    >
      <div className="space-y-6">
        <p className="text-xs rounded-xl px-3 py-2 border text-neutral-700 bg-neutral-50 border-neutral-200">
          Tickets can only be filed for customers already in this directory. Add or import
          customers (CSV, TSV, or Excel) here before creating a ticket.
        </p>
        {(formError || formMsg) && (
          <p className={`text-xs rounded-xl px-3 py-2 border ${formError ? 'text-amber-800 bg-amber-50 border-amber-200' : 'text-emerald-700 bg-emerald-50 border-emerald-200'}`}>
            {formError || formMsg}
          </p>
        )}
        {guided && canMutate ? (
          <GuidedCustomerPreview
            draft={{ name: form.name, email: form.email, phone: form.phone }}
            stepIndex={guidedStepIndex}
            saving={saving}
            onCancel={() => {
              setGuided(false);
              setGuidedStepIndex(0);
            }}
            onUseForm={() => {
              setGuided(false);
              setShowAdd(true);
            }}
            onConfirmCreate={() => {
              void saveCustomer();
            }}
          />
        ) : selectedCustomer && !showAdd ? (
          <div className="rounded-2xl border border-neutral-200 bg-white shadow-sm overflow-hidden">
            <div className="px-4 py-4 border-b border-neutral-100 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setSelectedCustomerId(null)}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-neutral-600 hover:text-neutral-900"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Back to directory
              </button>
            </div>
            <div className="px-5 py-5 space-y-4">
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wide text-neutral-400">
                  Customer
                </p>
                <h3 className="text-lg font-semibold text-neutral-900">{selectedCustomer.name}</h3>
              </div>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div className="rounded-xl border border-neutral-200 px-3 py-2.5">
                  <dt className="text-neutral-400">Email</dt>
                  <dd className="font-medium text-neutral-900 mt-0.5">{selectedCustomer.email || '—'}</dd>
                </div>
                <div className="rounded-xl border border-neutral-200 px-3 py-2.5">
                  <dt className="text-neutral-400">Phone</dt>
                  <dd className="font-medium text-neutral-900 mt-0.5">{selectedCustomer.phone || '—'}</dd>
                </div>
                <div className="rounded-xl border border-neutral-200 px-3 py-2.5">
                  <dt className="text-neutral-400">Status</dt>
                  <dd className="font-medium text-neutral-900 mt-0.5">{selectedCustomer.status}</dd>
                </div>
                <div className="rounded-xl border border-neutral-200 px-3 py-2.5">
                  <dt className="text-neutral-400">Filed tickets</dt>
                  <dd className="font-medium text-neutral-900 mt-0.5">{selectedCustomer.totalTickets}</dd>
                </div>
              </dl>
            </div>
          </div>
        ) : (
          <>
        {showAdd && canMutate && (
          <form onSubmit={submitAdd} className="border border-neutral-200 bg-white p-4 rounded-2xl shadow-sm grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            <label className="space-y-1">
              <span className="text-[10px] font-bold uppercase text-neutral-500">Name *</span>
              <input required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="w-full h-9 rounded-lg border border-neutral-200 px-3" />
            </label>
            <label className="space-y-1">
              <span className="text-[10px] font-bold uppercase text-neutral-500">Email</span>
              <input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} className="w-full h-9 rounded-lg border border-neutral-200 px-3" />
            </label>
            <label className="space-y-1">
              <span className="text-[10px] font-bold uppercase text-neutral-500">Phone</span>
              <input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} className="w-full h-9 rounded-lg border border-neutral-200 px-3" />
            </label>
            {businessType === 'b2b' && (
              <label className="space-y-1">
                <span className="text-[10px] font-bold uppercase text-neutral-500">Account / company</span>
                <input value={form.accountName} onChange={(e) => setForm((f) => ({ ...f, accountName: e.target.value }))} className="w-full h-9 rounded-lg border border-neutral-200 px-3" />
              </label>
            )}
            <div className="md:col-span-2 flex justify-end gap-2">
              <button type="button" onClick={() => setShowAdd(false)} className="h-9 px-3 rounded-lg border border-neutral-200">Cancel</button>
              <button type="submit" disabled={saving} className="h-9 px-4 rounded-lg bg-neutral-950 text-white font-semibold disabled:opacity-40">
                {saving ? 'Saving…' : 'Save customer'}
              </button>
            </div>
            <p className="md:col-span-2 text-[11px] text-neutral-400">
              Import CSV, TSV, or Excel (.xlsx). Columns: name, email, phone, external_id, account.
              Email or phone required. Portal emails are sent only for OTP or password reset, not when adding a customer.
            </p>
          </form>
        )}
        <div className="border border-neutral-200 bg-white p-4 rounded-2xl shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4 font-sans text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-neutral-400 w-full sm:w-auto">Account Status:</span>
            {['All', 'Active', 'Inactive'].map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => setStatusFilter(st)}
                className={`px-3.5 py-1.5 border text-xs font-medium rounded-full transition-all cursor-pointer ${
                  statusFilter === st
                    ? 'bg-neutral-950 text-white border-neutral-950 font-semibold'
                    : 'bg-white border-neutral-200 text-neutral-500 hover:border-neutral-400'
                }`}
              >
                {st}
              </button>
            ))}
          </div>

          <div className="relative w-full md:w-64">
            <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-neutral-400" />
            <input
              type="text"
              placeholder="Search database clients..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-white border border-neutral-200 py-2 pl-9 pr-3 text-xs placeholder-neutral-400 focus:outline-none focus:border-neutral-400 rounded-lg text-black transition-all shadow-sm"
            />
          </div>
        </div>

        <div className="border border-neutral-200 rounded-2xl overflow-hidden bg-white shadow-sm">
          {loading ? (
            <div className="p-12 text-center text-neutral-400 font-mono">
              Reading directory indexes...
            </div>
          ) : (
            <div>
              {/* Mobile / tablet cards */}
              <div className="md:hidden divide-y divide-neutral-100">
                {filteredCustomers.length > 0 ? (
                  filteredCustomers.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className="w-full text-left px-4 py-3.5 hover:bg-neutral-50/70 transition-colors"
                      onClick={() => setSelectedCustomerId(c.id)}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-neutral-900 truncate">{c.name}</p>
                          <p className="mt-0.5 text-[11px] font-mono text-neutral-600 truncate">{c.email}</p>
                          {c.phone ? (
                            <p className="mt-0.5 text-[11px] font-mono text-neutral-500">{c.phone}</p>
                          ) : null}
                        </div>
                        <div className="shrink-0 text-right space-y-1">
                          {c.status === 'Active' ? (
                            <span className="inline-flex items-center px-2 py-0.5 text-[10px] font-medium rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200/60">
                              Active
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 text-[10px] font-medium rounded-full bg-neutral-50 text-neutral-500 border border-neutral-200/60">
                              Inactive
                            </span>
                          )}
                          <p className="text-[10px] text-neutral-500 tabular-nums">
                            {c.totalTickets} tickets
                          </p>
                        </div>
                      </div>
                    </button>
                  ))
                ) : (
                  <div className="py-12 px-4 text-center text-neutral-400">
                    <AlertTriangle className="h-6 w-6 text-neutral-400 mx-auto mb-2" />
                    <span className="text-xs">No client entries found matching specifications.</span>
                  </div>
                )}
              </div>
              <div className="hidden md:block overflow-x-auto">
              <table
                id="customers-table"
                className="w-full text-left border-collapse font-sans text-xs"
              >
                <thead>
                  <tr className="border-b border-neutral-200 bg-neutral-50 font-sans text-[11px] font-bold uppercase text-neutral-500 tracking-wider">
                    <th className="py-3.5 px-5">Client Name</th>
                    <th className="py-3.5 px-4">Email</th>
                    <th className="py-3.5 px-4 w-44">Phone</th>
                    <th className="py-3.5 px-4 w-28 text-center">Filed Tickets</th>
                    <th className="py-3.5 px-4 w-32 text-center">Status</th>
                    <th className="py-3.5 px-5 w-36 text-right">Registered</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {filteredCustomers.length > 0 ? (
                    filteredCustomers.map((c) => (
                      <tr
                        key={c.id}
                        className="hover:bg-neutral-50/70 transition-all select-text cursor-pointer"
                        onClick={() => setSelectedCustomerId(c.id)}
                      >
                        <td className="py-4 px-5 font-semibold text-neutral-900">
                          <div className="flex items-center space-x-3">
                            <Users className="h-4 w-4 text-neutral-400 shrink-0" />
                            <span>{c.name}</span>
                          </div>
                        </td>
                        <td className="py-4 px-4 font-mono text-neutral-600">
                          <span className="flex items-center space-x-2">
                            <Mail className="h-4 w-4 text-neutral-400 shrink-0" />
                            <span>{c.email}</span>
                          </span>
                        </td>
                        <td className="py-4 px-4 font-mono text-neutral-500">
                          {c.phone ? (
                            <span className="flex items-center space-x-2">
                              <Phone className="h-4 w-4 text-neutral-400 shrink-0" />
                              <span>{c.phone}</span>
                            </span>
                          ) : (
                            <span className="text-neutral-300 italic">N/A</span>
                          )}
                        </td>
                        <td className="py-4 px-4 text-center font-bold text-neutral-900">
                          {c.totalTickets}
                        </td>
                        <td className="py-4 px-4 text-center select-none">
                          {c.status === 'Active' ? (
                            <span className="inline-flex items-center px-2.5 py-0.5 text-xs font-medium rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200/60">
                              Active
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2.5 py-0.5 text-xs font-medium rounded-full bg-neutral-50 text-neutral-500 border border-neutral-200/60">
                              Inactive
                            </span>
                          )}
                        </td>
                        <td className="py-4 px-5 text-right text-neutral-400 text-[11px] font-mono">
                          <span className="flex items-center justify-end space-x-2">
                            <Calendar className="h-3.5 w-3.5 text-neutral-400" />
                            <span>{c.createdAt}</span>
                          </span>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={6} className="py-12 text-center text-neutral-400">
                        <div className="flex flex-col items-center justify-center space-y-2">
                          <AlertTriangle className="h-6 w-6 text-neutral-400" />
                          <span>No client entries found matching specifications.</span>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              </div>
            </div>
          )}
        </div>
          </>
        )}
      </div>
    </PageShell>
  );
}
