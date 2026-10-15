/**
 * Run a Sales Assist next-best action the rep accepted: schedule the
 * meeting, send the email, or create the task/call. The model chooses the
 * action; this only clamps and persists it.
 */

import { prisma } from "@/dao/db/prisma";
import { getContact } from "@/dao/contacts/contact-service";
import { createActivityCommand } from "@/service/contacts/contact-commands";
import { scheduleMeetingCommand } from "@/service/calendar/schedule-meeting-command";
import { sendConnectedEmailForUser } from "@/service/email/send-connected-email";
import { resolveAssistSessionForMeetUrl } from "@/service/meeting-service/meet-assist-bootstrap";
import {
  normalizeAssistAction,
  type AssistAction,
} from "@/service/ai/meeting-assist";

export type ExecuteAssistActionResult =
  | { ok: true; message: string; already?: boolean }
  | { ok: false; error: string; status: number };

const DONE_MESSAGE: Record<AssistAction["kind"], string> = {
  schedule_meeting: "Meeting scheduled.",
  call: "Call created.",
  send_case_study: "Case study sent.",
  involve_presales: "Presales task created.",
  send_follow_up: "Follow-up sent.",
  task: "Task created.",
};

export function assistActionKey(action: AssistAction): string {
  return [
    action.kind,
    action.whenLocal || "",
    action.subject || "",
    action.detail,
  ]
    .join("|")
    .slice(0, 500);
}

/** Wall-clock YYYY-MM-DDTHH:mm in `timeZone` → absolute instant. */
export function zonedLocalToUtc(whenLocal: string, timeZone: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(whenLocal);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) {
    return null;
  }
  try {
    Intl.DateTimeFormat("en-US", { timeZone });
  } catch {
    return null;
  }
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcGuess));
  const pick = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value || "0");
  const asUtc = Date.UTC(
    pick("year"),
    pick("month") - 1,
    pick("day"),
    pick("hour"),
    pick("minute"),
    pick("second"),
  );
  return new Date(utcGuess - (asUtc - utcGuess));
}

function readDoneKeys(meta: unknown): string[] {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return [];
  const raw = (meta as Record<string, unknown>).executedActionKeys;
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is string => typeof item === "string");
}

async function markActionDone(sessionId: string, key: string): Promise<void> {
  const session = await prisma.meetingAssistSession.findUnique({
    where: { id: sessionId },
    select: { meta: true },
  });
  const prev =
    session?.meta && typeof session.meta === "object" && !Array.isArray(session.meta)
      ? (session.meta as Record<string, unknown>)
      : {};
  const keys = readDoneKeys(prev);
  if (keys.includes(key)) return;
  await prisma.meetingAssistSession.update({
    where: { id: sessionId },
    data: {
      meta: {
        ...prev,
        executedActionKeys: [...keys, key].slice(-40),
      },
    },
  });
}

async function loadSession(input: {
  organizationId: string;
  sessionId?: string | null;
  meetingUrl?: string | null;
}): Promise<
  | { ok: true; id: string; contactId: string; meta: unknown }
  | { ok: false; error: string; status: number }
> {
  let sessionId = (input.sessionId || "").trim();
  if (!sessionId) {
    const meetingUrl = (input.meetingUrl || "").trim();
    if (!meetingUrl) {
      return { ok: false, error: "This meeting is not linked to a contact.", status: 404 };
    }
    const hit = await resolveAssistSessionForMeetUrl({
      organizationId: input.organizationId,
      meetingUrl,
    });
    if (!hit) {
      return { ok: false, error: "This meeting is not linked to a contact.", status: 404 };
    }
    sessionId = hit.sessionId;
  }
  let orgId: bigint;
  try {
    orgId = BigInt(input.organizationId);
  } catch {
    return { ok: false, error: "This meeting is not linked to a contact.", status: 404 };
  }
  const session = await prisma.meetingAssistSession.findFirst({
    where: { id: sessionId, organizationId: orgId },
    select: { id: true, contactId: true, meta: true },
  });
  if (!session) {
    return { ok: false, error: "This meeting is not linked to a contact.", status: 404 };
  }
  return { ok: true, id: session.id, contactId: session.contactId, meta: session.meta };
}

async function runAction(
  userId: string,
  contactId: string,
  action: AssistAction,
  timeZone: string,
): Promise<ExecuteAssistActionResult> {
  if (action.kind === "schedule_meeting") {
    const start = zonedLocalToUtc(action.whenLocal || "", timeZone);
    if (!start) {
      return { ok: false, error: "That meeting time is not valid.", status: 400 };
    }
    const scheduled = await scheduleMeetingCommand({
      contactId,
      when: action.whenLocal || "",
      whenIso: start.toISOString(),
      timeZone,
      topic: action.subject || action.detail,
      durationMinutes: action.durationMinutes ?? 30,
    });
    if (!scheduled.ok) {
      return { ok: false, error: scheduled.error, status: 400 };
    }
    return { ok: true, message: DONE_MESSAGE.schedule_meeting };
  }

  if (action.kind === "send_follow_up" || action.kind === "send_case_study") {
    const contact = await getContact(contactId);
    const to = contact?.person.email?.trim();
    if (!contact || !to) {
      return { ok: false, error: "This contact needs an email address.", status: 400 };
    }
    const subject = action.subject || "";
    const body = action.body || "";
    const sent = await sendConnectedEmailForUser({
      userId,
      to,
      subject,
      body,
      preferredProvider: null,
    });
    if (!sent.ok) {
      return { ok: false, error: sent.error, status: 400 };
    }
    const logged = await createActivityCommand(contactId, {
      type: "email",
      subject,
      body: `Accepted from Sales Assist.\n\n${body}`,
      folder: "sent",
      emailDirection: "outbound",
    });
    if (!logged.ok) {
      return { ok: true, message: DONE_MESSAGE[action.kind] };
    }
    return { ok: true, message: DONE_MESSAGE[action.kind] };
  }

  const due =
    (action.whenLocal
      ? zonedLocalToUtc(action.whenLocal, timeZone)?.toISOString()
      : null) || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const activityType = action.kind === "call" ? "call" : "task";
  const created = await createActivityCommand(contactId, {
    type: activityType,
    subject: action.subject || action.label,
    body: `Accepted from Sales Assist.\n\n${action.body || action.detail}`,
    dueAt: activityType === "task" ? due || undefined : undefined,
  });
  if (!created.ok) {
    return { ok: false, error: created.error, status: 400 };
  }
  return { ok: true, message: DONE_MESSAGE[action.kind] };
}

export async function executeAssistActionCommand(input: {
  organizationId: string;
  userId: string;
  sessionId?: string | null;
  meetingUrl?: string | null;
  /** Phone assist: run against this CRM contact without a meeting session. */
  contactId?: string | null;
  timeZone?: string | null;
  action: unknown;
}): Promise<ExecuteAssistActionResult> {
  const action = normalizeAssistAction(input.action);
  if (!action) {
    return { ok: false, error: "That action cannot be run.", status: 400 };
  }
  const timeZone = (input.timeZone || "").trim() || "UTC";
  try {
    Intl.DateTimeFormat("en-US", { timeZone });
  } catch {
    return { ok: false, error: "That timezone is not recognized.", status: 400 };
  }
  const contactId = (input.contactId || "").trim();
  if (contactId) {
    return runAction(input.userId, contactId, action, timeZone);
  }
  const session = await loadSession(input);
  if (!session.ok) return session;
  const key = assistActionKey(action);
  if (readDoneKeys(session.meta).includes(key)) {
    return { ok: true, message: "Already done.", already: true };
  }
  const result = await runAction(input.userId, session.contactId, action, timeZone);
  if (result.ok) {
    await markActionDone(session.id, key).catch(() => undefined);
  }
  return result;
}
