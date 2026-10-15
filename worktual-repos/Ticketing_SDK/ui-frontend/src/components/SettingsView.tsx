import React, { useCallback, useEffect, useState } from 'react';
import {
  User,
  Shield,
  Monitor,
  Bell,
  Clock,
  Pencil,
  Check,
  RefreshCw,
  Eye,
  EyeOff,
} from 'lucide-react';
import { AuthUser } from '../types';
import { useSetPageTitle } from './layout/PageTitleContext';
import { roleDisplayLabel, settingsSectionsForRole } from '../rbac';

interface SettingsViewProps {
  currentUser: AuthUser;
  onLogout?: () => void;
  onUserUpdate?: (user: AuthUser) => void;
}

type Toast = { type: 'ok' | 'warn'; text: string } | null;

interface AccountPayload {
  profile: {
    id: string;
    name: string;
    email: string;
    initials: string;
    phone: string;
    role: string;
    status: string;
    organizationId: string;
    organizationName: string;
    access: string;
    lastLoginLabel: string;
    passwordChangedLabel: string;
    twoFactorEnabled: boolean;
  };
  notifications: {
    ticketAssignments: boolean;
    ticketUpdates: boolean;
    securityAlerts: boolean;
    slaAlerts: boolean;
    productUpdates: boolean;
  };
  sessions: Array<{
    id: string;
    title: string;
    meta: string;
    lastActive: string;
    current: boolean;
  }>;
  loginActivity: Array<{
    id: string;
    when: string;
    detail: string;
    current: boolean;
  }>;
}

function Card({
  title,
  icon,
  action,
  children,
  footer,
  className = '',
  bodyClassName = '',
}: {
  title: string;
  icon: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section
      className={`flex min-h-[280px] max-h-[360px] flex-col rounded-xl border-[0.6px] border-[#bfbfbf] bg-white p-5 shadow-none ${className}`}
    >
      <div className="flex items-center justify-between gap-3 mb-4 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-neutral-500 shrink-0">{icon}</span>
          <h2 className="text-sm font-semibold text-neutral-900 truncate">{title}</h2>
        </div>
        {action}
      </div>
      <div className={`flex-1 min-h-0 flex flex-col ${bodyClassName}`}>{children}</div>
      {footer ? <div className="mt-4 shrink-0">{footer}</div> : null}
    </section>
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-[#e5e5e5] py-2 last:border-0">
      <dt className="text-[11px] text-neutral-500 shrink-0 pt-0.5">{label}</dt>
      <dd className="text-xs font-medium text-neutral-900 text-right min-w-0">{children}</dd>
    </div>
  );
}

function PasswordInput({
  placeholder,
  value,
  onChange,
  autoComplete,
}: {
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <input
        type={visible ? 'text' : 'password'}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        className="w-full rounded-lg border border-neutral-200 py-2 pl-3 pr-9 text-xs focus:border-neutral-900 focus:outline-none"
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-0.5 text-neutral-400 hover:text-neutral-700"
        aria-label={visible ? 'Hide password' : 'Show password'}
      >
        {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

export default function SettingsView({
  currentUser,
  onLogout,
  onUserUpdate,
}: SettingsViewProps) {
  useSetPageTitle('Account');
  const [account, setAccount] = useState<AccountPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [editingProfile, setEditingProfile] = useState(false);
  const [fullName, setFullName] = useState(currentUser.name);
  const [phone, setPhone] = useState('');
  const [toast, setToast] = useState<Toast>(null);
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [passwordForm, setPasswordForm] = useState({
    current: '',
    next: '',
    confirm: '',
  });
  const [notifications, setNotifications] = useState<AccountPayload['notifications'] | null>(
    null
  );
  const flash = (type: 'ok' | 'warn', text: string) => {
    setToast({ type, text });
    window.setTimeout(() => setToast(null), 3000);
  };

  const applyAccount = useCallback((data: AccountPayload) => {
    setAccount(data);
    setFullName(data.profile.name);
    setPhone(data.profile.phone || '');
    setNotifications(data.notifications);
  }, []);

  const loadAccount = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/account', { credentials: 'include' });
      if (res.status === 401) {
        onLogout?.();
        return;
      }
      if (!res.ok) throw new Error('Failed to load account');
      const data = (await res.json()) as AccountPayload;
      applyAccount(data);
    } catch (err) {
      console.error(err);
      flash('warn', 'Could not load account data from the database.');
    } finally {
      setLoading(false);
    }
  }, [applyAccount, onLogout]);

  useEffect(() => {
    loadAccount();
  }, [loadAccount]);

  const sections = settingsSectionsForRole(currentUser.role);
  const showSection = (s: string) => sections.includes(s as (typeof sections)[number]);

  const roleLabel = roleDisplayLabel(account?.profile.role || currentUser.role);

  const isSaving = (key: string) => savingKey === key;

  const saveProfile = async () => {
    setSavingKey('profile');
    try {
      const res = await fetch('/api/account/profile', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: fullName, phone }),
      });
      const data = await res.json();
      if (!res.ok) {
        flash('warn', data.error || 'Failed to save profile');
        return;
      }
      if (data.user) onUserUpdate?.(data.user);
      if (data.account) applyAccount(data.account);
      setEditingProfile(false);
      flash('ok', 'Profile saved.');
    } catch {
      flash('warn', 'Unable to reach the server.');
    } finally {
      setSavingKey(null);
    }
  };

  const savePassword = async () => {
    if (!passwordForm.current || !passwordForm.next) {
      flash('warn', 'Enter your current and new password.');
      return;
    }
    if (passwordForm.next !== passwordForm.confirm) {
      flash('warn', 'New passwords do not match.');
      return;
    }
    setSavingKey('password');
    try {
      const res = await fetch('/api/account/password', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword: passwordForm.current,
          newPassword: passwordForm.next,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        flash('warn', data.error || 'Password update failed');
        return;
      }
      setPasswordForm({ current: '', next: '', confirm: '' });
      setShowPasswordForm(false);
      await loadAccount();
      flash('ok', 'Password updated.');
    } catch {
      flash('warn', 'Unable to reach the server.');
    } finally {
      setSavingKey(null);
    }
  };

  const saveNotifications = async (e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    if (!notifications) return;
    setSavingKey('notifications');
    try {
      const res = await fetch('/api/account/notifications', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(notifications),
      });
      const data = await res.json();
      if (!res.ok) {
        flash('warn', data.error || 'Failed to save notifications');
        return;
      }
      if (data.account?.notifications) {
        setNotifications(data.account.notifications);
        setAccount(data.account);
      }
      flash('ok', 'Notification preferences saved. Delivery will follow these settings.');
    } catch {
      flash('warn', 'Unable to reach the server.');
    } finally {
      setSavingKey(null);
    }
  };

  const signOutSession = async (id: string) => {
    setSavingKey(`session:${id}`);
    try {
      const res = await fetch(`/api/account/sessions/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok) {
        flash('warn', data.error || 'Failed to sign out session');
        return;
      }
      if (data.account) applyAccount(data.account);
      flash('ok', 'Session revoked.');
    } catch {
      flash('warn', 'Unable to reach the server.');
    } finally {
      setSavingKey(null);
    }
  };

  const signOutAll = async () => {
    setSavingKey('signout-all');
    try {
      const res = await fetch('/api/account/sessions/revoke-all', {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) {
        const data = await res.json();
        flash('warn', data.error || 'Failed to revoke sessions');
        return;
      }
      flash('ok', 'All sessions revoked.');
      onLogout?.();
    } catch {
      flash('warn', 'Unable to reach the server.');
    } finally {
      setSavingKey(null);
    }
  };

  if (loading && !account) {
    return (
      <div
        id="settings-view-container"
        className="h-full min-h-0 flex items-center justify-center text-xs text-neutral-500 font-sans bg-[#f3f4f6]"
      >
        <div className="flex items-center gap-2">
          <RefreshCw className="h-4 w-4 animate-spin" />
          Loading account…
        </div>
      </div>
    );
  }

  const profile = account?.profile;
  const sessions = account?.sessions || [];
  const loginActivity = account?.loginActivity || [];

  return (
    <div
      id="settings-view-container"
      className="h-full min-h-0 overflow-y-auto bg-[#f3f4f6] font-sans"
    >
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-neutral-950">Account</h1>
            <p className="text-sm text-neutral-500 mt-1">
              Manage your account settings and security.
            </p>
          </div>
          <button
            type="button"
            onClick={loadAccount}
            className="inline-flex items-center gap-1.5 text-xs font-medium border border-neutral-200 bg-white hover:bg-neutral-50 px-2.5 py-1.5 rounded-lg text-neutral-700 cursor-pointer shrink-0"
            title="Refresh"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>

        {toast && (
          <div
            className={`text-xs px-3.5 py-2.5 rounded-lg border flex items-center gap-2 ${
              toast.type === 'ok'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : 'bg-amber-50 border-amber-200 text-amber-900'
            }`}
          >
            <Check className="h-3.5 w-3.5 shrink-0" />
            {toast.text}
          </div>
        )}

        {/* Row 1: Profile · Security · Active Sessions */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {showSection('profile') && (
          <Card
            title="Profile"
            icon={<User className="h-4 w-4" />}
            action={
              currentUser.myAccountUserId ? (
                <span className="text-[10px] font-semibold text-neutral-500">
                  Managed in MyAccount
                </span>
              ) : !editingProfile ? (
                <button
                  type="button"
                  onClick={() => setEditingProfile(true)}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-neutral-700 border border-neutral-200 hover:border-neutral-400 bg-white px-2.5 py-1.5 rounded-lg cursor-pointer"
                >
                  <Pencil className="h-3 w-3" />
                  Edit Profile
                </button>
              ) : (
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingProfile(false);
                      setFullName(profile?.name || currentUser.name);
                      setPhone(profile?.phone || '');
                    }}
                    className="text-xs font-medium text-neutral-500 px-2 py-1.5 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={isSaving('profile')}
                    onClick={saveProfile}
                    className="text-xs font-semibold text-white bg-neutral-950 hover:bg-neutral-800 px-2.5 py-1.5 rounded-lg cursor-pointer disabled:opacity-50"
                  >
                    Save
                  </button>
                </div>
              )
            }
          >
            <dl className="space-y-0">
              <FieldRow label="Full Name">
                {editingProfile ? (
                  <input
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="border border-neutral-200 rounded-md px-2 py-1 text-xs w-full max-w-[160px] text-left focus:outline-none focus:border-neutral-900"
                  />
                ) : (
                  profile?.name || currentUser.name
                )}
              </FieldRow>
              <FieldRow label="Email">{profile?.email || currentUser.email}</FieldRow>
              <FieldRow label="Phone">
                {editingProfile ? (
                  <input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="border border-neutral-200 rounded-md px-2 py-1 text-xs w-full max-w-[160px] text-left focus:outline-none focus:border-neutral-900"
                  />
                ) : (
                  phone || '—'
                )}
              </FieldRow>
              <FieldRow label="Role">{roleLabel}</FieldRow>
              <FieldRow label="Company">{profile?.organizationName || '—'}</FieldRow>
              <FieldRow label="Access">{profile?.access || 'Ticketing Console'}</FieldRow>
              <FieldRow label="Last Login">{profile?.lastLoginLabel || '—'}</FieldRow>
            </dl>
          </Card>
          )}

          {showSection('security') && (
          <Card title="Security" icon={<Shield className="h-4 w-4" />}>
            <div className="space-y-5 flex-1">
              <div className="space-y-2">
                <p className="text-xs font-semibold text-neutral-800">Password</p>
                <p className="text-sm tracking-[0.35em] text-neutral-700 select-none">••••••••••••</p>
                <p className="text-[11px] text-neutral-400">
                  Last changed: {profile?.passwordChangedLabel || '—'}
                </p>
                {!showPasswordForm ? (
                  <button
                    type="button"
                    onClick={() => setShowPasswordForm(true)}
                    className="mt-1 text-xs font-medium border border-neutral-200 hover:border-neutral-400 px-3 py-1.5 rounded-lg cursor-pointer text-neutral-800 bg-white"
                  >
                    Change Password
                  </button>
                ) : (
                  <div className="space-y-2 pt-1">
                    {(['current', 'next', 'confirm'] as const).map((key) => (
                      <PasswordInput
                        key={key}
                        placeholder={
                          key === 'current'
                            ? 'Current password'
                            : key === 'next'
                              ? 'New password'
                              : 'Confirm new password'
                        }
                        value={passwordForm[key]}
                        onChange={(value) =>
                          setPasswordForm((p) => ({ ...p, [key]: value }))
                        }
                        autoComplete={
                          key === 'current'
                            ? 'current-password'
                            : key === 'next'
                              ? 'new-password'
                              : 'new-password'
                        }
                      />
                    ))}
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={isSaving('password')}
                        onClick={savePassword}
                        className="text-xs font-semibold bg-neutral-950 text-white px-3 py-1.5 rounded-lg cursor-pointer disabled:opacity-50"
                      >
                        Update Password
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowPasswordForm(false)}
                        className="text-xs font-medium text-neutral-600 px-2 py-1.5 cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </Card>
          )}

          {showSection('sessions') && (
          <Card
            title="Active Sessions"
            icon={<Monitor className="h-4 w-4" />}
            action={
              <span className="text-[10px] font-semibold tabular-nums text-neutral-500 bg-neutral-100 border border-neutral-200 px-2 py-0.5 rounded-full shrink-0">
                {sessions.length}
              </span>
            }
            bodyClassName="min-h-0 overflow-hidden"
            footer={
              <button
                type="button"
                disabled={isSaving('signout-all') || sessions.length === 0}
                onClick={signOutAll}
                className="w-full text-xs font-semibold border border-neutral-300 hover:border-neutral-500 text-neutral-800 py-2.5 rounded-lg cursor-pointer transition-colors disabled:opacity-50 bg-white"
              >
                Sign out from all devices
              </button>
            }
          >
            {sessions.length === 0 ? (
              <p className="text-xs text-neutral-400 py-8 text-center">No active sessions yet.</p>
            ) : (
              <ul className="space-y-1.5 overflow-y-auto min-h-0 flex-1 pr-1 -mr-1 overscroll-contain">
                {sessions.map((session) => (
                  <li
                    key={session.id}
                    className={`rounded-lg px-2.5 py-2 border ${
                      session.current
                        ? 'bg-neutral-50 border-neutral-200'
                        : 'bg-white border-transparent hover:border-neutral-100'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <p className="text-xs font-semibold text-neutral-900 truncate">
                            {session.current ? 'Current device' : session.title}
                          </p>
                          {session.current && (
                            <span className="text-[9px] font-bold tracking-wide text-neutral-500 bg-white border border-neutral-200 px-1.5 py-0.5 rounded shrink-0">
                              YOU
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] text-neutral-500 truncate mt-0.5">
                          {session.meta}
                          <span className="text-neutral-300 mx-1">·</span>
                          <span className="text-neutral-400">{session.lastActive}</span>
                        </p>
                      </div>
                      {!session.current && (
                        <button
                          type="button"
                          disabled={isSaving(`session:${session.id}`)}
                          onClick={() => signOutSession(session.id)}
                          className="text-[11px] font-medium text-rose-600 hover:text-rose-700 cursor-pointer shrink-0 disabled:opacity-50 px-1"
                        >
                          Sign out
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          )}
        </div>

        {/* Row 2: Notifications · Login Activity */}
        {(showSection('notifications') || showSection('loginActivity')) && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {showSection('notifications') && (
          <Card
            title="Notification Preferences"
            icon={<Bell className="h-4 w-4" />}
            footer={
              <button
                id="settings-save-notifications"
                type="button"
                disabled={!notifications || isSaving('notifications')}
                onClick={(e) => void saveNotifications(e)}
                className="w-full text-xs font-semibold bg-neutral-950 hover:bg-neutral-800 text-white py-2.5 rounded-lg cursor-pointer disabled:opacity-50"
              >
                {isSaving('notifications') ? 'Saving…' : 'Save Notifications'}
              </button>
            }
          >
            {!notifications ? (
              <p className="text-xs text-neutral-400 py-6 text-center">Loading preferences…</p>
            ) : (
              <div className="space-y-3.5 flex-1 min-h-0 overflow-y-auto pr-1">
                <p className="text-[11px] text-neutral-400 leading-relaxed">
                  Saved to your user record. Only enabled types are delivered to your inbox.
                </p>
                {(
                  [
                    {
                      key: 'ticketAssignments' as const,
                      label: 'Ticket Assignments',
                      hint: 'When a ticket is assigned to you',
                    },
                    {
                      key: 'ticketUpdates' as const,
                      label: 'Support Ticket Updates',
                      hint: 'Status/priority changes and new unassigned tickets',
                    },
                    {
                      key: 'slaAlerts' as const,
                      label: 'SLA & Overdue Alerts',
                      hint: 'When a ticket breaches its SLA due time',
                    },
                    {
                      key: 'securityAlerts' as const,
                      label: 'Security Alerts',
                      hint: 'Password changes and 2FA updates',
                    },
                    {
                      key: 'productUpdates' as const,
                      label: 'Product Updates',
                      hint: 'Product announcements when published',
                    },
                  ] as const
                ).map((item) => (
                  <label
                    key={item.key}
                    className="flex items-start gap-2.5 text-xs text-neutral-700 cursor-pointer select-none"
                  >
                    <input
                      type="checkbox"
                      checked={Boolean(notifications[item.key])}
                      onChange={(e) =>
                        setNotifications((n) =>
                          n ? { ...n, [item.key]: e.target.checked } : n
                        )
                      }
                      className="mt-0.5 h-3.5 w-3.5 rounded border-neutral-300 text-neutral-950 focus:ring-0 cursor-pointer accent-neutral-950"
                    />
                    <span className="min-w-0">
                      <span className="font-medium text-neutral-800 block">{item.label}</span>
                      <span className="text-[10px] text-neutral-400 leading-snug block mt-0.5">
                        {item.hint}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            )}
          </Card>
          )}

          {showSection('loginActivity') && (
          <Card
            title="Recent Login Activity"
            icon={<Clock className="h-4 w-4" />}
            action={
              <span className="text-[10px] font-semibold tabular-nums text-neutral-500 bg-neutral-100 border border-neutral-200 px-2 py-0.5 rounded-full shrink-0">
                {loginActivity.length}
              </span>
            }
            bodyClassName="min-h-0 overflow-hidden"
            footer={
              <button
                type="button"
                onClick={loadAccount}
                className="text-xs font-medium text-neutral-700 hover:text-neutral-950 cursor-pointer"
              >
                Refresh activity →
              </button>
            }
          >
            {loginActivity.length === 0 ? (
              <p className="text-xs text-neutral-400 py-8 text-center">No login events yet.</p>
            ) : (
              <ol className="relative border-l border-neutral-200 ml-1.5 space-y-3.5 flex-1 min-h-0 overflow-y-auto pl-4 pr-1 overscroll-contain">
                {loginActivity.map((item) => (
                  <li key={item.id} className="relative">
                    <span
                      className={`absolute -left-[1.35rem] top-1.5 h-2 w-2 rounded-full ring-4 ring-white ${
                        item.current ? 'bg-neutral-900' : 'bg-neutral-300'
                      }`}
                    />
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-neutral-900">{item.when}</p>
                        <p className="text-[11px] text-neutral-500 mt-0.5 leading-snug">
                          {item.detail}
                        </p>
                      </div>
                      {item.current && (
                        <span className="text-[9px] font-bold tracking-wide text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded shrink-0">
                          CURRENT
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Card>
          )}
        </div>
        )}

      </div>
    </div>
  );
}
