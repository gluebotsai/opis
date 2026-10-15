/**
 * Internal vs customer meeting classification and who receives each card.
 * Deterministic. The LLM does not decide the meeting type or the audience.
 */

import type { AppRole } from "@/service/auth/rbac";

export type MeetingKind = "customer" | "internal";
export type InternalTargetType = "person" | "team" | "general";
export type InternalTopic =
  | "sales"
  | "presales"
  | "marketing"
  | "finance"
  | "support"
  | "unclear";

export type InternalPerson = {
  userId: string;
  email: string;
  /** Work email plus a connected Google address for the same user. */
  emails?: string[];
  name: string;
  role: AppRole;
  /** Internal meeting team; may preserve a support role not represented by AppRole. */
  team?: Exclude<InternalTopic, "unclear">;
};

const EMPLOYEE_ROLES = new Set<AppRole>([
  "sales_rep",
  "presales",
  "marketing",
  "finance",
  "viewer",
]);

function normEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function classifyInviteEmails(input: {
  inviteEmails: string[];
  /** Emails that belong to a CRM contact in this org. */
  customerEmails: string[];
  /** Setup-user work emails plus CEO/internal override addresses. */
  staffEmails: string[];
}): MeetingKind {
  const staff = new Set(input.staffEmails.map(normEmail).filter(Boolean));
  const customers = new Set(
    input.customerEmails.map(normEmail).filter((email) => email && !staff.has(email)),
  );
  for (const raw of input.inviteEmails) {
    const email = normEmail(raw);
    if (email && customers.has(email)) return "customer";
  }
  return "internal";
}

export function isInternalManager(
  person: InternalPerson,
  overrideEmails: string[],
): boolean {
  if (person.role === "admin" || person.role === "sales_manager") return true;
  const email = normEmail(person.email);
  return overrideEmails.some((item) => normEmail(item) === email);
}

export function isInternalEmployee(person: InternalPerson): boolean {
  return EMPLOYEE_ROLES.has(person.role);
}

function personEmails(person: InternalPerson): string[] {
  return [person.email, ...(person.emails ?? [])].map(normEmail).filter(Boolean);
}

function employees(people: InternalPerson[], overrideEmails: string[]): InternalPerson[] {
  return people.filter(
    (person) => isInternalEmployee(person) && !isInternalManager(person, overrideEmails),
  );
}

function forTopic(people: InternalPerson[], topic: InternalTopic): InternalPerson[] {
  if (topic === "sales") {
    return people.filter(
      (person) =>
        person.team === "sales" ||
        (!person.team && person.role === "sales_rep"),
    );
  }
  if (topic === "presales") {
    return people.filter(
      (person) =>
        person.team === "presales" ||
        (!person.team && person.role === "presales"),
    );
  }
  if (topic === "marketing") {
    return people.filter(
      (person) =>
        person.team === "marketing" ||
        (!person.team && person.role === "marketing"),
    );
  }
  if (topic === "finance") {
    return people.filter(
      (person) =>
        person.team === "finance" ||
        (!person.team && person.role === "finance"),
    );
  }
  if (topic === "support") {
    return people.filter((person) => person.team === "support");
  }
  return people.filter((person) => EMPLOYEE_ROLES.has(person.role));
}

function nameTokens(value: string): string[] {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 2);
}

/** Spoken names only select one known roster record; delivery still uses its email/user id. */
export function resolveNamedInternalPerson(
  people: InternalPerson[],
  spokenName: string | null | undefined,
): InternalPerson | null {
  const spoken = nameTokens(spokenName || "");
  if (!spoken.length) return null;
  const matches = people.filter((person) => {
    const known = nameTokens(person.name);
    if (!known.length) return false;
    if (spoken.join(" ") === known.join(" ")) return true;
    return spoken.length === 1 && spoken[0] === known[0];
  });
  return matches.length === 1 ? matches[0]! : null;
}

/**
 * Employees on this call, by role. The spoken name is not an identity.
 */
export function selectAnswerRecipients(input: {
  people: InternalPerson[];
  overrideEmails: string[];
  targetType: InternalTargetType;
  addresseeName: string | null;
  topic: InternalTopic;
}): InternalPerson[] {
  const pool = employees(input.people, input.overrideEmails).filter(
    (person) => person.role !== "viewer",
  );
  if (input.targetType === "person") {
    const person = resolveNamedInternalPerson(pool, input.addresseeName);
    return person ? [person] : [];
  }
  if (input.targetType === "general") return pool;
  const byTopic = forTopic(pool, input.topic);
  return byTopic;
}

export function selectFactCheckRecipients(
  people: InternalPerson[],
  overrideEmails: string[],
): InternalPerson[] {
  return people.filter((person) => isInternalManager(person, overrideEmails));
}

function firstNameToken(value: string): string {
  const token = normEmail(value).split(/[\s.]+/).find((part) => part.length >= 3);
  return token || "";
}

export function matchInternalSpeaker(
  people: InternalPerson[],
  speakerName: string | null | undefined,
  speakerEmail: string | null | undefined,
): InternalPerson | null {
  const email = speakerEmail ? normEmail(speakerEmail) : "";
  if (email) {
    const byEmail = people.filter((person) => personEmails(person).includes(email));
    if (byEmail.length === 1) return byEmail[0]!;
  }
  // Meet audio carries the tile name, not an address. A unique CRM first name
  // selects that user's email; the spoken spelling is not compared.
  const token = firstNameToken(speakerName || "");
  if (!token || token === "speaker") return null;
  const byName = people.filter((person) => firstNameToken(person.name) === token);
  return byName.length === 1 ? byName[0]! : null;
}

export type InternalDelivery =
  | { kind: "none" }
  | { kind: "answer"; recipients: InternalPerson[] }
  | { kind: "fact"; recipients: InternalPerson[] };

/** Manager questions get answer cards. Employee answers get a fact check. */
export function planInternalDelivery(input: {
  speaker: InternalPerson | null;
  isQuestion: boolean;
  targetType: InternalTargetType;
  addresseeName: string | null;
  topic: InternalTopic;
  people: InternalPerson[];
  overrideEmails: string[];
}): InternalDelivery {
  if (!input.speaker) return { kind: "none" };
  if (isInternalManager(input.speaker, input.overrideEmails)) {
    if (!input.isQuestion) return { kind: "none" };
    const recipients = selectAnswerRecipients({
      people: input.people,
      overrideEmails: input.overrideEmails,
      targetType: input.targetType,
      addresseeName: input.addresseeName,
      topic: input.topic,
    });
    return recipients.length ? { kind: "answer", recipients } : { kind: "none" };
  }
  if (
    isInternalEmployee(input.speaker) &&
    !isInternalManager(input.speaker, input.overrideEmails)
  ) {
    const recipients = selectFactCheckRecipients(input.people, input.overrideEmails);
    return recipients.length ? { kind: "fact", recipients } : { kind: "none" };
  }
  return { kind: "none" };
}
