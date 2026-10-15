/**
 * Parse one audio-gateway transcript line and decide whether it belongs
 * to a connected CRM call. Matching uses organization id, agent extension,
 * and the last 10 digits of the customer number.
 */

export const CALL_TRANSCRIPT_CHANNEL = "CRM_AUDIO_CC_CALL_STREAM_QA";

export type GatewayAgent = {
  name: string;
  ext: string;
  userId: string;
  email: string;
};

export type GatewayLine = {
  sessionId: string;
  isBot: boolean;
  speaker: string;
  domainId: string;
  customerNumber: string;
  customerTail: string;
  text: string;
  transcriptTm: string;
  emotion: string;
  agentExts: string[];
  agents: GatewayAgent[];
  raw: Record<string, unknown>;
};

export type ActiveCallMatch = {
  organizationId: string;
  ext: string;
  remoteDigits: string;
};

/** Digits only, then the last 10 when the number includes a country code. */
export function phoneTail(value: string | null | undefined): string {
  const digits = String(value ?? "").replace(/\D+/g, "");
  if (!digits) return "";
  return digits.length <= 10 ? digits : digits.slice(-10);
}

function text(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function parseAgents(value: unknown): GatewayAgent[] {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  const agents: GatewayAgent[] = [];
  for (const item of list) {
    const row = asRecord(item);
    if (!row) continue;
    const ext = text(row.ext);
    if (!ext) continue;
    agents.push({
      name: text(row.name),
      ext,
      userId: text(row.userId),
      email: text(row.email),
    });
  }
  return agents;
}

function unwrapPayload(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    try {
      return unwrapPayload(JSON.parse(trimmed));
    } catch {
      return null;
    }
  }
  const row = asRecord(value);
  if (!row) return null;
  const nested = row.transcript_data ?? row.transcriptData ?? row.message ?? row.data;
  const hasLine = row.text != null || row.customer_number != null || row.customerNumber != null;
  if (!hasLine && nested != null) return unwrapPayload(nested);
  return row;
}

export function parseGatewayLine(message: string): GatewayLine | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(message);
  } catch {
    return null;
  }
  const row = unwrapPayload(parsed);
  if (!row) return null;

  const domainId = text(row.domain_id ?? row.domainId);
  const speaker = text(row.speaker);
  const customerNumber =
    text(row.customer_number ?? row.customerNumber) ||
    (phoneTail(speaker).length >= 7 ? speaker : "");
  const body = text(row.text);
  const agents = parseAgents(row.agent);
  const customerTail = phoneTail(customerNumber);
  if (!body || customerTail.length < 7) return null;

  const isBotRaw = row.is_bot;
  const isBot =
    isBotRaw === true ||
    isBotRaw === 1 ||
    isBotRaw === "1" ||
    (typeof isBotRaw === "string" && isBotRaw.trim().toLowerCase() === "true");

  return {
    sessionId: text(row.session_id),
    isBot,
    speaker,
    domainId,
    customerNumber,
    customerTail,
    text: body.slice(0, 4000),
    transcriptTm: text(row.transcriptTm ?? row.transcript_tm),
    emotion: text(row.emotion),
    agentExts: [...new Set(agents.map((agent) => agent.ext))],
    agents,
    raw: row,
  };
}

function normName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Employee display name on this call. Block-only: a match hides the line. */
export function speakerMatchesAgentName(speaker: string, agentName: string): boolean {
  const left = normName(speaker);
  const right = normName(agentName);
  if (!left || !right || right === "agent") return false;
  if (left === right) return true;
  if (left.length >= 3 && right.includes(left)) return true;
  if (right.length >= 3 && left.includes(right)) return true;
  const leftTokens = left.split(" ").filter((token) => token.length > 1);
  const rightTokens = right.split(" ").filter((token) => token.length > 1);
  return (
    leftTokens.length > 0 &&
    rightTokens.length > 0 &&
    leftTokens[0] === rightTokens[0] &&
    leftTokens[leftTokens.length - 1] === rightTokens[rightTokens.length - 1]
  );
}

function agentDisplayNames(line: GatewayLine, extraNames: string[] = []): string[] {
  return [...line.agents.map((agent) => agent.name), ...extraNames]
    .map((name) => name.trim())
    .filter((name) => name.length > 0 && !/^agent$/i.test(name));
}

function looksLikeAgentSpeaker(
  line: GatewayLine,
  agentExt?: string,
  extraNames: string[] = [],
): boolean {
  const speakerTail = phoneTail(line.speaker);
  if (speakerTail && line.agentExts.includes(speakerTail)) return true;
  if (agentExt && speakerTail && speakerTail === phoneTail(agentExt)) return true;
  const speaker = line.speaker.trim().toLowerCase();
  if (speaker && /\b(agent|bot|ivr|system|assistant|rep)\b/.test(speaker)) return true;
  return agentDisplayNames(line, extraNames).some((name) =>
    speakerMatchesAgentName(line.speaker, name),
  );
}

/**
 * Customer speech on this call. The customer's number is the customer.
 * The agent's extension or name is the employee and must not be shown or coached.
 * A name that matches neither stays the customer.
 */
export function isCustomerUtterance(
  line: GatewayLine,
  agentExt?: string,
  agentNames: string[] = [],
): boolean {
  if (line.isBot) return false;
  if (looksLikeAgentSpeaker(line, agentExt, agentNames)) return false;
  const speakerTail = phoneTail(line.speaker);
  if (speakerTail.length >= 7 && speakerTail === line.customerTail) return true;
  if (speakerTail.length >= 7 && speakerTail !== line.customerTail) return false;
  return true;
}

/** Same rule for a chunk already stored on the call session. */
export function isStoredCustomerUtterance(input: {
  isBot: boolean;
  speaker: string | null;
  customerTail: string;
  agentExt?: string | null;
  agentNames?: string[];
}): boolean {
  const customerTail = phoneTail(input.customerTail);
  const ext = (input.agentExt || "").trim();
  return isCustomerUtterance(
    {
      sessionId: "",
      isBot: input.isBot,
      speaker: input.speaker || "",
      domainId: "",
      customerNumber: customerTail,
      customerTail,
      text: ".",
      transcriptTm: "",
      emotion: "",
      agentExts: ext ? [ext] : [],
      agents: [],
      raw: {},
    },
    ext || undefined,
    input.agentNames || [],
  );
}

export function sameExt(left: string, right: string): boolean {
  const a = left.trim();
  const b = right.trim();
  if (!a || !b) return false;
  if (a === b) return true;
  const da = a.replace(/\D+/g, "");
  const db = b.replace(/\D+/g, "");
  if (!da || !db) return false;
  if (da === db) return true;
  if (da.length > 8 || db.length > 8) return false;
  return Number(da) === Number(db);
}

export function lineMatchesSession(line: GatewayLine, session: ActiveCallMatch): boolean {
  if (line.customerTail !== session.remoteDigits) return false;
  if (line.agentExts.length === 0) return true;
  return line.agentExts.some((ext) => sameExt(ext, session.ext));
}
