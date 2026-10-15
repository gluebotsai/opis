import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { avatarColorFromName, initialsFromName } from "@/lib/avatar";
import { readPageField, writePageField } from "@/lib/nav-return";
import {
  ACTIVITY_TYPE_LABELS,
  ActivityTypeBadge,
  ActivityTypeIcon,
  activityFeedStatusTone,
} from "@/lib/activity-type-style";
import { contactActivityHref } from "@/lib/activity-href";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import type { BuyingActivity, BuyingCoverage } from "@/services/buying-group";
import {
  BUYING_ATTITUDE,
  BUYING_INFLUENCE,
  BUYING_ROLES,
  buyingRoleLabel,
  fetchCompanyBuyingGroup,
  relationshipLabel,
  reviewCompanyBuyingRole,
  reviewCompanyRelationship,
  setCompanyBuyingRole,
  suggestCompanyBuyingGroup,
  type BuyingGroup,
} from "@/services/buying-group";

function when(value: string | null): string {
  if (!value) return "No activity yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** List rows must not show the email page. Tags and leftover markup are dropped. */
function activityPreview(raw: string | null | undefined): string {
  if (!raw?.trim()) return "";
  const wasMarkup = /<!doctype|<html\b|<head\b|<meta\b/i.test(raw);
  const text = raw
    .replace(/<!doctype[^>]*>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
  if (!text || /<!doctype|<html|charset\s*=|xmlns\s*=/i.test(text)) return "";
  if (wasMarkup && /charset|viewport|initial-scale/i.test(text) && text.length < 160) return "";
  return text;
}

function dayKey(iso: string): string {
  const date = new Date(iso);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function dayLabel(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (dayKey(iso) === dayKey(today.toISOString())) {
    return `Today · ${date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
  }
  if (dayKey(iso) === dayKey(yesterday.toISOString())) {
    return `Yesterday · ${date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
  }
  return date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function groupActivities(items: BuyingActivity[]) {
  const groups: Array<{ key: string; label: string; items: BuyingActivity[] }> = [];
  const index = new Map<string, number>();
  for (const item of items) {
    const anchor = item.dueAt || item.createdAt;
    const key = dayKey(anchor);
    const existing = index.get(key);
    if (existing === undefined) {
      index.set(key, groups.length);
      groups.push({ key, label: dayLabel(anchor), items: [item] });
    } else {
      groups[existing].items.push(item);
    }
  }
  return groups;
}

const STATUS_LABEL: Record<string, string> = {
  upcoming: "Upcoming",
  overdue: "Overdue",
  logged: "Logged",
};

function statusLabel(status: string): string {
  if (status === "confirmed") return "Confirmed";
  if (status === "suggested") return "Suggested";
  return status;
}

export function CompanyBuyingGroupPanel({ companyId }: { companyId: string }) {
  const [group, setGroup] = useState<BuyingGroup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [suggesting, setSuggesting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const { pathname } = useLocation();
  const [typeFilter, setTypeFilter] = useState(
    () => readPageField(pathname, "activityType") || "all",
  );
  const [activityQuery, setActivityQuery] = useState(
    () => readPageField(pathname, "activityQuery") || "",
  );
  useEffect(() => {
    writePageField(pathname, "activityType", typeFilter);
    writePageField(pathname, "activityQuery", activityQuery);
  }, [pathname, typeFilter, activityQuery]);
  const navigate = useNavigate();
  const [contactId, setContactId] = useState("");
  const [role, setRole] = useState("champion");
  const [influence, setInfluence] = useState("medium");
  const [attitude, setAttitude] = useState("neutral");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      const first = await fetchCompanyBuyingGroup(companyId);
      if (cancelled) return;
      if (!first.ok) {
        setError(first.error || "Buying group is unavailable right now.");
        setLoading(false);
        return;
      }
      setGroup(first.buyingGroup);
      setLoading(false);
      const uncovered = first.buyingGroup.contacts.some(
        (person) =>
          !first.buyingGroup.roles.some(
            (item) => item.contactId === person.id && item.dealId == null,
          ),
      );
      if (!uncovered) return;
      setSuggesting(true);
      const suggested = await suggestCompanyBuyingGroup(companyId);
      if (cancelled) return;
      if (suggested.ok) setGroup(suggested.buyingGroup);
      setSuggesting(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  const activities = useMemo(() => {
    if (!group) return [];
    const query = activityQuery.trim().toLowerCase();
    return group.activities.filter((item) => {
      if (typeFilter !== "all" && item.type !== typeFilter) return false;
      if (!query) return true;
      const haystack = [item.subject, item.contactName, item.bodyPreview || ""]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [group, typeFilter, activityQuery]);
  const activityGroups = useMemo(() => groupActivities(activities), [activities]);

  const typeOptions = useMemo(() => {
    const types = [...new Set(group?.activities.map((item) => item.type) ?? [])];
    return [
      { value: "all", label: "All types" },
      ...types.map((type) => ({ value: type, label: ACTIVITY_TYPE_LABELS[type] ?? type })),
    ];
  }, [group]);

  async function saveRole() {
    if (!contactId) return;
    setBusyId("save");
    const result = await setCompanyBuyingRole(companyId, {
      contactId,
      role,
      influence,
      attitude,
    });
    setBusyId(null);
    if (result.ok) setGroup(result.buyingGroup);
    else setError(result.error || "Could not save that role.");
  }

  async function reviewRole(roleId: string, status: "confirmed" | "rejected") {
    setBusyId(roleId);
    const result = await reviewCompanyBuyingRole(companyId, roleId, status);
    setBusyId(null);
    if (result.ok) setGroup(result.buyingGroup);
    else setError(result.error || "Could not update that role.");
  }

  async function reviewLink(linkId: string, status: "confirmed" | "rejected") {
    setBusyId(linkId);
    const result = await reviewCompanyRelationship(companyId, linkId, status);
    setBusyId(null);
    if (result.ok) setGroup(result.buyingGroup);
    else setError(result.error || "Could not update that relationship.");
  }

  return (
    <section className="rounded-xl border border-border-default bg-surface p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-text-primary">Buying group</h2>
        {suggesting ? (
          <p className="text-xs text-text-caption">Checking roles from recent conversations…</p>
        ) : null}
      </div>
      {error ? <p className="mt-3 text-sm text-text-danger">{error}</p> : null}
      {loading && !group ? (
        <p className="mt-3 text-sm text-text-caption">Loading company activity and roles…</p>
      ) : null}
      {group && group.contacts.length === 0 ? (
        <p className="mt-3 text-sm text-text-caption">No contacts on this company yet.</p>
      ) : null}
      {group && group.contacts.length > 0 ? (
        <div className="mt-4 space-y-6">
          <div>
            <h3 className="text-sm font-medium text-text-primary">Roles</h3>
            {group.roles.length === 0 ? (
              <p className="mt-2 text-sm text-text-caption">No roles yet.</p>
            ) : (
              <ul className="mt-2 space-y-3">
                {group.roles.map((item) => (
                  <li key={item.id} className="text-sm text-text-primary">
                    <p>
                      <span className="font-medium">{item.contactName}</span>
                      {item.title ? <span className="text-text-caption"> · {item.title}</span> : null}
                      {" · "}
                      {buyingRoleLabel(item.role)}
                      {item.dealId ? " on a deal" : " on the company"}
                      {" · "}
                      {statusLabel(item.status)}
                      {item.influence ? ` · ${item.influence} influence` : ""}
                      {item.attitude ? ` · ${item.attitude}` : ""}
                    </p>
                    {item.evidence ? (
                      <p className="mt-1 text-text-caption">{item.evidence}</p>
                    ) : null}
                    {item.status === "suggested" ? (
                      <div className="mt-2 flex gap-2">
                        <Button
                          variant="secondary"
                          disabled={busyId === item.id}
                          onClick={() => void reviewRole(item.id, "confirmed")}
                        >
                          Confirm
                        </Button>
                        <Button
                          variant="tertiary"
                          disabled={busyId === item.id}
                          onClick={() => void reviewRole(item.id, "rejected")}
                        >
                          Reject
                        </Button>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Select
                label="Contact"
                value={contactId}
                options={[
                  { value: "", label: "Choose a contact" },
                  ...group.contacts.map((person) => ({ value: person.id, label: person.name })),
                ]}
                onChange={(event) => setContactId(event.target.value)}
              />
              <Select
                label="Role"
                value={role}
                options={BUYING_ROLES.map((item) => ({ value: item.value, label: item.label }))}
                onChange={(event) => setRole(event.target.value)}
              />
              <Select
                label="Influence"
                value={influence}
                options={BUYING_INFLUENCE}
                onChange={(event) => setInfluence(event.target.value)}
              />
              <Select
                label="Attitude"
                value={attitude}
                options={BUYING_ATTITUDE}
                onChange={(event) => setAttitude(event.target.value)}
              />
            </div>
            <div className="mt-3">
              <Button variant="secondary" disabled={!contactId || busyId === "save"} onClick={() => void saveRole()}>
                Save role
              </Button>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-medium text-text-primary">Relationships</h3>
            {group.relationships.length === 0 ? (
              <p className="mt-2 text-sm text-text-caption">No links between these contacts yet.</p>
            ) : (
              <ul className="mt-2 space-y-3">
                {group.relationships.map((item) => (
                  <li key={item.id} className="text-sm text-text-primary">
                    <p>
                      <span className="font-medium">{item.fromName}</span>
                      {" "}
                      {relationshipLabel(item.kind).toLowerCase()}
                      {" "}
                      <span className="font-medium">{item.toName}</span>
                      {item.strength ? ` · ${item.strength}` : ""}
                      {" · "}
                      {statusLabel(item.status)}
                    </p>
                    {item.evidence ? <p className="mt-1 text-text-caption">{item.evidence}</p> : null}
                    {item.status === "suggested" ? (
                      <div className="mt-2 flex gap-2">
                        <Button
                          variant="secondary"
                          disabled={busyId === item.id}
                          onClick={() => void reviewLink(item.id, "confirmed")}
                        >
                          Confirm
                        </Button>
                        <Button
                          variant="tertiary"
                          disabled={busyId === item.id}
                          onClick={() => void reviewLink(item.id, "rejected")}
                        >
                          Reject
                        </Button>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h3 className="text-sm font-medium text-text-primary">Activity</h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_11.5rem]">
              <Input
                value={activityQuery}
                onChange={(event) => setActivityQuery(event.target.value)}
                placeholder="Search subject or contact…"
                aria-label="Search company activities"
              />
              <Select
                value={typeFilter}
                options={typeOptions}
                aria-label="Filter by type"
                onChange={(event) => setTypeFilter(event.target.value)}
              />
            </div>
            {activities.length === 0 ? (
              <div className="mt-3 rounded-xl border border-border-default px-6 py-10 text-center">
                <p className="text-sm font-medium text-text-primary">No activities found</p>
                <p className="mt-2 text-sm text-text-caption">
                  Activities on this company’s contacts show up here.
                </p>
              </div>
            ) : (
              <div className="mt-3 overflow-hidden rounded-xl border border-border-default">
                <div className="overflow-x-auto">
                  <table className="min-w-full text-left text-sm">
                    <thead className="border-b border-border-default bg-subtle text-text-caption">
                      <tr>
                        <th className="px-4 py-3 font-medium">Activity</th>
                        <th className="px-4 py-3 font-medium">Related to</th>
                        <th className="px-4 py-3 font-medium">Type</th>
                        <th className="px-4 py-3 font-medium">Due</th>
                        <th className="px-4 py-3 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activityGroups.map((day) => (
                        <CompanyActivityRows
                          key={day.key}
                          label={day.label}
                          items={day.items}
                          onOpen={(item) =>
                            navigate(contactActivityHref(item.contactId, item.id, item.type))
                          }
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          <div>
            <h3 className="text-sm font-semibold text-text-primary">Who on our side knows whom</h3>
            {group.coverage.length === 0 ? (
              <p className="mt-2 text-sm text-text-caption">No emails, calls, meetings, or messages yet.</p>
            ) : (
              <ul className="mt-3 grid gap-3 sm:grid-cols-2">
                {group.coverage.map((item) => (
                  <CoverageCard key={`${item.userId}-${item.contactId}`} item={item} />
                ))}
              </ul>
            )}
          </div>

          {group.neglected.length > 0 ? (
            <div>
              <h3 className="text-sm font-medium text-text-primary">Neglected stakeholders</h3>
              <ul className="mt-2 space-y-2">
                {group.neglected.map((item) => (
                  <li key={item.contactId} className="text-sm text-text-primary">
                    <span className="font-medium">{item.contactName}</span>
                    {item.title ? <span className="text-text-caption"> · {item.title}</span> : null}
                    <span className="text-text-caption"> · last contact {when(item.lastAt)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function PersonMark({ name }: { name: string }) {
  return (
    <span
      className={`flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white ${avatarColorFromName(name)}`}
      aria-hidden
    >
      {initialsFromName(name)}
    </span>
  );
}

function CoverageCard({ item }: { item: BuyingCoverage }) {
  const label = item.touchCount === 1 ? "conversation" : "conversations";
  return (
    <li>
      <Link
        to={`/contact/${item.contactId}`}
        className="flex items-center gap-3 rounded-xl border border-border-default bg-surface px-3 py-3 transition-colors hover:border-border-strong hover:bg-subtle/60"
      >
        <PersonMark name={item.userName} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-text-primary">{item.userName}</p>
          <p className="mt-0.5 truncate text-xs text-text-caption">
            Talked with <span className="font-medium text-text-secondary">{item.contactName}</span>
          </p>
        </div>
        <PersonMark name={item.contactName} />
        <div className="shrink-0 text-right">
          <p className="text-sm font-semibold tabular-nums text-text-primary">{item.touchCount}</p>
          <p className="text-[11px] text-text-caption">{label}</p>
          <p className="mt-1 text-[11px] text-text-caption">Last {when(item.lastAt)}</p>
        </div>
      </Link>
    </li>
  );
}

function CompanyActivityRows({
  label,
  items,
  onOpen,
}: {
  label: string;
  items: BuyingActivity[];
  onOpen: (item: BuyingActivity) => void;
}) {
  return (
    <>
      <tr className="bg-subtle/60">
        <td
          colSpan={5}
          className="px-4 py-2 text-xs font-semibold tracking-wide text-text-caption uppercase"
        >
          {label}
        </td>
      </tr>
      {items.map((item) => {
        const status = item.status || "logged";
        const whenSource = item.dueAt || item.createdAt;
        const href = contactActivityHref(item.contactId, item.id, item.type);
        const preview = activityPreview(item.bodyPreview);
        return (
          <tr
            key={`${item.source}-${item.id}`}
            data-return-focus={`${item.source}-${item.id}`}
            className="cursor-pointer border-b border-border-default/70 last:border-0 hover:bg-neutral-50/80"
            onClick={() => onOpen(item)}
          >
            <td className="px-4 py-3">
              <div className="flex items-start gap-3">
                <ActivityTypeIcon type={item.type} size="sm" className="mt-0.5" />
                <div className="min-w-0">
                  <p className="font-medium text-text-primary">{item.subject}</p>
                  <p className="mt-0.5 text-xs text-text-caption">
                    {new Date(whenSource).toLocaleTimeString(undefined, {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                    {item.source === "deal" ? " · On a deal" : ""}
                  </p>
                  {preview && !item.bodyPreview?.includes("WT_NOTE_V1") ? (
                    <p className="mt-1 line-clamp-2 text-xs text-text-caption">{preview}</p>
                  ) : null}
                </div>
              </div>
            </td>
            <td className="px-4 py-3">
              <Link
                to={href}
                className="font-medium text-text-link hover:underline"
                onClick={(event) => event.stopPropagation()}
              >
                {item.contactName}
              </Link>
            </td>
            <td className="px-4 py-3">
              <ActivityTypeBadge type={item.type} />
            </td>
            <td className="px-4 py-3 text-text-secondary">
              {item.dueAt
                ? new Date(item.dueAt).toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })
                : "—"}
            </td>
            <td className="px-4 py-3">
              <span className={activityFeedStatusTone(status)}>
                {STATUS_LABEL[status] ?? status}
              </span>
            </td>
          </tr>
        );
      })}
    </>
  );
}
