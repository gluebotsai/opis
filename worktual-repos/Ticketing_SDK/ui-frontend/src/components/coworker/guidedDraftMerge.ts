/** Cumulative guided-draft merge. Server `awaiting` owns the RH step. */

export type GuidedModule =
  | 'ticket'
  | 'customer'
  | 'kb'
  | 'macro'
  | 'team'
  | 'priority'
  | 'status'
  | 'escalate'
  | 'reassign';

export type GuidedDraftFields = Record<string, unknown>;

export type GuidedMergeResult = {
  fields: GuidedDraftFields;
  awaiting: string;
  ready: boolean;
  guided: boolean;
  skippedFields: string[];
};

const STEP_ORDER: Record<GuidedModule, readonly string[]> = {
  ticket: ['name', 'contact', 'issue', 'confirm'],
  customer: ['name', 'email', 'phone', 'confirm'],
  kb: ['title', 'category', 'body', 'publication_intent', 'confirm'],
  macro: ['title', 'body', 'confirm'],
  team: ['name', 'description', 'members', 'confirm'],
  priority: ['name', 'hours', 'confirm'],
  status: ['name', 'confirm'],
  escalate: ['ticket_number', 'assignee', 'confirm'],
  reassign: ['ticket_number', 'target_role', 'person', 'confirm'],
};

const ALIASES: Record<string, string> = {
  customername: 'name',
  customer_name: 'name',
  displayname: 'name',
  display_name: 'name',
  label: 'name',
  queuename: 'name',
  customeremail: 'email',
  customer_email: 'email',
  customerphone: 'phone',
  customer_phone: 'phone',
  content: 'body',
  reply: 'body',
  resolutionhours: 'hours',
  resolution_hours: 'hours',
  ticketnumber: 'ticket_number',
  person_name: 'person',
  role: 'target_role',
  publicationintent: 'publication_intent',
};

const FIELD_ALIASES: Record<string, string[]> = {
  name: ['name', 'customerName', 'displayName', 'label', 'queueName'],
  email: ['email', 'customerEmail'],
  phone: ['phone', 'customerPhone'],
  contact: ['contact', 'customerEmail', 'customerPhone'],
  title: ['title'],
  category: ['category'],
  body: ['body', 'content', 'reply'],
  description: ['description'],
  members: ['members'],
  hours: ['hours', 'resolutionHours'],
  issue: ['issue'],
  ticket_number: ['ticket_number', 'ticketNumber'],
  assignee: ['assignee'],
  target_role: ['target_role'],
  person: ['person', 'person_name'],
  publication_intent: ['publication_intent'],
};

function asRecord(value: unknown): GuidedDraftFields {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as GuidedDraftFields) }
    : {};
}

function isPlaceholderGuidedValue(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const text = value.trim().replace(/^['"]+|['"]+$/g, '').toLowerCase();
  return (
    text === 'null' ||
    text === 'none' ||
    text === 'nil' ||
    text === 'undefined' ||
    text === 'n/a' ||
    text === 'na' ||
    text === 'tbd' ||
    text === 'unknown'
  );
}

function firstNonEmpty(...values: unknown[]): unknown {
  for (const value of values) {
    if (value == null) continue;
    if (typeof value === 'string' && !value.trim()) continue;
    if (typeof value === 'string' && isPlaceholderGuidedValue(value)) continue;
    if (Array.isArray(value) && !value.length) continue;
    return value;
  }
  return undefined;
}

function pickField(src: GuidedDraftFields, canonical: string): unknown {
  const keys = FIELD_ALIASES[canonical] || [canonical];
  return firstNonEmpty(...keys.map((key) => src[key]));
}

export function normalizeGuidedAwaiting(
  module: GuidedModule,
  raw: string | undefined | null
): string {
  const step = String(raw || '')
    .trim()
    .toLowerCase();
  if (!step) return STEP_ORDER[module][0] || 'name';
  if (step === 'delete_confirm') return 'delete_confirm';
  const mapped = ALIASES[step] || step;
  if (module === 'ticket' && mapped === 'customername') return 'name';
  if (module === 'customer' && mapped === 'contact') return 'email';
  if (module === 'kb' && (mapped === 'content' || mapped === 'publish')) {
    return mapped === 'publish' ? 'publication_intent' : 'body';
  }
  return mapped;
}

export function stepIndexFromAwaiting(
  module: GuidedModule,
  awaiting: string | undefined | null
): number {
  const step = normalizeGuidedAwaiting(module, awaiting);
  if (step === 'delete_confirm') return STEP_ORDER[module].length - 1;
  const order = STEP_ORDER[module];
  const idx = order.indexOf(step);
  return idx >= 0 ? idx : 0;
}

export function mergeGuidedDraft(
  module: GuidedModule,
  prev: GuidedDraftFields | null | undefined,
  incoming: GuidedDraftFields | null | undefined
): GuidedMergeResult {
  const prior = asRecord(prev);
  const next = asRecord(incoming);
  const fields: GuidedDraftFields = { ...prior };

  const write = (canonical: string, aliases: string[]) => {
    const incomingVal = firstNonEmpty(...aliases.map((key) => next[key]));
    if (incomingVal === undefined) return;
    fields[canonical] = incomingVal;
    for (const alias of aliases) {
      if (alias !== canonical && next[alias] !== undefined) {
        fields[alias] = next[alias];
      }
    }
  };

  write('name', FIELD_ALIASES.name);
  write('customerName', ['customerName', 'name']);
  write('displayName', ['displayName', 'label', 'name']);
  write('email', FIELD_ALIASES.email);
  write('customerEmail', ['customerEmail', 'email']);
  write('phone', FIELD_ALIASES.phone);
  write('customerPhone', ['customerPhone', 'phone']);
  write('contact', FIELD_ALIASES.contact);
  write('title', FIELD_ALIASES.title);
  write('category', FIELD_ALIASES.category);
  write('body', FIELD_ALIASES.body);
  write('content', ['content', 'body']);
  write('description', FIELD_ALIASES.description);
  write('members', FIELD_ALIASES.members);
  write('hours', FIELD_ALIASES.hours);
  write('resolutionHours', ['resolutionHours', 'hours']);
  write('issue', FIELD_ALIASES.issue);
  write('ticket_number', FIELD_ALIASES.ticket_number);
  write('assignee', FIELD_ALIASES.assignee);
  write('target_role', FIELD_ALIASES.target_role);
  write('person', FIELD_ALIASES.person);
  write('publication_intent', FIELD_ALIASES.publication_intent);
  write('id', ['id']);
  write('kind', ['kind']);
  write('customerId', ['customerId', 'customer_id']);

  const awaiting = normalizeGuidedAwaiting(
    module,
    String(next.awaiting || next.step || prior.awaiting || prior.step || '')
  );
  const ready =
    typeof next.ready === 'boolean' ? Boolean(next.ready) : prior.ready === true;
  const skipped = [
    ...new Set(
      [...(Array.isArray(prior.skippedFields) ? prior.skippedFields : []), ...(Array.isArray(next.skippedFields) ? next.skippedFields : [])]
        .map((item) => String(item || '').trim())
        .filter(Boolean)
    ),
  ];
  const guided = Boolean(
    awaiting ||
      ready ||
      pickField(fields, 'name') ||
      pickField(fields, 'title') ||
      pickField(fields, 'issue') ||
      pickField(fields, 'ticket_number')
  );
  return {
    fields,
    awaiting,
    ready,
    guided,
    skippedFields: skipped,
  };
}

export function mergeCreateSeed<T extends GuidedDraftFields>(
  module: GuidedModule,
  prev: T | null | undefined,
  incoming: GuidedDraftFields
): T {
  const merged = mergeGuidedDraft(module, prev, incoming);
  return {
    ...(prev || {}),
    ...merged.fields,
    step: merged.awaiting,
    awaiting: merged.awaiting,
    ready: merged.ready,
    skippedFields: merged.skippedFields,
  } as unknown as T;
}
