/**
 * Chrome web push previews — Android/iOS lock screen + Windows/macOS system banners.
 */

import type { ReactNode } from "react";
import type { CampaignTemplate, TemplatePreviewMeta } from "@/lib/campaign-templates";
import { resolveTemplatePreviewImage } from "@/lib/template-preview-images";
import type { TemplateFields } from "@/components/campaigns/ChannelTemplatePreview";

const PREVIEW_DOMAIN = "www.worktual.com";
const WORKTUAL_ICON = "/brand/worktual-logo.png";

export type WebPushPreviewContent = {
  title: string;
  body: string;
  cta?: string;
  domain: string;
  iconSrc: string;
  imageSrc?: string | null;
};

function previewMergeTags(value: string): string {
  return value.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, key: string) => {
    const lower = String(key).toLowerCase();
    if (lower === "first_name" || lower === "firstname") return "Alex";
    return "";
  });
}

export function resolveWebPushContent(
  fields?: TemplateFields | null,
  meta?: TemplatePreviewMeta | null,
  template?: Pick<CampaignTemplate, "previewImage" | "preview"> | null,
): WebPushPreviewContent {
  const title = previewMergeTags(
    String(fields?.title || meta?.headline || "Special Offer Just for You!").trim(),
  );
  const body = previewMergeTags(
    String(fields?.body || meta?.body || "").trim() ||
      "Get up to 30% off on all telecom plans. Limited-time deal!",
  );
  const cta = previewMergeTags(
    String(fields?.cta_label || meta?.cta || "").trim(),
  );
  const fieldImage = String(fields?.image_url || fields?.header_image || "").trim();
  const imageSrc =
    (fieldImage.startsWith("http") ? fieldImage : null) ||
    resolveTemplatePreviewImage(
      template || {
        previewImage: fieldImage || null,
        preview: meta || null,
      },
    );
  return {
    title,
    body,
    cta: cta || undefined,
    domain: PREVIEW_DOMAIN,
    iconSrc: WORKTUAL_ICON,
    imageSrc,
  };
}

function ChromeMark({ className = "size-3.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden>
      <circle cx="24" cy="24" r="22" fill="#fff" />
      <path fill="#EA4335" d="M24 2a22 22 0 0 1 19.05 11H24z" />
      <path fill="#FBBC04" d="M43.05 13A22 22 0 0 1 36 41.05L24 24z" />
      <path fill="#34A853" d="M36 41.05A22 22 0 0 1 4.95 13H24z" />
      <path fill="#4285F4" d="M4.95 13A22 22 0 0 1 24 2l0 22z" />
      <circle cx="24" cy="24" r="9" fill="#fff" />
      <circle cx="24" cy="24" r="6.5" fill="#4285F4" />
    </svg>
  );
}

function WorktualPushIcon({ compact }: { compact?: boolean }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-lg bg-[#2563eb] ${
        compact ? "size-5" : "size-7"
      }`}
    >
      <img
        src={WORKTUAL_ICON}
        alt=""
        className={`object-contain ${compact ? "size-3.5 p-0.5" : "size-5 p-0.5"}`}
      />
    </span>
  );
}

function PushThumbnail({
  src,
  compact,
}: {
  src?: string | null;
  compact?: boolean;
}) {
  if (!src) return null;
  return (
    <img
      src={src}
      alt=""
      className={`shrink-0 rounded-md object-cover ${
        compact ? "size-7" : "size-10"
      }`}
    />
  );
}

function WebPushNotificationBody({
  content,
  shell,
  compact,
}: {
  content: WebPushPreviewContent;
  shell: "android" | "ios" | "windows" | "macos";
  compact?: boolean;
}) {
  const isDark = shell === "windows";
  const textPrimary = isDark ? "text-white" : "text-neutral-900";
  const textSecondary = isDark ? "text-neutral-300" : "text-neutral-600";
  const textMuted = isDark ? "text-neutral-400" : "text-neutral-500";
  const titleSize = compact ? "text-[8px]" : "text-[11px]";
  const bodySize = compact ? "text-[7px]" : "text-[10px]";
  const headerSize = compact ? "text-[6px]" : "text-[9px]";

  return (
    <>
      <div
        className={`flex items-center gap-1 ${headerSize} ${textMuted} ${
          shell === "ios" ? "justify-between" : ""
        }`}
      >
        <div className="flex min-w-0 items-center gap-1">
          <ChromeMark className={compact ? "size-2.5" : "size-3.5"} />
          <span className="font-medium">
            {shell === "windows" ? "Google Chrome" : "Chrome"}
          </span>
          {shell === "android" ? (
            <>
              <span>·</span>
              <span className="truncate">{content.domain}</span>
              <span>·</span>
              <span>now</span>
              <span aria-hidden>🔔</span>
            </>
          ) : null}
        </div>
        {shell === "ios" || shell === "macos" ? (
          <span className="shrink-0">now</span>
        ) : null}
        {shell === "windows" ? (
          <span className="ml-auto shrink-0 tracking-widest">⋯ ✕</span>
        ) : null}
      </div>
      <div className={`mt-1 flex items-start gap-1.5 ${shell === "windows" ? "mt-1.5" : ""}`}>
        {shell !== "macos" ? <WorktualPushIcon compact={compact} /> : null}
        <div className="min-w-0 flex-1">
          <p className={`font-semibold leading-snug ${titleSize} ${textPrimary}`}>
            {content.title}
          </p>
          <p className={`mt-0.5 line-clamp-2 leading-snug ${bodySize} ${textSecondary}`}>
            {content.body}
            {content.cta ? (
              <span className={`ml-1 font-medium ${isDark ? "text-sky-300" : "text-[#2563eb]"}`}>
                {content.cta}
              </span>
            ) : null}
          </p>
          {shell === "windows" || shell === "macos" ? (
            <p className={`mt-0.5 ${compact ? "text-[6px]" : "text-[9px]"} ${textMuted}`}>
              {content.domain}
            </p>
          ) : null}
        </div>
        <PushThumbnail src={content.imageSrc} compact={compact} />
      </div>
    </>
  );
}

function GalleryPhoneFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full w-full items-stretch justify-center bg-white p-0">
      <div className="relative flex h-full w-full flex-col overflow-hidden rounded-[1.4rem] border-[3px] border-neutral-900 bg-black shadow-lg">
        <div className="relative z-10 flex shrink-0 items-center justify-between px-2.5 pt-1 pb-0.5 text-white">
          <span className="text-[7px] font-semibold">9:41</span>
          <div className="absolute top-1 left-1/2 h-2 w-10 -translate-x-1/2 rounded-full bg-neutral-900" />
          <div className="flex items-center gap-0.5 text-[7px] text-white/80">
            <span>●●</span>
            <span className="ml-0.5 inline-block h-1.5 w-3 rounded-[1px] border border-white/70" />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
      </div>
    </div>
  );
}

function AndroidChromeLockScreen({
  content,
  compact,
}: {
  content: WebPushPreviewContent;
  compact?: boolean;
}) {
  return (
    <div
      className="relative flex h-full flex-col bg-[#f3f4f6]"
    >
      <div className="relative flex min-h-0 flex-1 flex-col justify-center px-2 py-3">
        <div
          className={`rounded-2xl bg-white shadow-lg ${
            compact ? "mx-1.5 px-2 py-1.5" : "mx-3 px-3 py-2.5"
          }`}
        >
          <WebPushNotificationBody content={content} shell="android" compact={compact} />
        </div>
      </div>
      <p className="relative pb-2 text-center text-[7px] text-neutral-500">
        Swipe up to unlock ↑
      </p>
    </div>
  );
}

function IosChromeLockScreen({
  content,
  compact,
}: {
  content: WebPushPreviewContent;
  compact?: boolean;
}) {
  return (
    <div
      className="relative flex h-full flex-col"
      style={{
        background:
          "linear-gradient(180deg, #f97316 0%, #ec4899 28%, #7c3aed 58%, #2563eb 100%)",
      }}
    >
      <div className="pointer-events-none absolute inset-0 overflow-hidden opacity-40">
        <div className="absolute top-8 left-4 size-20 rounded-full bg-orange-200/40 blur-2xl" />
        <div className="absolute bottom-16 right-2 size-24 rounded-full bg-violet-300/30 blur-2xl" />
      </div>
      <div className="relative px-3 pt-2 text-center text-white">
        <p className="text-[16px] font-light leading-none tracking-tight">9:41</p>
        <p className="mt-0.5 text-[7px] font-medium opacity-90">Monday, 8 September</p>
      </div>
      <div className="relative mx-2 mt-3 mb-8">
        <div
          className={`rounded-2xl border border-white/30 bg-white/70 shadow-lg backdrop-blur-xl ${
            compact ? "px-2 py-1.5" : "px-3 py-2.5"
          }`}
        >
          <WebPushNotificationBody content={content} shell="ios" compact={compact} />
        </div>
      </div>
    </div>
  );
}

function Windows11NotificationShell({
  content,
  compact,
  centered = false,
}: {
  content: WebPushPreviewContent;
  compact?: boolean;
  /** Gallery system preview — toast in the middle of the desktop frame. */
  centered?: boolean;
}) {
  return (
    <div
      className="relative flex h-full min-h-[12rem] flex-col overflow-hidden"
      style={{
        background:
          "linear-gradient(160deg, #0a1628 0%, #132743 45%, #1a365d 100%)",
      }}
    >
      <div className="pointer-events-none absolute inset-0 opacity-30">
        <div className="absolute bottom-0 left-0 h-1/2 w-full bg-gradient-to-t from-blue-900/40 to-transparent" />
      </div>
      <div
        className={
          centered
            ? "relative flex min-h-0 flex-1 items-center justify-center px-4 py-6"
            : "relative mt-auto mb-8 flex justify-end px-2"
        }
      >
        <div
          className={`rounded-lg border border-white/10 bg-[#2d2d2d]/95 shadow-2xl ${
            compact
              ? "w-[88%] px-2 py-1.5"
              : centered
                ? "w-full max-w-[min(100%,20rem)] px-3 py-2.5"
                : "w-full max-w-[240px] px-3 py-2.5"
          }`}
        >
          <WebPushNotificationBody
            content={content}
            shell="windows"
            compact={compact}
          />
        </div>
      </div>
      <div className="relative mt-auto flex h-6 shrink-0 items-center justify-between bg-black/40 px-2 backdrop-blur-md">
        <span className="inline-flex size-3 items-center justify-center rounded-sm bg-sky-500/80 text-[6px] text-white">
          ⊞
        </span>
        <span className="text-[6px] text-white/80">9:41 AM · Mon, Sep 8</span>
      </div>
    </div>
  );
}

function MacOsNotificationShell({
  content,
  compact,
}: {
  content: WebPushPreviewContent;
  compact?: boolean;
}) {
  return (
    <div
      className="relative flex h-full flex-col overflow-hidden"
      style={{
        background:
          "linear-gradient(180deg, #fdba74 0%, #f97316 18%, #6366f1 55%, #0ea5e9 100%)",
      }}
    >
      <div className="relative flex h-5 shrink-0 items-center justify-end gap-1.5 px-2 text-[7px] text-white/90">
        <span>Mon 9 Sep</span>
        <span className="font-medium">9:41 AM</span>
      </div>
      <div className="relative flex justify-end px-2 pt-1">
        <div
          className={`rounded-xl bg-white shadow-xl ${
            compact ? "w-[88%] px-2 py-1.5" : "w-full max-w-[220px] px-3 py-2.5"
          }`}
        >
          <WebPushNotificationBody content={content} shell="macos" compact={compact} />
        </div>
      </div>
      <div className="relative mt-auto mb-2 flex justify-center gap-1 px-3">
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className="size-4 rounded-md bg-white/25 backdrop-blur-sm"
          />
        ))}
      </div>
    </div>
  );
}

function PreviewPill({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="mx-auto inline-flex items-center gap-1 rounded-full border border-neutral-200 bg-white px-2 py-0.5 text-[9px] font-medium text-neutral-600 shadow-sm">
        {label}
      </span>
      {children}
    </div>
  );
}

export function GalleryWebPushPhonePreview({
  fields,
  template,
}: {
  fields?: TemplateFields | null;
  template?: CampaignTemplate | null;
}) {
  const content = resolveWebPushContent(
    fields,
    template?.preview || null,
    template,
  );
  return (
    <GalleryPhoneFrame>
      <AndroidChromeLockScreen content={content} compact />
    </GalleryPhoneFrame>
  );
}

export function GalleryWebPushSystemPreview({
  fields,
  template,
}: {
  fields?: TemplateFields | null;
  template?: CampaignTemplate | null;
}) {
  const content = resolveWebPushContent(
    fields,
    template?.preview || null,
    template,
  );
  return (
    <div className="h-full w-full min-h-0">
      <Windows11NotificationShell content={content} centered />
    </div>
  );
}

export function WebPushPreviewGrid({
  fields,
  template,
  compact,
}: {
  fields?: TemplateFields | null;
  template?: CampaignTemplate | null;
  compact?: boolean;
}) {
  const content = resolveWebPushContent(
    fields,
    template?.preview || null,
    template,
  );
  return (
    <div className="grid w-full gap-3 sm:grid-cols-2">
      <PreviewPill label="Android – Chrome">
        <div
          className={`mx-auto overflow-hidden rounded-[1.25rem] border-[2px] border-neutral-800 ${
            compact ? "h-44 w-[9.5rem]" : "h-56 w-56"
          }`}
        >
          <AndroidChromeLockScreen content={content} compact={compact} />
        </div>
      </PreviewPill>
      <PreviewPill label="Windows – System Preview">
        <div
          className={`overflow-hidden rounded-lg border border-neutral-200 ${
            compact ? "h-36" : "h-44"
          }`}
        >
          <Windows11NotificationShell content={content} compact={compact} />
        </div>
      </PreviewPill>
    </div>
  );
}
