import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ChevronDown, Search, Users } from 'lucide-react';
import { useSetPageTitle } from './layout/PageTitleContext';
import PageShell from './layout/PageShell';
import MenuSelect from './ui/menu-select';

type DirMember = {
  id: string;
  name: string;
  email: string;
  role?: string;
  skills: string[];
};

type DirTeam = {
  id: string;
  name: string;
  description: string;
  openTickets: number;
  members: DirMember[];
};

interface EscalationDirectoryViewProps {
  embedded?: boolean;
  /** When rendered under Teams tabs — tighter layout, no duplicate page chrome. */
  nested?: boolean;
  listRefreshToken?: number;
  /** Chat search / skill — same `?q=` the directory API uses. */
  externalSearchQuery?: string;
  onMessageStaff?: (userId: string) => void;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function roleChip(role: string | undefined): string {
  const r = (role || '').toLowerCase();
  if (r === 'admin') {
    return 'border-neutral-900 bg-neutral-900 text-white';
  }
  if (r === 'resolver') {
    return 'border-neutral-300 bg-neutral-100 text-neutral-800';
  }
  if (r === 'agent') {
    return 'border-neutral-300 bg-white text-neutral-800';
  }
  return 'border-neutral-200 bg-neutral-50 text-neutral-600';
}

export default function EscalationDirectoryView({
  embedded = false,
  nested = false,
  listRefreshToken = 0,
  externalSearchQuery,
  onMessageStaff,
}: EscalationDirectoryViewProps) {
  useSetPageTitle('Escalation directory');
  const [teams, setTeams] = useState<DirTeam[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/escalation-directory', {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed');
      setTeams(await res.json());
    } catch {
      setError('Could not load escalation directory.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (externalSearchQuery !== undefined) setSearchQuery(externalSearchQuery);
  }, [externalSearchQuery]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial catalog load
  }, []);

  useEffect(() => {
    if (!listRefreshToken) return;
    void load();
  }, [listRefreshToken]);

  const roles = useMemo(() => {
    const set = new Set<string>();
    for (const t of teams) {
      for (const m of t.members) {
        const r = (m.role || '').trim().toLowerCase();
        if (r) set.add(r);
      }
    }
    return [...set].sort();
  }, [teams]);

  const visibleTeams = useMemo(() => {
    const needle = searchQuery.trim().toLowerCase();
    const bySearch = !needle
      ? teams
      : teams.filter((t) => {
          if (t.name.toLowerCase().includes(needle)) return true;
          if (String(t.description || '').toLowerCase().includes(needle)) return true;
          return t.members.some(
            (m) =>
              m.name.toLowerCase().includes(needle) ||
              String(m.email || '').toLowerCase().includes(needle) ||
              String(m.role || '').toLowerCase().includes(needle) ||
              (m.skills || []).some((s) => s.toLowerCase().includes(needle))
          );
        });
    if (roleFilter === 'all') return bySearch;
    return bySearch
      .map((t) => ({
        ...t,
        members: t.members.filter(
          (m) => (m.role || '').toLowerCase() === roleFilter
        ),
      }))
      .filter((t) => t.members.length > 0);
  }, [teams, roleFilter, searchQuery]);

  const content = (
    <div
      className={
        nested
          ? 'space-y-4 w-full'
          : 'space-y-4 max-w-5xl mx-auto w-full px-5 sm:px-8 py-5 pb-8'
      }
    >
      <div className="min-w-0">
        {!nested ? (
          <p className="text-sm text-neutral-500">
            Read-only map of Ticketing teams, members, and skills.
          </p>
        ) : (
          <>
            <h2 className="text-base font-semibold text-neutral-900">
              Escalation directory
            </h2>
            <p className="mt-0.5 text-[13px] text-neutral-500">
              Who to escalate to — teams, members, roles, and skills. Read-only.
            </p>
          </>
        )}
      </div>
      <div className="flex flex-col sm:flex-row gap-2">
        <label className="relative flex-1 min-w-0">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search teams, members, or skills…"
            aria-label="Search escalation directory"
            className="w-full h-10 rounded-xl border border-neutral-200 bg-white pl-9 pr-3 text-sm text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-200/70 focus:border-neutral-300"
          />
        </label>
        {roles.length > 0 ? (
          <MenuSelect
            label="Filter by role"
            value={roleFilter}
            className="w-full sm:w-44"
            options={[
              { value: 'all', label: 'All roles' },
              ...roles.map((r) => ({
                value: r,
                label: r.charAt(0).toUpperCase() + r.slice(1),
              })),
            ]}
            onChange={setRoleFilter}
          />
        ) : null}
      </div>
      {error && (
        <div className="flex items-center gap-2 text-xs text-neutral-800 bg-neutral-100 border border-neutral-300 rounded-xl px-3 py-2">
          <AlertTriangle className="h-3.5 w-3.5" />
          {error}
        </div>
      )}
      {loading ? (
        <p className="text-xs text-neutral-400 py-8 text-center">Loading…</p>
      ) : visibleTeams.length === 0 ? (
        <p className="text-sm text-neutral-400 py-8 text-center">No teams match.</p>
      ) : (
        <div className="space-y-3">
          {visibleTeams.map((t) => {
            const isCollapsed = Boolean(collapsed[t.id]);
            const openHot = t.openTickets > 0;
            return (
              <div
                key={t.id}
                className="rounded-2xl border-[0.6px] border-[#bfbfbf] bg-white shadow-none overflow-hidden"
              >
                <button
                  type="button"
                  onClick={() =>
                    setCollapsed((c) => ({ ...c, [t.id]: !c[t.id] }))
                  }
                  className="w-full px-4 py-3 flex items-center justify-between gap-3 text-left hover:bg-neutral-50/80"
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-neutral-900 text-white">
                      <Users className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-neutral-900">
                          {t.name}
                        </p>
                        <span className="inline-flex rounded-full border border-neutral-300 bg-white px-2 py-0.5 text-[10px] font-semibold text-neutral-700">
                          Team
                        </span>
                      </div>
                      {t.description ? (
                        <p className="text-xs text-neutral-500 mt-0.5 line-clamp-2">
                          {t.description}
                        </p>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold tabular-nums ${
                        openHot
                          ? 'border-neutral-900 bg-neutral-900 text-white'
                          : 'border-neutral-200 bg-white text-neutral-500'
                      }`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          openHot ? 'bg-white' : 'bg-neutral-300'
                        }`}
                      />
                      {t.openTickets} open
                    </span>
                    <ChevronDown
                      className={`h-4 w-4 text-neutral-400 transition-transform ${
                        isCollapsed ? '-rotate-90' : ''
                      }`}
                    />
                  </div>
                </button>
                {!isCollapsed && (
                  <div className="overflow-x-auto">
                    <table
                      className={`w-full table-fixed text-xs ${
                        onMessageStaff ? 'min-w-[720px]' : 'min-w-[640px]'
                      }`}
                    >
                      <colgroup>
                        {onMessageStaff ? (
                          <>
                            <col className="w-[22%]" />
                            <col className="w-[12%]" />
                            <col className="w-[28%]" />
                            <col className="w-[22%]" />
                            <col className="w-[110px]" />
                          </>
                        ) : (
                          <>
                            <col className="w-[26%]" />
                            <col className="w-[14%]" />
                            <col className="w-[32%]" />
                            <col className="w-[28%]" />
                          </>
                        )}
                      </colgroup>
                      <thead>
                        <tr className="border-t border-[#e5e5e5] bg-neutral-50 text-[10px] font-medium uppercase tracking-wide text-neutral-400">
                          <th className="text-left px-4 py-2">Member</th>
                          <th className="text-left px-4 py-2">Role</th>
                          <th className="text-left px-4 py-2">Skills</th>
                          <th className="text-left px-4 py-2">Email</th>
                          {onMessageStaff ? (
                            <th className="text-right px-4 py-2">Chat</th>
                          ) : null}
                        </tr>
                      </thead>
                      <tbody>
                        {t.members.length === 0 ? (
                          <tr>
                            <td
                              colSpan={onMessageStaff ? 5 : 4}
                              className="px-4 py-4 text-neutral-400"
                            >
                              No members mirrored yet
                            </td>
                          </tr>
                        ) : (
                          t.members.map((m) => (
                            <tr key={m.id} className="border-t border-[#e5e5e5]">
                              <td className="align-top px-4 py-2.5">
                                <div className="flex items-start gap-2.5 min-w-0">
                                  <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-[10px] font-semibold text-white">
                                    {initials(m.name)}
                                  </span>
                                  <div className="min-w-0">
                                    <div className="font-medium text-neutral-900 truncate">
                                      {m.name}
                                    </div>
                                  </div>
                                </div>
                              </td>
                              <td className="align-top px-4 py-2.5">
                                <span
                                  className={`inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-semibold capitalize ${roleChip(
                                    m.role
                                  )}`}
                                >
                                  {m.role || '—'}
                                </span>
                              </td>
                              <td className="align-top px-4 py-2.5">
                                <div className="flex flex-wrap content-start gap-1 min-w-0">
                                  {(m.skills || []).length ? (
                                    (m.skills || []).map((s) => (
                                      <span
                                        key={s}
                                        className="inline-flex max-w-full truncate rounded-full border border-neutral-200 bg-white px-2 py-0.5 text-[10px] font-medium text-neutral-600"
                                        title={s}
                                      >
                                        {s}
                                      </span>
                                    ))
                                  ) : (
                                    <span className="text-neutral-400">—</span>
                                  )}
                                </div>
                              </td>
                              <td className="align-top px-4 py-2.5 text-neutral-500">
                                <span className="block truncate" title={m.email || undefined}>
                                  {m.email || '—'}
                                </span>
                              </td>
                              {onMessageStaff ? (
                                <td className="align-top px-4 py-2.5 text-right">
                                  <button
                                    type="button"
                                    onClick={() => onMessageStaff(m.id)}
                                    className="h-[38px] rounded-lg border-[0.6px] border-[#bfbfbf] px-3 text-xs font-medium text-[#171717] hover:bg-[#fafafa]"
                                  >
                                    Message
                                  </button>
                                </td>
                              ) : null}
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  if (embedded) return content;
  return <PageShell>{content}</PageShell>;
}
