/**
 * Shared in-app + email side effects when a ticket is created.
 * RBAC: assignee (agent) + resolver get assignment alerts; admins get org visibility.
 */
import {
  emailCustomerTicketCreated,
  emailStaffTicketCreated,
  emailStaffTicketReassigned,
} from "./customerMail";
import {
  notifyOrgAdmins,
  notifyOrgAgents,
  notifyTicketRoleTarget,
  notifyUsers,
} from "./notifications";

export type TicketCreatedSideEffectsInput = {
  organizationId: string;
  ticketId: string;
  ticketNumber: string;
  subject: string;
  customerName: string;
  customerEmail?: string | null;
  assigneeId?: string | null;
  assigneeName?: string | null;
  resolverId?: string | null;
  resolverName?: string | null;
  /** Skip actor from bell alerts (e.g. staff who filed the ticket). */
  excludeUserId?: string | null;
  /** When false, skip customer confirmation mail (e.g. placeholder email). */
  sendCustomerEmail?: boolean;
};

export async function runTicketCreatedNotifyAndMail(
  input: TicketCreatedSideEffectsInput
): Promise<void> {
  const orgId = input.organizationId;
  const ticketUuid = input.ticketId;
  const ticketNumber = input.ticketNumber;
  const subjectVal = input.subject;
  const customerName = input.customerName;
  const actorId = input.excludeUserId ? String(input.excludeUserId) : null;
  const assigneeId =
    input.assigneeId && input.assigneeName !== "Unassigned"
      ? String(input.assigneeId)
      : null;
  const resolverId = input.resolverId ? String(input.resolverId) : null;
  const alreadyNotified = new Set<string>();

  if (assigneeId) {
    await notifyTicketRoleTarget({
      orgId,
      userIds: [assigneeId],
      ticketNumber,
      subject: subjectVal,
      role: "agent",
      mode: "new",
      ticketUuid,
      customerName,
      excludeUserId: actorId,
    });
    alreadyNotified.add(assigneeId);
  } else {
    await notifyOrgAgents({
      orgId,
      kind: "update",
      title: "New ticket created",
      message: `Ticket ${ticketNumber} ("${subjectVal}") was filed by ${customerName}.`,
      ticketUuid,
      customerName,
      excludeUserId: actorId,
    });
  }

  if (resolverId && !alreadyNotified.has(resolverId)) {
    await notifyTicketRoleTarget({
      orgId,
      userIds: [resolverId],
      ticketNumber,
      subject: subjectVal,
      role: "resolver",
      mode: "new",
      ticketUuid,
      customerName,
      excludeUserId: actorId,
    });
    alreadyNotified.add(resolverId);
  }

  if (assigneeId) {
    await notifyOrgAdmins({
      orgId,
      kind: "update",
      title: "New ticket created",
      message: `Ticket ${ticketNumber} ("${subjectVal}") was filed for ${customerName}.`,
      ticketUuid,
      customerName,
      excludeUserId: actorId,
      excludeUserIds: [...alreadyNotified],
    });
  }

  await emailStaffTicketCreated({
    organizationId: orgId,
    ticketId: ticketUuid,
    ticketNumber,
    subject: subjectVal,
    customerName,
    assigneeId,
    assigneeName: input.assigneeName,
    resolverId,
    resolverName: input.resolverName,
  }).catch((e) =>
    console.warn("staff mail (created) failed:", (e as Error).message)
  );

  const customerEmail = String(input.customerEmail || "").trim();
  if (
    input.sendCustomerEmail !== false &&
    customerEmail &&
    !/@placeholder\.local$/i.test(customerEmail)
  ) {
    await emailCustomerTicketCreated({
      organizationId: orgId,
      ticketId: ticketUuid,
      ticketNumber,
      subject: subjectVal,
      customerName,
      customerEmail,
    }).catch((e) =>
      console.warn("customer mail (created) failed:", (e as Error).message)
    );
  }
}

export type StaffAssignMailInput = {
  organizationId: string;
  ticketId: string;
  ticketNumber: string;
  subject: string;
  customerName: string;
  assigneeId?: string | null;
  assigneeName?: string | null;
  resolverId?: string | null;
  resolverName?: string | null;
  prevAssigneeId?: string | null;
  prevAssigneeName?: string | null;
  prevResolverId?: string | null;
};

export function staffAssignTargets(input: StaffAssignMailInput): {
  firstAssignee: boolean;
  firstResolver: boolean;
  reassignAssignee: boolean;
  reassignResolver: boolean;
  nextL1: string | null;
  nextL2: string | null;
} {
  const prevName = String(input.prevAssigneeName || "").trim();
  const prevL1 =
    input.prevAssigneeId && prevName !== "" && prevName !== "Unassigned"
      ? String(input.prevAssigneeId)
      : null;
  const prevL2 = input.prevResolverId ? String(input.prevResolverId) : null;
  const nextL1 =
    input.assigneeId && String(input.assigneeName || "").trim() !== "Unassigned"
      ? String(input.assigneeId)
      : null;
  const nextL2 = input.resolverId ? String(input.resolverId) : null;
  const firstAssignee = Boolean(nextL1) && !prevL1;
  const firstResolver = Boolean(nextL2) && !prevL2;
  const reassignAssignee = Boolean(nextL1) && Boolean(prevL1) && nextL1 !== prevL1;
  const reassignResolver = Boolean(nextL2) && Boolean(prevL2) && nextL2 !== prevL2;
  return {
    firstAssignee,
    firstResolver,
    reassignAssignee,
    reassignResolver,
    nextL1,
    nextL2,
  };
}

export type StaffAssignBellMode = "new" | "reassign" | "escalate";

/** Bell copy: first fill = assigned; person→person = reassigned; escalate stays escalate. */
export function staffAssignBellModes(
  input: Pick<
    StaffAssignMailInput,
    | "assigneeId"
    | "assigneeName"
    | "resolverId"
    | "resolverName"
    | "prevAssigneeId"
    | "prevAssigneeName"
    | "prevResolverId"
  > & { escalate?: boolean }
): { agent: StaffAssignBellMode | null; resolver: StaffAssignBellMode | null } {
  const t = staffAssignTargets({
    organizationId: "",
    ticketId: "",
    ticketNumber: "",
    subject: "",
    customerName: "",
    ...input,
  });
  let agent: StaffAssignBellMode | null = null;
  if (t.firstAssignee) agent = "new";
  else if (t.reassignAssignee) agent = "reassign";
  let resolver: StaffAssignBellMode | null = null;
  if (input.escalate && t.nextL2 && (t.firstResolver || t.reassignResolver)) {
    resolver = "escalate";
  } else if (t.firstResolver) {
    resolver = "new";
  } else if (t.reassignResolver) {
    resolver = "reassign";
  }
  return { agent, resolver };
}

/**
 * Staff mail after L1/L2 is first filled (lean create → ITRA) or later
 * reassigned (chat or UI). Same person / unassign does not send.
 */
export async function emailStaffOnAssignChange(
  input: StaffAssignMailInput
): Promise<void> {
  const t = staffAssignTargets(input);
  const base = {
    organizationId: input.organizationId,
    ticketId: input.ticketId,
    ticketNumber: input.ticketNumber,
    subject: input.subject,
    customerName: input.customerName,
  };
  if (t.firstAssignee || t.firstResolver) {
    await emailStaffTicketCreated({
      ...base,
      assigneeId: t.firstAssignee ? t.nextL1 : null,
      assigneeName: t.firstAssignee ? input.assigneeName : null,
      resolverId: t.firstResolver ? t.nextL2 : null,
      resolverName: t.firstResolver ? input.resolverName : null,
    }).catch((e) =>
      console.warn("staff mail (first assign) failed:", (e as Error).message)
    );
  }
  if (t.reassignAssignee || t.reassignResolver) {
    await emailStaffTicketReassigned({
      ...base,
      assigneeId: t.reassignAssignee ? t.nextL1 : null,
      assigneeName: t.reassignAssignee ? input.assigneeName : null,
      resolverId: t.reassignResolver ? t.nextL2 : null,
      resolverName: t.reassignResolver ? input.resolverName : null,
    }).catch((e) =>
      console.warn("staff mail (reassign) failed:", (e as Error).message)
    );
  }
}
