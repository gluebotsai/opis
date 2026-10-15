import { prisma } from "@/dao/db/prisma";
import { callAiServiceAgent, AI_SERVICE_JOB_TIMEOUT_MS } from "@/service/ai/ai-service-client";
import {
  getCurrentOrganizationId,
  getCurrentUserRole,
} from "@/service/auth/require-role";
import { getServerUserId } from "@/service/account/session-cookie";
import { withUser } from "@/middlewares/auth";
import {
  getSetupUserById,
  roleFromSetupUser,
} from "@/service/account/setup-users";
import type { AppRole } from "@/service/auth/rbac";
import {
  DAILY_BRIEFING_CONTEXT_VERSION,
  greetingForIstHour,
  isDailyBriefingRole,
  istCalendarDate,
  istHour,
  loadDailyBriefingContext,
  withCurrentGreeting,
} from "@/dao/home/daily-briefing-context";
import { digitsToSpokenText } from "@/lib/spoken-numbers";
import { pcm16leMonoToWav } from "@/lib/pcm-wav";

const DEFAULT_TTS_HOST = "http://173.234.75.165:7024";
const WARM_CLOSERS = [
  "Have a great day!",
  "Have a good one.",
  "Take care today.",
  "Wishing you a smooth day ahead.",
  "All the best for today.",
  "Make it a good one.",
] as const;

const WARM_CLOSER_RE =
  /have a (great|good|nice|lovely) (day|one)|take care|smooth day|all the best|enjoy (your|the) day|make it a good one|go well today/i;

function ensureSpokenSentence(text: string): string {
  const trimmed = text.replace(/^[ \t]*[-•*]+\s*/, "").replace(/\s+/g, " ").trim();
  if (!trimmed) return "";
  if (/[.!?…]$/.test(trimmed)) return trimmed;
  return `${trimmed}.`;
}

function fallbackCloser(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return WARM_CLOSERS[hash % WARM_CLOSERS.length]!;
}

function assembleBriefingScript(
  greeting: string,
  parts: string[],
  seed: string,
): string {
  const lines = parts
    .flatMap((part) => part.split(/\n+/))
    .map(ensureSpokenSentence)
    .filter(Boolean);
  let body = lines.join("\n");
  if (!WARM_CLOSER_RE.test(body)) {
    body = `${body}\n${fallbackCloser(seed)}`.trim();
  }
  return digitsToSpokenText(`${greeting}\n${body}`.replace(/\n{3,}/g, "\n").trim());
}

export type DailyBriefingPayload = {
  enabled: boolean;
  script?: string;
  playedAt?: string | null;
  briefingDate?: string;
};

function briefingDateAsUtcMidnight(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

function storedContextVersion(items: unknown): number {
  if (
    items &&
    typeof items === "object" &&
    !Array.isArray(items) &&
    "version" in items &&
    typeof (items as { version?: unknown }).version === "number"
  ) {
    return (items as { version: number }).version;
  }
  return 0;
}

export function resolveTtsUrl(): string {
  const raw = process.env.TTS_BASE_URL?.trim() || DEFAULT_TTS_HOST;
  const trimmed = raw.replace(/\/$/, "");
  return /\/tts$/i.test(trimmed) ? trimmed : `${trimmed}/tts`;
}

export async function generateAndStoreDailyBriefing(input: {
  userId: string;
  role: AppRole;
  organizationId: string;
  force?: boolean;
}): Promise<DailyBriefingPayload> {
  if (!isDailyBriefingRole(input.role)) return { enabled: false };

  const briefingDate = istCalendarDate();
  const dateKey = briefingDateAsUtcMidnight(briefingDate);
  const existing = await prisma.dailyBriefing.findUnique({
    where: {
      organizationId_userId_briefingDate: {
        organizationId: BigInt(input.organizationId),
        userId: BigInt(input.userId),
        briefingDate: dateKey,
      },
    },
  });

  if (
    !input.force &&
    existing?.playedAt &&
    storedContextVersion(existing.items) >= DAILY_BRIEFING_CONTEXT_VERSION
  ) {
    const user = await getSetupUserById(input.userId);
    const firstName = user?.first_name?.trim() || "there";
    const refreshed = withCurrentGreeting(
      existing.script,
      firstName,
      istHour(),
    );
    return {
      enabled: true,
      script: refreshed,
      playedAt: existing.playedAt.toISOString(),
      briefingDate,
    };
  }
  if (
    !input.force &&
    existing &&
    !existing.playedAt &&
    storedContextVersion(existing.items) >= DAILY_BRIEFING_CONTEXT_VERSION
  ) {
    const user = await getSetupUserById(input.userId);
    const firstName = user?.first_name?.trim() || "there";
    const refreshed = withCurrentGreeting(
      existing.script,
      firstName,
      istHour(),
    );
    if (refreshed !== existing.script) {
      const row = await prisma.dailyBriefing.update({
        where: { id: existing.id },
        data: { script: refreshed },
      });
      return {
        enabled: true,
        script: row.script,
        playedAt: null,
        briefingDate,
      };
    }
    return {
      enabled: true,
      script: existing.script,
      playedAt: null,
      briefingDate,
    };
  }

  const user = await getSetupUserById(input.userId);
  const firstName = user?.first_name?.trim() || "there";
  const ctx = await loadDailyBriefingContext({
    userId: input.userId,
    role: input.role,
    organizationId: input.organizationId,
    firstName,
  });

  const agent = await callAiServiceAgent<{
    ok?: boolean;
    script?: unknown;
    lines?: unknown;
  }>(
    "daily-briefing",
    {
      role: ctx.role,
      firstName: ctx.firstName,
      hourIst: ctx.hourIst,
      pulse: ctx.pulse,
      meetings: ctx.meetings,
      tasks: ctx.tasks,
      followUps: ctx.followUps,
      invoices: ctx.invoices,
      organizationId: input.organizationId,
    },
    { timeoutMs: AI_SERVICE_JOB_TIMEOUT_MS },
  );

  const scriptFromAgent =
    typeof agent?.script === "string" && agent.script.trim() ? agent.script.trim() : "";
  const lines = Array.isArray(agent?.lines)
    ? agent.lines.filter((l): l is string => typeof l === "string" && l.trim().length > 0)
    : [];
  if (!scriptFromAgent && lines.length === 0) {
    return { enabled: true, briefingDate };
  }

  const script = assembleBriefingScript(
    greetingForIstHour(ctx.hourIst, firstName),
    scriptFromAgent ? [scriptFromAgent] : lines,
    `${briefingDate}:${input.userId}:${ctx.hourIst}`,
  );

  if (existing) {
    const row = await prisma.dailyBriefing.update({
      where: { id: existing.id },
      data: { script, items: ctx.storedItems, playedAt: null },
    });
    return {
      enabled: true,
      script: row.script,
      playedAt: null,
      briefingDate,
    };
  }

  try {
    const row = await prisma.dailyBriefing.create({
      data: {
        organizationId: BigInt(input.organizationId),
        userId: BigInt(input.userId),
        briefingDate: dateKey,
        script,
        items: ctx.storedItems,
      },
    });
    return {
      enabled: true,
      script: row.script,
      playedAt: null,
      briefingDate,
    };
  } catch (err) {
    const raced = await prisma.dailyBriefing.findUnique({
      where: {
        organizationId_userId_briefingDate: {
          organizationId: BigInt(input.organizationId),
          userId: BigInt(input.userId),
          briefingDate: dateKey,
        },
      },
    });
    if (raced) {
      return {
        enabled: true,
        script: raced.script,
        playedAt: raced.playedAt?.toISOString() ?? null,
        briefingDate,
      };
    }
    throw err;
  }
}

export async function getOrCreateDailyBriefing(): Promise<DailyBriefingPayload> {
  const userId = await getServerUserId();
  if (!userId) return { enabled: false };

  const role = await getCurrentUserRole();
  if (!isDailyBriefingRole(role)) return { enabled: false };

  const orgId = await getCurrentOrganizationId();
  return generateAndStoreDailyBriefing({
    userId,
    role,
    organizationId: orgId,
  });
}

export async function rerunTodaysDailyBriefings(): Promise<
  Array<{ userId: string; script?: string }>
> {
  const briefingDate = istCalendarDate();
  const dateKey = briefingDateAsUtcMidnight(briefingDate);
  const rows = await prisma.dailyBriefing.findMany({
    where: { briefingDate: dateKey },
  });
  const targets =
    rows.length > 0
      ? rows.map((row) => ({
          userId: String(row.userId),
          organizationId: String(row.organizationId),
        }))
      : [
          { userId: "1000", organizationId: "1000" },
          { userId: "1006", organizationId: "1000" },
        ];

  const out: Array<{ userId: string; script?: string }> = [];
  for (const target of targets) {
    const setup = await getSetupUserById(target.userId);
    const role = roleFromSetupUser(setup?.crm_role_name);
    const result = await withUser(target.userId, () =>
      generateAndStoreDailyBriefing({
        userId: target.userId,
        role,
        organizationId: setup?.organization_id ?? target.organizationId,
        force: true,
      }),
    );
    out.push({ userId: target.userId, script: result.script });
  }
  return out;
}

export async function markDailyBriefingPlayed(): Promise<DailyBriefingPayload> {
  const userId = await getServerUserId();
  if (!userId) return { enabled: false };
  const role = await getCurrentUserRole();
  if (!isDailyBriefingRole(role)) return { enabled: false };

  const orgId = await getCurrentOrganizationId();
  const briefingDate = istCalendarDate();
  const dateKey = briefingDateAsUtcMidnight(briefingDate);

  const existing = await prisma.dailyBriefing.findUnique({
    where: {
      organizationId_userId_briefingDate: {
        organizationId: BigInt(orgId),
        userId: BigInt(userId),
        briefingDate: dateKey,
      },
    },
  });
  if (!existing) {
    return { enabled: true, briefingDate, playedAt: null };
  }
  if (existing.playedAt) {
    return {
      enabled: true,
      script: existing.script,
      playedAt: existing.playedAt.toISOString(),
      briefingDate,
    };
  }
  const updated = await prisma.dailyBriefing.update({
    where: { id: existing.id },
    data: { playedAt: new Date() },
  });
  return {
    enabled: true,
    script: updated.script,
    playedAt: updated.playedAt?.toISOString() ?? null,
    briefingDate,
  };
}

export async function proxyDailyBriefingTts(): Promise<{
  ok: true;
  buffer: Buffer;
  contentType: string;
} | { ok: false; error: string; status: number }> {
  const userId = await getServerUserId();
  if (!userId) return { ok: false, error: "Not signed in.", status: 401 };
  const role = await getCurrentUserRole();
  if (!isDailyBriefingRole(role)) {
    return { ok: false, error: "Briefing is not enabled for this role.", status: 403 };
  }

  const orgId = await getCurrentOrganizationId();
  const briefingDate = istCalendarDate();
  const dateKey = briefingDateAsUtcMidnight(briefingDate);
  const row = await prisma.dailyBriefing.findUnique({
    where: {
      organizationId_userId_briefingDate: {
        organizationId: BigInt(orgId),
        userId: BigInt(userId),
        briefingDate: dateKey,
      },
    },
  });
  if (!row?.script?.trim()) {
    return { ok: false, error: "No briefing script for today.", status: 404 };
  }

  const user = await getSetupUserById(userId);
  const firstName = user?.first_name?.trim() || "there";
  const spoken = withCurrentGreeting(row.script, firstName, istHour());
  if (spoken !== row.script) {
    await prisma.dailyBriefing.update({
      where: { id: row.id },
      data: { script: spoken },
    });
  }

  const ttsUrl = resolveTtsUrl();
  try {
    const res = await fetch(ttsUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: spoken,
        session_id: `briefing-${userId}-${briefingDate}-h${istHour()}`,
        language: "en-IN",
      }),
      signal: AbortSignal.timeout(45_000),
    });
    const raw = Buffer.from(await res.arrayBuffer());
    if (!res.ok) {
      const errText = raw.subarray(0, 400).toString("utf8");
      console.error("tts proxy failed", res.status, errText);
      return { ok: false, error: "Voice briefing is unavailable.", status: 502 };
    }
    const audio = extractTtsAudio(raw, res.headers.get("content-type"));
    if (!audio) {
      console.error("tts proxy: unrecognized body", raw.subarray(0, 80).toString("utf8"));
      return { ok: false, error: "Voice briefing is unavailable.", status: 502 };
    }
    return { ok: true, buffer: audio.buffer, contentType: audio.contentType };
  } catch (err) {
    console.error("tts proxy error", err);
    return { ok: false, error: "Voice briefing is unavailable.", status: 502 };
  }
}

function pcmSampleRate(): number {
  const n = Number.parseInt(process.env.TTS_PCM_SAMPLE_RATE || "22050", 10);
  return Number.isFinite(n) && n >= 8000 && n <= 48_000 ? n : 22050;
}

function wrapRawTtsPcm(raw: Buffer, headerType: string | null): Buffer {
  if (looksLikeWav(raw) || looksLikeMpeg(raw) || looksLikeOgg(raw)) return raw;
  const type = (headerType || "").toLowerCase();
  if (
    type.includes("wav") ||
    type.includes("pcm") ||
    type.includes("l16") ||
    (raw.length > 64 && raw.length % 2 === 0 && raw[0] !== 0x7b)
  ) {
    return pcm16leMonoToWav(raw, pcmSampleRate());
  }
  return raw;
}

function extractTtsAudio(
  raw: Buffer,
  headerType: string | null,
): { buffer: Buffer; contentType: string } | null {
  if (looksLikeWav(raw)) return { buffer: raw, contentType: "audio/wav" };
  if (looksLikeMpeg(raw)) return { buffer: raw, contentType: "audio/mpeg" };
  if (looksLikeOgg(raw)) return { buffer: raw, contentType: "audio/ogg" };

  const trimmed = raw.toString("utf8").trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const json = JSON.parse(trimmed) as Record<string, unknown>;
      const b64 = firstBase64Field(json);
      if (b64) {
        const decoded = Buffer.from(b64, "base64");
        const wrapped = wrapRawTtsPcm(decoded, headerType);
        if (looksLikeWav(wrapped)) {
          return { buffer: wrapped, contentType: "audio/wav" };
        }
        if (looksLikeMpeg(wrapped)) {
          return { buffer: wrapped, contentType: "audio/mpeg" };
        }
        return { buffer: wrapped, contentType: "audio/wav" };
      }
    } catch {
      return null;
    }
  }

  if (raw.length > 16) {
    const wrapped = wrapRawTtsPcm(raw, headerType);
    return {
      buffer: wrapped,
      contentType: looksLikeMpeg(wrapped) ? "audio/mpeg" : "audio/wav",
    };
  }
  return null;
}

function firstBase64Field(json: Record<string, unknown>): string | null {
  for (const key of ["audio", "audio_base64", "audioContent", "wav", "data", "speech"]) {
    const value = json[key];
    if (typeof value === "string" && value.length > 80) {
      return value.replace(/^data:audio\/[^;]+;base64,/, "");
    }
  }
  return null;
}

function looksLikeWav(buf: Buffer): boolean {
  return buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF";
}

function looksLikeMpeg(buf: Buffer): boolean {
  if (buf.length < 3) return false;
  if (buf.toString("ascii", 0, 3) === "ID3") return true;
  return buf[0] === 0xff && (buf[1]! & 0xe0) === 0xe0;
}

function looksLikeOgg(buf: Buffer): boolean {
  return buf.length >= 4 && buf.toString("ascii", 0, 4) === "OggS";
}
