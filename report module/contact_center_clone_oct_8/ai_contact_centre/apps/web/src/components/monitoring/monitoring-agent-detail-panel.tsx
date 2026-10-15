import {
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  LoaderCircle,
  LogOut,
  MessageSquare,
} from "lucide-react";
import { Popover } from "antd";
import dayjs from "dayjs";
import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";

import { getTeamChatPath } from "@/config/navigation";
import { useAuth } from "@/hooks/use-auth";

import { PerformanceRangeCalendar } from "@/components/performance/performance-range-calendar";
import type { LiveAgent, LiveAgentConversation, AgentPastConversation } from "@/features/monitoring/types";
import { PanelExpandButton, PanelRefreshButton, useCopilotWorkspacePanels } from "@/components/assistant/copilot-workspace";
import { Button, IconButton } from "@/components/ui/button";
import {
  PROFILE_EMPTY_FACT,
  ProfileFact,
  ProfileFactGrid,
  ProfileSection,
} from "@/components/ui/profile-detail-row";
import { PanelScrollArea } from "@/components/ui/panel-scroll-area";
import { profileAvatarClassName, profileInitials } from "@/lib/avatar-utils";
import { cn } from "@/lib/utils";
import {
  agentPresenceLabel,
  agentPresenceTone,
  channelLabel,
  isAgentLoggedIn,
  resolveAgentChannelCapacity,
  resolveMonitoringAgentPresence,
} from "@/components/monitoring/monitoring-utils";
import { MonitoringChannelIcon } from "@/components/monitoring/monitoring-channel-icon";

import {
  CapacityBar,
  formatDuration,
  formatRelativeTime,
  MonitoringList,
  MonitoringListRow,
  StatusBadge,
} from "./monitoring-shared";
import { MonitoringAgentAttendanceHistory } from "./monitoring-agent-attendance-history";
import { MonitoringAgentPreviousConversations } from "./monitoring-agent-previous-conversations";

function formatDetail(value: string | null | undefined): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : PROFILE_EMPTY_FACT;
}

function formatLanguages(agent: LiveAgent): string {
  const parts = [agent.primaryLanguage, agent.secondaryLanguage]
    .map((value) => value?.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : PROFILE_EMPTY_FACT;
}

function liveLoadTone(
  active: number,
  max: number,
): "info" | "warning" | "danger" {
  if (max <= 0) return "info";
  if (active >= max) return "danger";
  if (active / max >= 0.75) return "warning";
  return "info";
}

function AgentChannelCapacityCard({
  agent,
  channelCapacity,
  className,
  scrollable = false,
}: {
  agent: LiveAgent;
  channelCapacity: ReturnType<typeof resolveAgentChannelCapacity>;
  className?: string;
  scrollable?: boolean;
}) {
  return (
    <ProfileSection
      className={className}
      scrollable={scrollable}
      title="Channel capacity"
      description="Live load by channel"
      headerAction={
        <span className="text-sm font-semibold tabular-nums text-[#171717]">
          {agent.activeCount}/{agent.maxCapacity} live
        </span>
      }
    >
      {channelCapacity.length === 0 ? (
        <p className="text-sm text-neutral-600">No channel capacity configured.</p>
      ) : (
        <ul className="space-y-3">
          {channelCapacity.map((row) => {
            const used = row.active + row.reserved;
            return (
              <li key={row.channel} className="flex items-center gap-2.5">
                <MonitoringChannelIcon
                  channel={row.channel}
                  className="size-5 shrink-0 rounded-[4px]"
                />
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium text-neutral-800">
                      {channelLabel(row.channel)}
                    </span>
                    {row.reserved > 0 ? (
                      <span className="shrink-0 text-[12px] text-neutral-400">
                        {row.reserved} reserved
                      </span>
                    ) : null}
                  </div>
                  <CapacityBar active={used} max={row.max} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </ProfileSection>
  );
}

function AgentCollapsibleSection({
  title,
  expanded,
  onToggle,
  trailing,
  headerAction,
  children,
  contentClassName,
}: {
  title: string;
  expanded: boolean;
  onToggle: () => void;
  trailing?: ReactNode;
  headerAction?: ReactNode;
  children: ReactNode;
  contentClassName?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-h-0 flex-col border-b-[0.6px] border-[#bfbfbf] last:border-b-0",
        expanded && "flex-1",
      )}
    >
      <div className="flex w-full shrink-0 items-center gap-1 px-2 py-1.5">
        <button
          type="button"
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-neutral-50"
          aria-expanded={expanded}
        >
          <h3 className="text-sm font-semibold text-neutral-900">{title}</h3>
          {trailing ? (
            <span className="truncate text-xs text-neutral-600">{trailing}</span>
          ) : null}
        </button>
        {headerAction ? <div className="shrink-0">{headerAction}</div> : null}
        <button
          type="button"
          onClick={onToggle}
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-neutral-400 transition-colors hover:bg-neutral-50 hover:text-neutral-600"
          aria-label={expanded ? `Collapse ${title}` : `Expand ${title}`}
          aria-expanded={expanded}
        >
          <ChevronDown
            className={cn(
              "size-4 transition-transform duration-200",
              expanded && "rotate-180",
            )}
            aria-hidden="true"
          />
        </button>
      </div>
      {expanded ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <PanelScrollArea className={cn("min-h-0 flex-1", contentClassName ?? "px-3 pb-3")}>
            {children}
          </PanelScrollArea>
        </div>
      ) : null}
    </div>
  );
}

type AgentDetailSection = "profile" | "attendance" | "live" | "previous";

function defaultAgentDetailSection(agent: LiveAgent): AgentDetailSection {
  return agent.conversations.length > 0 ? "live" : "profile";
}

type MonitoringAgentDetailPanelProps = {
  agent: LiveAgent;
  loggingOut?: boolean;
  logoutError?: string | null;
  onLogout: () => void;
  onSelectConversation: (conversation: LiveAgentConversation) => void;
  onBack?: () => void;
  onRefresh?: () => void;
  refreshing?: boolean;
};

export function MonitoringAgentDetailPanel({
  agent,
  loggingOut = false,
  logoutError = null,
  onLogout,
  onSelectConversation,
  onBack,
  onRefresh,
  refreshing = false,
}: MonitoringAgentDetailPanelProps) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const copilotMinimized = Boolean(useCopilotWorkspacePanels()?.copilotMinimized);
  const presence = resolveMonitoringAgentPresence(agent);
  const channelCapacity = resolveAgentChannelCapacity(agent);
  const displayEmail = agent.workEmail?.trim() || agent.email?.trim() || PROFILE_EMPTY_FACT;
  const headerSubtitle = agent.teamName?.trim() || (displayEmail !== PROFILE_EMPTY_FACT ? displayEmail : null);
  const [attendanceFrom, setAttendanceFrom] = useState("");
  const [attendanceTo, setAttendanceTo] = useState("");
  const [attendanceCalendarOpen, setAttendanceCalendarOpen] = useState(false);
  const [expandedSection, setExpandedSection] = useState<AgentDetailSection | null>(() =>
    defaultAgentDetailSection(agent),
  );

  useEffect(() => {
    setAttendanceFrom("");
    setAttendanceTo("");
    setAttendanceCalendarOpen(false);
    setExpandedSection(defaultAgentDetailSection(agent));
  }, [agent.id]);

  useEffect(() => {
    if (agent.conversations.length === 0) {
      setExpandedSection((current) => (current === "live" ? "profile" : current));
    }
  }, [agent.conversations.length]);

  function toggleSection(section: AgentDetailSection) {
    setAttendanceCalendarOpen(false);
    setExpandedSection((current) => (current === section ? null : section));
  }

  function openPastConversation(row: AgentPastConversation) {
    onSelectConversation({
      id: row.id,
      channel: row.channel,
      customer: row.customer,
      durationSeconds: 0,
      intent: row.intent,
      sla: "healthy",
      queue: row.queue,
      isPast: true,
    });
  }

  const attendancePickerValue: [dayjs.Dayjs, dayjs.Dayjs] =
    attendanceFrom && attendanceTo
      ? [dayjs(attendanceFrom), dayjs(attendanceTo)]
      : [dayjs().subtract(6, "day"), dayjs()];
  const attendanceRangeLabel =
    attendanceFrom && attendanceTo
      ? attendanceFrom === attendanceTo
        ? attendanceFrom
        : `${attendanceFrom} – ${attendanceTo}`
      : null;

  const cardClassName = "h-full min-h-0";
  const conversationCardClassName = "h-full min-h-[22.5rem]";
  const attendanceCardClassName = "col-span-2 h-[34rem] shrink-0";

  const attendancePicker = (
              <Popover
                open={attendanceCalendarOpen}
                onOpenChange={setAttendanceCalendarOpen}
                trigger="click"
                placement="bottomRight"
                arrow={false}
                destroyOnHidden
                overlayClassName="performance-range-popover"
                content={
                  <PerformanceRangeCalendar
                    value={attendancePickerValue}
                    onCancel={() => setAttendanceCalendarOpen(false)}
                    onApply={(start, end) => {
                      setAttendanceFrom(start.format("YYYY-MM-DD"));
                      setAttendanceTo(end.format("YYYY-MM-DD"));
                      setExpandedSection("attendance");
                      setAttendanceCalendarOpen(false);
                    }}
                  />
                }
              >
                <button
                  type="button"
                  className={cn(
                    "inline-flex size-[38px] items-center justify-center rounded-lg text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-neutral-800",
                    (attendanceCalendarOpen || attendanceRangeLabel) && "bg-neutral-100 text-neutral-800",
                  )}
                  title={attendanceRangeLabel ? `Selected ${attendanceRangeLabel}` : "Pick a date range"}
                  aria-label="Pick attendance range"
                  onClick={(event) => event.stopPropagation()}
                >
                  <CalendarDays className="size-[18px]" aria-hidden />
                </button>
              </Popover>
  );

  const profileFacts = (
            <ProfileFactGrid>
              <ProfileFact wrap label="Email" value={displayEmail} />
              {agent.email?.trim() && agent.workEmail?.trim() && agent.email !== agent.workEmail ? (
                <ProfileFact wrap label="Account" value={formatDetail(agent.email)} />
              ) : null}
              <ProfileFact wrap label="Employee ID" value={formatDetail(agent.employeeId)} />
              <ProfileFact wrap label="Team" value={formatDetail(agent.teamName)} />
              <ProfileFact
                wrap
                label="Queues"
                value={agent.queues.length > 0 ? agent.queues.join(" · ") : PROFILE_EMPTY_FACT}
              />
              <ProfileFact
                wrap
                label="Skills"
                value={agent.skills.length > 0 ? agent.skills.join(" · ") : PROFILE_EMPTY_FACT}
              />
              <ProfileFact
                wrap
                label="Shifts"
                value={agent.shiftTypes.length > 0 ? agent.shiftTypes.join(" · ") : PROFILE_EMPTY_FACT}
              />
              <ProfileFact wrap label="Languages" value={formatLanguages(agent)} />
              <ProfileFact wrap label="Location" value={formatDetail(agent.location)} />
              <ProfileFact wrap label="Account status" value={formatDetail(agent.accountStatus)} />
              {agent.presenceUpdatedAt ? (
                <ProfileFact
                  wrap
                  label="Presence"
                  value={`Updated ${formatRelativeTime(agent.presenceUpdatedAt)}`}
                />
              ) : null}
            </ProfileFactGrid>
  );

  const liveConversations = agent.conversations.length === 0 ? (
              <div className="px-1 py-6 text-center">
                <p className="text-sm font-medium text-neutral-800">No live conversations</p>
                <p className="mt-1 text-sm text-neutral-600">Nothing active right now.</p>
              </div>
            ) : (
              <MonitoringList>
                {agent.conversations.map((conversation) => (
                  <MonitoringListRow
                    key={conversation.id}
                    seed={conversation.id}
                    initials={conversation.customer.slice(0, 2).toUpperCase()}
                    title={conversation.customer}
                    subtitleIcon={<MonitoringChannelIcon channel={conversation.channel} />}
                    subtitle={channelLabel(conversation.channel)}
                    detail={`${conversation.intent} · ${conversation.queue}`}
                    trailingBottom={formatDuration(conversation.durationSeconds)}
                    onClick={() => onSelectConversation(conversation)}
                  />
                ))}
              </MonitoringList>
            );

  const attendanceHistory = (
            <MonitoringAgentAttendanceHistory
              agentId={agent.agentId}
              compact
              selectedFrom={attendanceFrom}
              selectedTo={attendanceTo}
              onSelectedRangeChange={(from, to) => {
                setAttendanceFrom(from);
                setAttendanceTo(to);
              }}
            />
  );

  const identityActions = (
        <div className="flex shrink-0 items-center gap-2">
          {copilotMinimized ? (
            <>
              {onRefresh ? (
                <PanelRefreshButton onClick={onRefresh} refreshing={refreshing} />
              ) : null}
              <PanelExpandButton side="right" />
            </>
          ) : null}
          <IconButton
            onClick={() => {
              if (!user) return;
              navigate(getTeamChatPath(user.role, agent.id));
            }}
            aria-label={`Message ${agent.name}`}
            title={`Message ${agent.name}`}
          >
            <MessageSquare />
          </IconButton>
          {isAgentLoggedIn(presence) ? (
            <Button
              variant="destructive"
              disabled={loggingOut}
              onClick={onLogout}
              className="text-sm"
            >
              {loggingOut ? (
                <LoaderCircle className="size-[18px] animate-spin" aria-hidden />
              ) : (
                <LogOut className="size-[18px]" aria-hidden />
              )}
              Log out agent
            </Button>
          ) : null}
        </div>
  );

  const identityBody = (
        <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-3">
          {copilotMinimized && onBack ? (
            <IconButton
              variant="ghostIcon"
              onClick={onBack}
              className="shrink-0 [&_svg]:size-[18px]"
              aria-label="Back to agents"
            >
              <ChevronLeft />
            </IconButton>
          ) : null}
          <div className={profileAvatarClassName(agent.id, "size-12 shrink-0 text-sm")}>
            {profileInitials(agent.name)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h2 className="truncate text-[18px] font-semibold text-neutral-900">{agent.name}</h2>
              <StatusBadge
                label={agent.attendanceToday === "present" ? "Present" : "Absent"}
                tone={agent.attendanceToday === "present" ? "success" : "neutral"}
              />
              <StatusBadge
                label={agentPresenceLabel(presence)}
                tone={agentPresenceTone(presence)}
              />
              <StatusBadge
                label={`${agent.activeCount}/${agent.maxCapacity} live`}
                tone={liveLoadTone(agent.activeCount, agent.maxCapacity)}
              />
            </div>
            {headerSubtitle ? (
              <p className="mt-0.5 truncate text-sm text-neutral-600">{headerSubtitle}</p>
            ) : null}
          </div>
        </div>
        {identityActions}
        </div>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {copilotMinimized ? null : (
        <div className="flex shrink-0 items-center justify-between gap-2 border-b-[0.6px] border-[#bfbfbf] bg-white px-4 py-3">
          {identityBody}
        </div>
      )}
      {copilotMinimized || !logoutError ? null : (
        <p className="shrink-0 border-b-[0.6px] border-[#bfbfbf] px-4 py-2 text-xs text-red-600">{logoutError}</p>
      )}

      {copilotMinimized ? (
        <PanelScrollArea className="min-h-0 flex-1 bg-[#f3f4f6]">
        <div className="grid min-h-full grid-cols-2 grid-rows-[auto_auto_minmax(22.5rem,1fr)_34rem] gap-4 p-4">
          <div className="col-span-2 rounded-xl border-[0.6px] border-[#bfbfbf] bg-white px-4 py-3">
            {identityBody}
            {logoutError ? (
              <p className="mt-2 text-xs text-red-600">{logoutError}</p>
            ) : null}
          </div>
          <ProfileSection
            title="Agent profile"
            description="Team, skills, and account details"
          >
            {profileFacts}
          </ProfileSection>

          <AgentChannelCapacityCard
            agent={agent}
            channelCapacity={channelCapacity}
            className={cardClassName}
            scrollable
          />

          <ProfileSection
            className={conversationCardClassName}
            scrollable
            title="Live conversations"
            description={
              agent.conversations.length > 0
                ? `${agent.conversations.length} active now`
                : "Nothing active right now"
            }
          >
            {liveConversations}
          </ProfileSection>

          <ProfileSection
            className={conversationCardClassName}
            scrollable
            title="Previous conversations"
            description="Recently closed work"
          >
            <MonitoringAgentPreviousConversations
              agentId={agent.agentId}
              onSelect={openPastConversation}
            />
          </ProfileSection>

          <ProfileSection
            className={attendanceCardClassName}
            scrollable
            title="Agent attendance history"
            description={attendanceRangeLabel ?? "Last 7 days"}
            headerAction={attendancePicker}
          >
            {attendanceHistory}
          </ProfileSection>
        </div>
        </PanelScrollArea>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white">
          <AgentCollapsibleSection
            title="Agent profile"
            expanded={expandedSection === "profile"}
            onToggle={() => toggleSection("profile")}
            contentClassName="px-4"
          >
            <div className="space-y-4 pb-4">
              <div className="rounded-xl border-[0.6px] border-[#bfbfbf] bg-white p-4">
                {profileFacts}
              </div>
              <AgentChannelCapacityCard agent={agent} channelCapacity={channelCapacity} />
            </div>
          </AgentCollapsibleSection>

          <AgentCollapsibleSection
            title="Agent attendance history"
            expanded={expandedSection === "attendance"}
            onToggle={() => toggleSection("attendance")}
            contentClassName="p-4"
            headerAction={attendancePicker}
          >
            {attendanceHistory}
          </AgentCollapsibleSection>

          <AgentCollapsibleSection
            title="Live conversations"
            trailing={
              agent.conversations.length > 0 ? `${agent.conversations.length}` : undefined
            }
            expanded={expandedSection === "live"}
            onToggle={() => toggleSection("live")}
          >
            {liveConversations}
          </AgentCollapsibleSection>

          <AgentCollapsibleSection
            title="Previous conversations"
            expanded={expandedSection === "previous"}
            onToggle={() => toggleSection("previous")}
          >
            <MonitoringAgentPreviousConversations
              agentId={agent.agentId}
              onSelect={openPastConversation}
            />
          </AgentCollapsibleSection>
        </div>
      )}
    </div>
  );
}
