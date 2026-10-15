import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bold,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Heart,
  ImagePlus,
  Italic,
  Library,
  Lightbulb,
  Link2,
  List,
  MessageCircle,
  MoreHorizontal,
  RefreshCw,
  Save,
  Search,
  Send,
  Share2,
  Sparkles,
  ThumbsUp,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { DateTimeLocalInput } from "@/components/ui/DateTimeLocalInput";
import {
  WORKTUAL_HAIRLINE,
  WORKTUAL_HEADER_CONTROL,
  WORKTUAL_ICON_BUTTON,
} from "@/lib/worktual-control-tokens";
import {
  deleteSeoContent,
  deleteSeoSocialPost,
  fetchSeoContent,
  fetchSeoKeywords,
  fetchSeoSocial,
  fetchSeoSocialConnections,
  generateSeoSocialPosts,
  patchSeoSocialPost,
  publishSeoSocialPost,
  scheduleSeoSocialPost,
  saveSeoKeyword,
  type SeoKeywordRow,
  type SeoSocialConnection,
  type SeoSocialPost,
} from "@/services/seo";
import { ConfirmDeleteButton } from "@/components/ui/ConfirmDeleteButton";
import {
  SEO_AGENT_PROMPT_EVENT,
  SEO_CUSTOMIZE_EVENT,
  SEO_UI_EVENT,
  askDigitalMarketingAgent,
  type SeoAgentPromptDetail,
  type SeoCustomizeEventDetail,
  type SeoUiEventDetail,
} from "./digital-marketing-events";

export {
  SEO_AGENT_PROMPT_EVENT,
  SEO_CUSTOMIZE_EVENT,
  SEO_UI_EVENT,
  askDigitalMarketingAgent,
};
export type {
  SeoAgentPromptDetail,
  SeoCustomizeEventDetail,
  SeoUiEventDetail,
};

type WorkspaceTab = "keywords" | "content" | "social" | "library";
type SocialPlatform = "linkedin" | "facebook" | "instagram";
type LibraryView = "articles" | "posts";

/** Max posts shown per platform (matches generate batch size). */
const PLATFORM_POST_CAP: Record<SocialPlatform, number> = {
  linkedin: 3,
  facebook: 3,
  instagram: 3,
};

function limitPlatformPosts(
  posts: SeoSocialPost[],
  platform: SocialPlatform,
): SeoSocialPost[] {
  const cap = PLATFORM_POST_CAP[platform];
  const published = posts.filter((post) => post.status === "published");
  const drafts = posts.filter((post) => post.status !== "published");
  const pickedIds = new Set([
    ...published.map((post) => post.id),
    ...drafts.slice(0, Math.max(0, cap - published.length)).map((post) => post.id),
  ]);
  return posts.filter((post) => pickedIds.has(post.id));
}

type Keyword = {
  term: string;
  volume?: number;
  difficulty?: string;
  primary?: boolean;
};

type SocialPost = { id: string; text: string };
type FaqItem = { q: string; a: string };

export type ContentPackage = {
  id: string;
  title: string;
  slug: string;
  createdAt: string;
  contentType: string;
  imageUrl: string;
  keywords: Keyword[];
  blog: {
    title: string;
    metaTitle: string;
    metaDescription: string;
    toc: string[];
    markdown: string;
  };
  social: Record<string, SocialPost[]>;
  email: { subject: string; body: string };
  youtubeScript: string;
  faq: FaqItem[];
  keywordQueryId?: string;
  primaryKeyword?: string;
};

const SOCIAL_TABS: { id: SocialPlatform; label: string }[] = [
  { id: "instagram", label: "Instagram" },
  { id: "facebook", label: "Facebook" },
  { id: "linkedin", label: "LinkedIn" },
];

const CONTENT_TYPES: { id: string; label: string }[] = [
  { id: "blog", label: "Blog Article" },
  { id: "product", label: "Product description" },
  { id: "ad", label: "Ad copy" },
  { id: "email", label: "Email" },
];

const PLATFORM_CHAR_LIMIT: Record<SocialPlatform, number> = {
  instagram: 2200,
  facebook: 63206,
  linkedin: 3000,
};

const HERO_IMAGE = "/content-marketing/hero-chatbot.svg";
const BRAND_MARK = "/brand/worktual-logo.png";
const BTN =
  "inline-flex h-[38px] items-center gap-1.5 rounded-lg border-[0.6px] border-[#bfbfbf] bg-white px-3 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-40";

const EMPTY_PACKAGE: ContentPackage = {
  id: "",
  title: "",
  slug: "",
  createdAt: "",
  contentType: "package",
  imageUrl: HERO_IMAGE,
  keywords: [],
  blog: {
    title: "",
    metaTitle: "",
    metaDescription: "",
    toc: [],
    markdown: "",
  },
  social: { linkedin: [], facebook: [], instagram: [] },
  email: { subject: "", body: "" },
  youtubeScript: "",
  faq: [],
};

function copyText(text: string) {
  void navigator.clipboard?.writeText(text);
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

function asString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function parseKeywords(raw: unknown): Keyword[] {
  if (!Array.isArray(raw)) return [];
  const keywords: Keyword[] = [];
  raw.forEach((item, i) => {
    const rec = asRecord(item);
    const term = asString(rec.term || rec.keyword || rec.phrase);
    if (!term) return;
    const volume =
      typeof rec.volume === "number" ? rec.volume : Number(rec.searchVolume);
    keywords.push({
      term,
      volume: Number.isFinite(volume) ? volume : undefined,
      difficulty: asString(rec.difficulty) || undefined,
      primary: Boolean(rec.primary) || i === 0,
    });
  });
  return keywords;
}

function parsePosts(raw: unknown): SocialPost[] {
  if (!Array.isArray(raw)) {
    const text = asString(raw);
    return text ? [{ id: "p1", text }] : [];
  }
  return raw.map((item, i) => {
    if (typeof item === "string") return { id: `p${i}`, text: item };
    const rec = asRecord(item);
    return {
      id: asString(rec.id) || `p${i}`,
      text: asString(rec.text || rec.body || rec.caption),
    };
  });
}

function parseFaq(raw: unknown): FaqItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      const rec = asRecord(item);
      const q = asString(rec.q || rec.question);
      const a = asString(rec.a || rec.answer);
      return q ? { q, a } : null;
    })
    .filter((x): x is FaqItem => Boolean(x));
}

export function normalizeContentPackage(
  raw: Record<string, unknown> | null | undefined,
  fallback: ContentPackage = EMPTY_PACKAGE,
): ContentPackage {
  if (!raw) return fallback;
  const body = asRecord(raw.body ?? raw);
  const blogRec = asRecord(body.blog);
  const socialRec = asRecord(body.social);
  const emailRec = asRecord(body.email);
  const markdown =
    asString(blogRec.markdown) ||
    asString(body.markdown) ||
    asString(body.content);
  const title =
    asString(raw.title) || asString(blogRec.title) || fallback.title;
  const tocRaw = blogRec.toc ?? body.toc;
  const toc = Array.isArray(tocRaw)
    ? tocRaw.map((t) => asString(t)).filter(Boolean)
    : [];
  const social: Record<string, SocialPost[]> = {
    linkedin: parsePosts(socialRec.linkedin),
    facebook: parsePosts(socialRec.facebook),
    instagram: parsePosts(socialRec.instagram),
  };
  return {
    id: asString(raw.id) || fallback.id,
    title,
    slug: asString(raw.slug) || asString(body.slug) || fallback.slug,
    createdAt:
      asString(raw.createdAt) ||
      asString(raw.updatedAt) ||
      fallback.createdAt,
    contentType: asString(raw.contentType) || "package",
    imageUrl: asString(raw.imageUrl) || fallback.imageUrl || HERO_IMAGE,
    keywords: parseKeywords(body.keywords ?? body.keywordsUsed),
    blog: {
      title,
      metaTitle: asString(blogRec.metaTitle) || asString(body.metaTitle),
      metaDescription:
        asString(blogRec.metaDescription) || asString(body.metaDescription),
      toc,
      markdown,
    },
    social,
    email: {
      subject: asString(emailRec.subject) || asString(body.emailSubject),
      body: asString(emailRec.body) || asString(body.emailBody),
    },
    youtubeScript: asString(body.youtubeScript),
    faq: parseFaq(body.faq ?? body.faqs),
    keywordQueryId: asString(raw.keywordQueryId) || undefined,
    primaryKeyword: asString(raw.primaryKeyword) || undefined,
  };
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function startOfLocalDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Group label for Saved lists: Today / Yesterday / 15 Sept 2026 */
function dateGroupLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Earlier";
  const day = startOfLocalDay(d);
  const today = startOfLocalDay(new Date());
  const yesterday = today - 24 * 60 * 60 * 1000;
  if (day === today) return "Today";
  if (day === yesterday) return "Yesterday";
  return formatDate(iso) || "Earlier";
}

function dateGroupKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "unknown";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function socialStatusLabel(status: string): string {
  if (status === "published") return "Live";
  if (status === "scheduled") return "Scheduled";
  return "Draft";
}

function socialStatusPillClass(status: string): string {
  if (status === "published") return "bg-[#e8f8ef] text-[#0e8f50]";
  if (status === "scheduled") return "bg-[#e8f1fc] text-[#2563eb]";
  return "bg-[#fff8e8] text-[#b45309]";
}

function formatNum(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString();
}

function intentLabel(intent?: string | null): string {
  const value = (intent || "").trim();
  if (!value) return "—";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function intentPillClass(intent?: string | null): string {
  const value = (intent || "").toLowerCase();
  if (value.includes("transact")) return "bg-[#e8f8ef] text-[#0e8f50]";
  if (value.includes("inform")) return "bg-[#e8f1fc] text-[#2563eb]";
  if (value.includes("commerc")) return "bg-[#fff8e8] text-[#b45309]";
  if (value.includes("navig")) return "bg-neutral-100 text-neutral-600";
  return "bg-neutral-100 text-neutral-600";
}

function trendLevel(volume?: number | null): number {
  if (volume == null || !Number.isFinite(volume) || volume <= 0) return 0;
  if (volume >= 10000) return 4;
  if (volume >= 5000) return 3;
  if (volume >= 1000) return 2;
  return 1;
}

function TrendBars({ volume }: { volume?: number | null }) {
  const level = trendLevel(volume);
  return (
    <span
      className="inline-flex items-end gap-0.5"
      aria-label={`Trend ${level} of 4`}
    >
      {[1, 2, 3, 4].map((i) => (
        <span
          key={i}
          className={`w-1 rounded-sm ${i <= level ? "bg-neutral-900" : "bg-neutral-200"}`}
          style={{ height: 6 + i * 3 }}
        />
      ))}
    </span>
  );
}

function extractHashtags(text: string): string[] {
  return Array.from(
    new Set((text.match(/#[\p{L}\p{N}_]+/gu) ?? []).filter(Boolean)),
  );
}

function formatHashtag(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
}

function postHashtags(post: SeoSocialPost | null, caption: string): string[] {
  if (post) {
    const copy = asRecord(post.copy);
    if (Array.isArray(copy.hashtags)) {
      const fromCopy = copy.hashtags
        .map((h) => formatHashtag(String(h)))
        .filter(Boolean);
      if (fromCopy.length) return fromCopy;
    }
  }
  return extractHashtags(caption);
}

function postTone(post: SeoSocialPost | null): string {
  if (!post) return "—";
  const copy = asRecord(post.copy);
  return asString(copy.tone) || "Engaging";
}

function contentTypeLabel(id: string): string {
  if (!id || id === "package") return "Blog article";
  return CONTENT_TYPES.find((item) => item.id === id)?.label ?? "Blog article";
}

function wordCount(text: string): number {
  const plain = plainFromMarkdown(text);
  return plain ? plain.split(/\s+/).length : 0;
}

function readMinutes(text: string): number {
  return Math.max(1, Math.round(wordCount(text) / 200));
}

function postCaption(post: SeoSocialPost): string {
  const copy = asRecord(post.copy);
  return asString(copy.caption || copy.text || copy.body);
}

const SOCIAL_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const SOCIAL_IMAGE_MAX_EDGE = 1600;

function postImageUrl(post: SeoSocialPost, cacheBust?: number): string {
  const copy = asRecord(post.copy);
  const embedded = asString(copy.imageDataUrl || copy.imageUrl);
  if (embedded) return embedded;
  if (copy.hasImage && post.id) {
    const base = `/api/seo/social/${encodeURIComponent(post.id)}/image`;
    return cacheBust ? `${base}?v=${cacheBust}` : base;
  }
  return "";
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      if (!result.startsWith("data:image/")) {
        reject(new Error("Not an image file."));
        return;
      }
      resolve(result);
    };
    reader.onerror = () => reject(new Error("Could not read image."));
    reader.readAsDataURL(file);
  });
}

function resizeImageDataUrl(
  dataUrl: string,
  maxEdge = SOCIAL_IMAGE_MAX_EDGE,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const longest = Math.max(img.width, img.height);
      const scale = longest > maxEdge ? maxEdge / longest : 1;
      const width = Math.max(1, Math.round(img.width * scale));
      const height = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(dataUrl);
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      try {
        resolve(canvas.toDataURL("image/jpeg", 0.88));
      } catch {
        resolve(dataUrl);
      }
    };
    img.onerror = () => reject(new Error("Could not process image."));
    img.src = dataUrl;
  });
}

async function fileToSocialImageDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Choose a JPG, PNG, WebP, or GIF image.");
  }
  if (file.size > SOCIAL_IMAGE_MAX_BYTES) {
    throw new Error("Image must be 5 MB or smaller.");
  }
  const raw = await readFileAsDataUrl(file);
  return resizeImageDataUrl(raw);
}

function toDateTimeLocalValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function defaultScheduleLocalValue(from?: string | Date | null): string {
  if (from) {
    const existing = from instanceof Date ? from : new Date(from);
    if (!Number.isNaN(existing.getTime()) && existing.getTime() > Date.now()) {
      return toDateTimeLocalValue(existing);
    }
  }
  return toDateTimeLocalValue(new Date(Date.now() + 60 * 60 * 1000));
}

function BrandAvatar() {
  return (
    <span className="relative inline-flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-neutral-900 text-xs font-semibold text-white">
      W
      <img
        src={BRAND_MARK}
        alt=""
        className="absolute inset-0 h-full w-full object-cover"
        onError={(e) => e.currentTarget.remove()}
      />
    </span>
  );
}

function PlatformGlyph({
  platform,
  className = "h-3.5 w-3.5",
}: {
  platform: SocialPlatform;
  className?: string;
}) {
  if (platform === "facebook") {
    return (
      <svg viewBox="0 0 24 24" className={className} aria-hidden fill="currentColor">
        <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.791-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
      </svg>
    );
  }
  if (platform === "instagram") {
    return (
      <svg
        viewBox="0 0 24 24"
        className={className}
        aria-hidden
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
      >
        <rect x="3" y="3" width="18" height="18" rx="5" />
        <circle cx="12" cy="12" r="4" />
        <circle cx="17.5" cy="6.5" r="0.9" fill="currentColor" stroke="none" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden fill="currentColor">
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  );
}

function postPermalink(post: SeoSocialPost): string | null {
  if (post.status !== "published") return null;
  const id = String(post.externalPostId || "").trim();
  if (!id) return null;
  if (post.platform === "linkedin") {
    return `https://www.linkedin.com/feed/update/${encodeURIComponent(id)}`;
  }
  if (post.platform === "facebook") {
    return `https://www.facebook.com/${encodeURIComponent(id)}`;
  }
  if (post.platform === "instagram") {
    return `https://www.instagram.com/p/${encodeURIComponent(id)}/`;
  }
  return null;
}

function PlatformMark({ platform }: { platform: SocialPlatform }) {
  const wrap =
    platform === "facebook"
      ? "bg-[#1877F2]"
      : platform === "instagram"
        ? "bg-gradient-to-br from-[#f58529] via-[#dd2a7b] to-[#8134af]"
        : "bg-[#0A66C2]";
  return (
    <span
      className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${wrap}`}
    >
      <PlatformGlyph platform={platform} className="h-4 w-4 text-white" />
    </span>
  );
}

function SocialChrome({
  className = "",
  platform = "linkedin",
}: {
  className?: string;
  platform?: SocialPlatform;
}) {
  if (platform === "instagram") {
    return (
      <div className={`flex items-center gap-3.5 text-neutral-800 ${className}`}>
        <Heart className="h-5 w-5" strokeWidth={1.75} />
        <MessageCircle className="h-5 w-5" strokeWidth={1.75} />
        <Send className="h-5 w-5" strokeWidth={1.75} />
      </div>
    );
  }
  return (
    <div
      className={`flex items-center gap-4 text-[13px] text-neutral-500 ${className}`}
    >
      <span className="inline-flex items-center gap-1.5">
        <ThumbsUp className="h-3.5 w-3.5" strokeWidth={1.75} />
        Like
      </span>
      <span className="inline-flex items-center gap-1.5">
        <MessageCircle className="h-3.5 w-3.5" strokeWidth={1.75} />
        Comment
      </span>
      <span className="inline-flex items-center gap-1.5">
        <Share2 className="h-3.5 w-3.5" strokeWidth={1.75} />
        Share
      </span>
    </div>
  );
}

function splitCaptionHashtags(caption: string, tags: string[]) {
  let body = caption.trim();
  for (const tag of tags) {
    body = body.split(tag).join("");
  }
  return { body: body.replace(/\s+/g, " ").trim(), tags };
}

function SocialPostPreview({
  platform,
  caption,
  imageUrl,
  hashtags,
  canChangeImage = false,
  imageUploading = false,
  onChangeImage,
}: {
  platform: SocialPlatform;
  caption: string;
  imageUrl?: string;
  hashtags: string[];
  canChangeImage?: boolean;
  imageUploading?: boolean;
  onChangeImage?: () => void;
}) {
  const { body, tags } = splitCaptionHashtags(caption, hashtags);
  const tagLine = tags.join(" ");

  const imageBlock = (aspectClass: string) => {
    const media = imageUrl ? (
      <img src={imageUrl} alt="" className={`${aspectClass} w-full object-cover`} />
    ) : (
      <div
        className={`flex ${aspectClass} items-center justify-center bg-neutral-100 text-sm text-neutral-400`}
      >
        No image yet
      </div>
    );

    if (!canChangeImage || !onChangeImage) return media;

    return (
      <button
        type="button"
        onClick={onChangeImage}
        disabled={imageUploading}
        className={`group relative block w-full overflow-hidden text-left disabled:cursor-wait ${
          imageUrl ? "" : "border-0"
        }`}
        aria-label={imageUploading ? "Uploading image" : "Change post image"}
      >
        {media}
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-neutral-950/0 transition group-hover:bg-neutral-950/45 group-focus-visible:bg-neutral-950/45">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/95 px-3 py-1.5 text-xs font-medium text-neutral-900 opacity-0 shadow-sm transition group-hover:opacity-100 group-focus-visible:opacity-100">
            <ImagePlus className="h-3.5 w-3.5" strokeWidth={1.75} />
            {imageUploading ? "Uploading…" : imageUrl ? "Change image" : "Add image"}
          </span>
        </span>
      </button>
    );
  };

  if (platform === "instagram") {
    return (
      <div className={`overflow-hidden rounded-2xl bg-white ${WORKTUAL_HAIRLINE}`}>
        <div className="flex items-center gap-2.5 px-3.5 py-3">
          <BrandAvatar />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-neutral-900">
              worktual
            </p>
          </div>
          <MoreHorizontal className="h-4 w-4 text-neutral-400" />
        </div>
        {imageBlock("aspect-square")}
        <div className="space-y-2 px-3.5 py-3">
          <SocialChrome platform="instagram" />
          <p className="text-sm font-semibold text-neutral-900">124 likes</p>
          <p className="text-sm leading-6 text-neutral-800">
            <span className="font-semibold">worktual</span> {body || caption}
          </p>
          {tagLine ? (
            <p className="text-sm leading-6 text-[#2563eb]">{tagLine}</p>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className={`overflow-hidden rounded-2xl bg-white ${WORKTUAL_HAIRLINE}`}>
      <div className="flex items-center gap-2.5 px-3.5 pt-3.5">
        <PlatformMark platform={platform} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-neutral-900">Worktual</p>
          <p className="text-[11px] text-neutral-400">Just now</p>
        </div>
      </div>
      <p className="whitespace-pre-wrap px-3.5 pt-3 text-sm leading-6 text-neutral-800">
        {body || caption || "Select a post to preview."}
      </p>
      {tagLine ? (
        <p className="px-3.5 pt-1 text-sm leading-6 text-[#2563eb]">{tagLine}</p>
      ) : null}
      {imageUrl || canChangeImage ? (
        <div className="mt-3">{imageBlock("aspect-[16/10]")}</div>
      ) : null}
      <div className="mt-2 border-t border-neutral-100 px-3.5 py-3">
        <SocialChrome platform={platform} />
      </div>
    </div>
  );
}

function normalizeHeading(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function stripDuplicateLeadingTitle(markdown: string, title: string): string {
  const want = normalizeHeading(title);
  if (!want) return markdown.trim();
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  let stripped = 0;
  while (i < lines.length && stripped < 2) {
    const raw = lines[i].trim();
    if (!raw) {
      i += 1;
      continue;
    }
    const text = raw.replace(/^#{1,6}\s+/, "").trim();
    if (normalizeHeading(text) !== want) break;
    i += 1;
    stripped += 1;
  }
  return lines.slice(i).join("\n").trim();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderInlineMarkdown(text: string): string {
  return escapeHtml(text)
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      '<a href="$2" rel="noreferrer" class="text-[#2563eb] underline">$1</a>',
    )
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/(^|[\s(])_([^_]+)_/g, "$1<em>$2</em>");
}

function markdownToHtml(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const html: string[] = [];
  let i = 0;
  while (i < lines.length) {
    while (i < lines.length && !lines[i].trim()) i += 1;
    if (i >= lines.length) break;
    const line = lines[i];
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      const depth = heading[1].length;
      const tag = depth === 1 ? "h1" : depth === 2 ? "h2" : "h3";
      const className =
        depth === 1
          ? "text-xl font-semibold tracking-tight text-neutral-900"
          : depth === 2
            ? "pt-1 text-lg font-semibold text-neutral-900"
            : "pt-1 text-base font-semibold text-neutral-900";
      html.push(
        `<${tag} class="${className}">${renderInlineMarkdown(heading[2].trim())}</${tag}>`,
      );
      i += 1;
      continue;
    }
    if (line.trim().startsWith("- ")) {
      const items: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("- ")) {
        items.push(renderInlineMarkdown(lines[i].replace(/^\s*-\s+/, "")));
        i += 1;
      }
      html.push(
        `<ul class="list-disc space-y-1.5 pl-5">${items
          .map((item) => `<li>${item}</li>`)
          .join("")}</ul>`,
      );
      continue;
    }
    if (/^\d+\.\s+/.test(line.trim())) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(renderInlineMarkdown(lines[i].replace(/^\s*\d+\.\s+/, "")));
        i += 1;
      }
      html.push(
        `<ol class="list-decimal space-y-1.5 pl-5">${items
          .map((item) => `<li>${item}</li>`)
          .join("")}</ol>`,
      );
      continue;
    }
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^#{1,3}\s+/.test(lines[i]) &&
      !lines[i].trim().startsWith("- ") &&
      !/^\d+\.\s+/.test(lines[i].trim())
    ) {
      para.push(lines[i].trim());
      i += 1;
    }
    html.push(
      `<p class="leading-7 text-neutral-700">${renderInlineMarkdown(para.join(" "))}</p>`,
    );
  }
  return html.join("");
}

function htmlToMarkdown(html: string): string {
  if (typeof DOMParser === "undefined") return html;
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  const root = doc.body.firstElementChild ?? doc.body;
  return serializeHtmlNode(root).replace(/\n{3,}/g, "\n\n").trim();
}

function serializeHtmlNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const el = node as HTMLElement;
  const tag = el.tagName.toLowerCase();
  const inner = Array.from(el.childNodes).map(serializeHtmlNode).join("");
  if (tag === "strong" || tag === "b") return `**${inner}**`;
  if (tag === "em" || tag === "i") return `*${inner}*`;
  if (tag === "a") {
    const href = el.getAttribute("href") || "";
    return href ? `[${inner}](${href})` : inner;
  }
  if (tag === "h1") return `\n# ${inner}\n`;
  if (tag === "h2") return `\n## ${inner}\n`;
  if (tag === "h3") return `\n### ${inner}\n`;
  if (tag === "li") return `${inner}\n`;
  if (tag === "ul") {
    return `\n${Array.from(el.children)
      .map((child) => `- ${serializeHtmlNode(child).trim()}`)
      .join("\n")}\n`;
  }
  if (tag === "ol") {
    return `\n${Array.from(el.children)
      .map((child, i) => `${i + 1}. ${serializeHtmlNode(child).trim()}`)
      .join("\n")}\n`;
  }
  if (tag === "br") return "\n";
  if (tag === "p" || tag === "div") return `\n${inner}\n`;
  return inner;
}

function plainFromMarkdown(markdown: string): string {
  return markdown
    .replace(/^#{1,3}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

const EDITOR_PROSE_CLASS =
  "[&_h1]:text-xl [&_h1]:font-semibold [&_h1]:tracking-tight [&_h1]:text-neutral-900 [&_h2]:pt-1 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-neutral-900 [&_h3]:pt-1 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-neutral-900 [&_p]:leading-7 [&_p]:text-neutral-700 [&_strong]:font-semibold [&_em]:italic [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:space-y-1.5 [&_ol]:pl-5 [&_a]:text-[#2563eb] [&_a]:underline";

function BlogMarkdown({ markdown }: { markdown: string }) {
  const html = markdownToHtml(markdown);
  if (!html) return null;
  return (
    <div
      className={`space-y-3 text-sm ${EDITOR_PROSE_CLASS}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export function ContentMarketingWorkspace() {
  const [tab, setTab] = useState<WorkspaceTab>("keywords");
  const [seed, setSeed] = useState("");
  const [seedFieldError, setSeedFieldError] = useState<string | null>(null);
  const [intent, setIntent] = useState("");
  const [keywordSearch, setKeywordSearch] = useState("");
  const [keywordRows, setKeywordRows] = useState<SeoKeywordRow[]>([]);
  const [queryId, setQueryId] = useState<string | null>(null);
  const [keywordError, setKeywordError] = useState<string | null>(null);
  const [keywordSource, setKeywordSource] = useState<"llm" | "semrush" | null>(null);
  const [savedTerms, setSavedTerms] = useState<Set<string>>(new Set());
  const [history, setHistory] = useState<ContentPackage[]>([]);
  const [pkg, setPkg] = useState<ContentPackage | null>(null);
  const [socialPosts, setSocialPosts] = useState<SeoSocialPost[]>([]);
  const [librarySocial, setLibrarySocial] = useState<SeoSocialPost[]>([]);
  const [libraryView, setLibraryView] = useState<LibraryView>("articles");
  const [socialTab, setSocialTab] = useState<SocialPlatform>("instagram");
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const [selectedTerms, setSelectedTerms] = useState<Set<string>>(new Set());
  const [rowMenu, setRowMenu] = useState<string | null>(null);
  const [contentTitle, setContentTitle] = useState("");
  const [contentBody, setContentBody] = useState("");
  const [contentType, setContentType] = useState("blog");
  const contentRef = useRef<HTMLDivElement>(null);
  const [connections, setConnections] = useState<SeoSocialConnection[]>([]);
  const [flash, setFlash] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [draftCaption, setDraftCaption] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const [schedulePickerOpen, setSchedulePickerOpen] = useState(false);
  const [scheduleAtLocal, setScheduleAtLocal] = useState(() =>
    defaultScheduleLocalValue(),
  );
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [generatingPosts, setGeneratingPosts] = useState(false);
  const [socialLoading, setSocialLoading] = useState(true);
  const [imageUploading, setImageUploading] = useState(false);
  const [imageCacheBust, setImageCacheBust] = useState(0);
  const captionRef = useRef<HTMLTextAreaElement>(null);
  const socialImageInputRef = useRef<HTMLInputElement>(null);
  const didAutoPickSocialPlatform = useRef(false);

  const flashMsg = (msg: string) => {
    setFlash(msg);
    window.setTimeout(() => setFlash(null), 2200);
  };

  const loadKeywords = useCallback(async (id?: string) => {
    try {
      const data = await fetchSeoKeywords({
        queryId: id,
        intent: intent || undefined,
        search: keywordSearch || undefined,
      });
      setQueryId(data.query?.id ?? null);
      setKeywordRows(data.rows ?? []);
      setKeywordError(data.error || data.query?.error || null);
      const rows = data.rows ?? [];
      const hasSemrush =
        data.source === "semrush" ||
        rows.some((row) => row.source === "semrush");
      const llmOnly =
        !hasSemrush &&
        (data.source === "llm" ||
          rows.some((row) => row.source === "llm_estimate"));
      setKeywordSource(
        hasSemrush ? "semrush" : llmOnly ? "llm" : rows.length ? "semrush" : null,
      );
      setSavedTerms(new Set((data.saved ?? []).map((s) => s.term.toLowerCase())));
    } catch {
      setKeywordRows([]);
      setKeywordError("Could not load keywords.");
    }
  }, [intent, keywordSearch]);

  const loadContent = useCallback(async () => {
    try {
      const data = await fetchSeoContent({ limit: 50 });
      const items = (data.items ?? []).map((row) =>
        normalizeContentPackage(row as unknown as Record<string, unknown>),
      );
      setHistory(items);
      setPkg((current) => {
        if (current?.id) {
          return items.find((item) => item.id === current.id) ?? current;
        }
        return items[0] ?? null;
      });
    } catch {
      setHistory([]);
    }
  }, []);

  const loadSocial = useCallback(async (contentId?: string) => {
    setSocialLoading(true);
    try {
      const [items, platforms] = await Promise.all([
        fetchSeoSocial(contentId ? { contentId } : undefined),
        fetchSeoSocialConnections(),
      ]);
      const rows =
        contentId && items.length === 0 ? await fetchSeoSocial() : items;
      setSocialPosts(rows);
      setConnections(platforms);
      setSelectedPostId((current) =>
        current && rows.some((row) => row.id === current)
          ? current
          : rows[0]?.id ?? null,
      );
    } catch {
      setSocialPosts([]);
    } finally {
      setSocialLoading(false);
    }
  }, []);

  const loadLibrary = useCallback(async () => {
    try {
      const [contentData, socialItems] = await Promise.all([
        fetchSeoContent({ limit: 50 }),
        fetchSeoSocial(),
      ]);
      const items = (contentData.items ?? []).map((row) =>
        normalizeContentPackage(row as unknown as Record<string, unknown>),
      );
      setHistory(items);
      setLibrarySocial(socialItems);
    } catch {
      setLibrarySocial([]);
    }
  }, []);

  useEffect(() => {
    void loadKeywords();
    void loadContent();
    void loadSocial();
  }, [loadKeywords, loadContent, loadSocial]);

  useEffect(() => {
    if (tab === "library") void loadLibrary();
  }, [tab, loadLibrary]);

  useEffect(() => {
    const onRefresh = (ev: Event) => {
      const detail = (ev as CustomEvent<SeoUiEventDetail>).detail || {};
      if (detail.seoKeywords) {
        setTab("keywords");
        void loadKeywords(asString(detail.seoKeywords.queryId) || undefined);
      }
      if (detail.seoContent) {
        const next = normalizeContentPackage(detail.seoContent);
        setPkg(next);
        setTab("content");
        void loadContent();
      }
      if (detail.seoSocial) {
        setTab("social");
        void loadSocial(asString(detail.seoSocial.contentId) || pkg?.id);
      }
      if (detail.seoProgress?.stage === "error" && detail.seoProgress.detail) {
        setNotice(detail.seoProgress.detail);
      }
    };
    window.addEventListener(SEO_UI_EVENT, onRefresh);
    return () => window.removeEventListener(SEO_UI_EVENT, onRefresh);
  }, [loadContent, loadKeywords, loadSocial, pkg?.id]);

  const visibleKeywords = useMemo(() => {
    const q = keywordSearch.trim().toLowerCase();
    return keywordRows.filter((row) => {
      if (intent && String(row.intent || "").toLowerCase() !== intent.toLowerCase()) {
        return false;
      }
      if (q && !row.term.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [intent, keywordRows, keywordSearch]);

  const platformPosts = useMemo(
    () =>
      limitPlatformPosts(
        socialPosts.filter((post) => post.platform === socialTab),
        socialTab,
      ),
    [socialPosts, socialTab],
  );
  const activePost =
    platformPosts.find((post) => post.id === selectedPostId) ??
    platformPosts[0] ??
    null;
  const platformConn = connections.find((c) => c.platform === socialTab);

  // After refresh, land once on a platform that actually has drafts.
  useEffect(() => {
    if (socialLoading || didAutoPickSocialPlatform.current) return;
    if (!socialPosts.length) return;
    didAutoPickSocialPlatform.current = true;
    const hasCurrent = socialPosts.some((post) => post.platform === socialTab);
    if (hasCurrent) return;
    const fallback = (
      ["instagram", "facebook", "linkedin"] as SocialPlatform[]
    ).find((platform) =>
      socialPosts.some((post) => post.platform === platform),
    );
    if (fallback) setSocialTab(fallback);
  }, [socialLoading, socialPosts, socialTab]);

  useEffect(() => {
    didAutoPickSocialPlatform.current = false;
  }, [pkg?.id]);

  useEffect(() => {
    setDraftCaption(activePost ? postCaption(activePost) : "");
    setScheduleAtLocal(defaultScheduleLocalValue(activePost?.scheduledAt));
    setScheduleError(null);
    setSchedulePickerOpen(false);
  }, [activePost?.id, activePost?.scheduledAt]);

  useEffect(() => {
    if (!pkg) {
      setContentTitle("");
      setContentBody("");
      setContentType("blog");
      return;
    }
    const title = pkg.blog.title || pkg.title;
    setContentTitle(title);
    setContentBody(stripDuplicateLeadingTitle(pkg.blog.markdown, title));
    setContentType(pkg.contentType || "blog");
  }, [pkg]);

  useEffect(() => {
    if (tab !== "content") return;
    const el = contentRef.current;
    if (!el) return;
    if (!pkg) {
      el.innerHTML = "";
      return;
    }
    const title = pkg.blog.title || pkg.title;
    const body = stripDuplicateLeadingTitle(pkg.blog.markdown, title);
    el.innerHTML = body ? markdownToHtml(body) : "";
  }, [tab, pkg]);

  const tabs: { id: WorkspaceTab; label: string; icon: typeof Search }[] = [
    { id: "keywords", label: "Keyword Generation", icon: Search },
    { id: "content", label: "Content Generation", icon: FileText },
    { id: "social", label: "Social Media Post", icon: Share2 },
    { id: "library", label: "Saved", icon: Library },
  ];

  const libraryArticles = useMemo(
    () =>
      [...history].sort(
        (a, b) =>
          new Date(b.createdAt || 0).getTime() -
          new Date(a.createdAt || 0).getTime(),
      ),
    [history],
  );

  const libraryPosts = useMemo(() => {
    const titleById = new Map(
      history.map((item) => [item.id, item.title || "Untitled article"]),
    );
    // Prefer live/scheduled, then newest drafts (cap so old regenerate piles stay out).
    const ranked = [...librarySocial].sort((a, b) => {
      const rank = (status: string) =>
        status === "published" ? 0 : status === "scheduled" ? 1 : 2;
      const byStatus = rank(a.status) - rank(b.status);
      if (byStatus !== 0) return byStatus;
      return (
        new Date(b.updatedAt || 0).getTime() -
        new Date(a.updatedAt || 0).getTime()
      );
    });
    const draftSeen = new Map<string, number>();
    const picked: SeoSocialPost[] = [];
    for (const post of ranked) {
      if (post.status === "published" || post.status === "scheduled") {
        picked.push(post);
        continue;
      }
      const key = `${post.contentId || ""}:${post.platform}`;
      const used = draftSeen.get(key) ?? 0;
      const cap =
        PLATFORM_POST_CAP[post.platform as SocialPlatform] ?? 3;
      if (used >= cap) continue;
      draftSeen.set(key, used + 1);
      picked.push(post);
    }
    return picked.map((post) => ({
      post,
      articleTitle: post.contentId
        ? titleById.get(post.contentId) || "Article"
        : "Article",
    }));
  }, [history, librarySocial]);

  function openLibraryContent(item: ContentPackage) {
    setPkg(item);
    void loadSocial(item.id);
    setTab("content");
  }

  function openLibraryPost(post: SeoSocialPost) {
    const article = history.find((item) => item.id === post.contentId) ?? null;
    if (article) setPkg(article);
    if (
      post.platform === "instagram" ||
      post.platform === "facebook" ||
      post.platform === "linkedin"
    ) {
      setSocialTab(post.platform);
    }
    setSelectedPostId(post.id);
    void loadSocial(post.contentId || undefined);
    setTab("social");
  }

  async function removeLibraryPost(post: SeoSocialPost) {
    if (post.status === "published") {
      return { ok: false as const, error: "Published posts cannot be deleted." };
    }
    try {
      await deleteSeoSocialPost(post.id);
      setLibrarySocial((rows) => rows.filter((row) => row.id !== post.id));
      setSocialPosts((rows) => rows.filter((row) => row.id !== post.id));
      if (selectedPostId === post.id) setSelectedPostId(null);
      flashMsg("Draft removed");
      return { ok: true as const };
    } catch (err) {
      return {
        ok: false as const,
        error: err instanceof Error ? err.message : "Could not delete post.",
      };
    }
  }

  const libraryArticleGroups = useMemo(() => {
    const groups = new Map<string, { label: string; items: ContentPackage[] }>();
    for (const item of libraryArticles) {
      const key = dateGroupKey(item.createdAt);
      const existing = groups.get(key);
      if (existing) existing.items.push(item);
      else groups.set(key, { label: dateGroupLabel(item.createdAt), items: [item] });
    }
    return [...groups.entries()]
      .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
      .map(([, group]) => group);
  }, [libraryArticles]);

  const libraryPostGroups = useMemo(() => {
    const groups = new Map<
      string,
      {
        label: string;
        items: { post: SeoSocialPost; articleTitle: string }[];
      }
    >();
    for (const row of libraryPosts) {
      const when = row.post.updatedAt || row.post.scheduledAt || "";
      const key = dateGroupKey(when);
      const existing = groups.get(key);
      if (existing) existing.items.push(row);
      else
        groups.set(key, {
          label: dateGroupLabel(when),
          items: [row],
        });
    }
    return [...groups.entries()]
      .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
      .map(([, group]) => group);
  }, [libraryPosts]);

  const activeHashtags = useMemo(
    () => postHashtags(activePost, draftCaption),
    [activePost, draftCaption],
  );
  const captionLimit = PLATFORM_CHAR_LIMIT[socialTab];
  const allVisibleSelected =
    visibleKeywords.length > 0 &&
    visibleKeywords.every((row) => selectedTerms.has(row.term));

  function toggleTerm(term: string) {
    setSelectedTerms((prev) => {
      const next = new Set(prev);
      if (next.has(term)) next.delete(term);
      else next.add(term);
      return next;
    });
  }

  function toggleAllVisible() {
    setSelectedTerms((prev) => {
      if (allVisibleSelected) {
        const next = new Set(prev);
        visibleKeywords.forEach((row) => next.delete(row.term));
        return next;
      }
      const next = new Set(prev);
      visibleKeywords.forEach((row) => next.add(row.term));
      return next;
    });
  }

  function copyKeywords() {
    const terms = (
      selectedTerms.size
        ? visibleKeywords.filter((row) => selectedTerms.has(row.term))
        : visibleKeywords
    ).map((row) => row.term);
    if (!terms.length) return;
    copyText(terms.join("\n"));
    flashMsg("Copied keywords");
  }

  function syncContentFromEditor() {
    const html = contentRef.current?.innerHTML ?? "";
    setContentBody(htmlToMarkdown(html));
  }

  function applyRichFormat(command: string, value?: string) {
    contentRef.current?.focus();
    document.execCommand(command, false, value);
    syncContentFromEditor();
  }

  function regenerateContent() {
    if (!queryId) {
      setTab("keywords");
      setNotice("Research keywords first, then create content.");
      return;
    }
    askDigitalMarketingAgent(
      `Write an SEO ${contentTypeLabel(contentType).toLowerCase()} from the latest keyword research, save it, and show it in Content Generation.`,
    );
  }

  function copyGeneratedContent() {
    const body =
      contentRef.current?.innerText.trim() || plainFromMarkdown(contentBody);
    const text = [contentTitle, body].filter(Boolean).join("\n\n");
    if (!text) return;
    copyText(text);
    flashMsg("Copied content");
  }

  function generateKeywords() {
    const topic = seed.trim();
    if (!topic) {
      setKeywordError(null);
      setNotice(null);
      setSeedFieldError(
        "Enter a seed keyword, or describe the purpose and goal for this research.",
      );
      return;
    }
    setSeedFieldError(null);
    setNotice(null);
    askDigitalMarketingAgent(
      `Find keywords for "${topic}" and show them in Keyword Generation. If this text describes a purpose or goal rather than a single keyword, derive strong keyword themes from it.`,
    );
  }

  function createContentFromKeyword(row: SeoKeywordRow) {
    if (!queryId) {
      setNotice("Research keywords first, then create content from a row.");
      return;
    }
    setTab("content");
    askDigitalMarketingAgent(
      `Write an SEO blog with primary keyword "${row.term}" from the latest keyword research, save it, and open it in Content Generation.`,
    );
  }

  async function generatePosts() {
    if (!pkg?.id) {
      setNotice("Save content first, then generate social posts from it.");
      return;
    }
    const label =
      SOCIAL_TABS.find((s) => s.id === socialTab)?.label ?? "social";
    setGeneratingPosts(true);
    setNotice(`Generating ${label} posts…`);
    try {
      const result = await generateSeoSocialPosts(pkg.id, {
        platform: socialTab,
      });
      if (!result.ok) {
        setNotice(result.error || `Could not generate ${label} posts.`);
        return;
      }
      setNotice(null);
      const n = Array.isArray(result.items) ? result.items.length : 0;
      flashMsg(
        n
          ? `Generated ${n} ${label} post${n === 1 ? "" : "s"}`
          : `${label} posts ready`,
      );
      setTab("social");
      setSelectedPostId(null);
      await loadSocial(pkg.id);
    } catch {
      setNotice(`Could not generate ${label} posts. Try again.`);
    } finally {
      setGeneratingPosts(false);
    }
  }

  async function persistCaption() {
    if (!activePost || savingDraft) return;
    setSavingDraft(true);
    setNotice(null);
    try {
      await patchSeoSocialPost(activePost.id, {
        copy: { caption: draftCaption },
      });
      const nextCopy = { ...asRecord(activePost.copy), caption: draftCaption };
      const stamp = new Date().toISOString();
      setSocialPosts((rows) =>
        rows.map((row) =>
          row.id === activePost.id
            ? { ...row, copy: nextCopy, updatedAt: stamp }
            : row,
        ),
      );
      setLibrarySocial((rows) => {
        const mapped = rows.map((row) =>
          row.id === activePost.id
            ? { ...row, copy: nextCopy, updatedAt: stamp }
            : row,
        );
        if (!mapped.some((row) => row.id === activePost.id)) {
          mapped.unshift({
            ...activePost,
            copy: nextCopy,
            updatedAt: stamp,
          });
        }
        return mapped;
      });
      flashMsg("Saved draft — see Saved → Social posts");
    } catch {
      setNotice("Could not save draft. Try again.");
    } finally {
      setSavingDraft(false);
    }
  }

  async function schedulePost() {
    if (!activePost || scheduling) return;
    if (!schedulePickerOpen) {
      setScheduleAtLocal(defaultScheduleLocalValue(activePost.scheduledAt));
      setScheduleError(null);
      setSchedulePickerOpen(true);
      return;
    }
    const postId = activePost.id;
    const when = scheduleAtLocal ? new Date(scheduleAtLocal) : null;
    if (!when || Number.isNaN(when.getTime())) {
      setScheduleError("Pick a date and time to publish.");
      return;
    }
    if (when.getTime() <= Date.now() + 60_000) {
      setScheduleError("Choose a time at least a minute from now.");
      return;
    }
    setScheduling(true);
    setScheduleError(null);
    setNotice(null);
    try {
      void patchSeoSocialPost(postId, { copy: { caption: draftCaption } }).catch(
        () => undefined,
      );
      await scheduleSeoSocialPost(postId, when);
      flashMsg(
        `Scheduled for ${when.toLocaleString(undefined, {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })}`,
      );
      setSchedulePickerOpen(false);
      void loadSocial(pkg?.id);
    } catch {
      setNotice("Could not schedule this post. Try again.");
    } finally {
      setScheduling(false);
    }
  }

  async function replaceSocialImage(file: File) {
    if (!activePost) return;
    setImageUploading(true);
    setNotice(null);
    try {
      const imageDataUrl = await fileToSocialImageDataUrl(file);
      await patchSeoSocialPost(activePost.id, {
        copy: { imageDataUrl, imageUrl: null },
      });
      setImageCacheBust(Date.now());
      flashMsg("Image updated");
      await loadSocial(pkg?.id);
    } catch (err) {
      setNotice(
        err instanceof Error ? err.message : "Could not update image. Try again.",
      );
    } finally {
      setImageUploading(false);
      if (socialImageInputRef.current) socialImageInputRef.current.value = "";
    }
  }

  async function publishNow() {
    if (!activePost) return;
    const label =
      SOCIAL_TABS.find((s) => s.id === socialTab)?.label ?? "social";
    if (platformConn && !platformConn.connected) {
      setNotice(
        platformConn.needsReauth
          ? `Reconnect ${label} in Configuration, then retry Publish.`
          : `Connect ${label} in Accounts (org OAuth) to publish. Save and schedule still work.`,
      );
      return;
    }
    setPublishing(true);
    setNotice(null);
    try {
      await persistCaption();
      const result = await publishSeoSocialPost(activePost.id);
      if (!result.ok) {
        setNotice(result.error || `Could not publish to ${label}.`);
      } else {
        flashMsg(`Published to ${label}`);
      }
      void loadSocial(pkg?.id);
    } catch {
      setNotice(`Could not publish to ${label}.`);
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-white">
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-[#bfbfbf]/80 px-5 py-4 sm:px-6">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-neutral-900">
            Digital Marketing
          </h1>
          <p className="mt-0.5 text-sm text-neutral-500">
            Create engaging content and grow your brand with AI.
          </p>
        </div>
      </div>

      <div className="shrink-0 border-b border-[#bfbfbf]/80 px-5 sm:px-6">
        <div className="flex min-w-0 gap-1 overflow-x-auto">
          {tabs.map((item) => {
            const Icon = item.icon;
            const selected = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setTab(item.id);
                  setRowMenu(null);
                }}
                className={`relative inline-flex shrink-0 items-center gap-1.5 px-3 py-3 text-sm font-medium ${
                  selected
                    ? "text-neutral-900"
                    : "text-neutral-400 hover:text-neutral-600"
                }`}
              >
                <Icon className="h-3.5 w-3.5" strokeWidth={2} />
                {item.label}
                {selected ? (
                  <span className="absolute inset-x-3 -bottom-px h-[2px] rounded-full bg-neutral-900" />
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      {flash ? (
        <div className="mx-5 mt-3 rounded-lg bg-neutral-900 px-3 py-1.5 text-xs text-white sm:mx-6">
          {flash}
        </div>
      ) : null}
      {notice ? (
        <div className={`mx-5 mt-3 px-3 py-1.5 text-xs text-neutral-700 sm:mx-6 ${WORKTUAL_HAIRLINE} rounded-lg bg-white`}>
          {notice}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-6">
        {tab === "keywords" ? (
          <div className={`overflow-hidden rounded-2xl bg-white ${WORKTUAL_HAIRLINE}`}>
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-neutral-100 px-5 py-4">
              <div>
                <h2 className="text-base font-semibold text-neutral-900">
                  Suggested Keywords
                </h2>
                <p className="mt-0.5 text-sm text-neutral-500">
                  Here are the AI-generated keywords for your business.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={generateKeywords}
                >
                  <RefreshCw className="h-[18px] w-[18px]" strokeWidth={1.75} />
                  Regenerate
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={copyKeywords}
                  disabled={visibleKeywords.length === 0}
                >
                  <Copy className="h-[18px] w-[18px]" strokeWidth={1.75} />
                  Copy All
                </Button>
              </div>
            </div>
            <div className="flex flex-col gap-2 border-b border-neutral-100 px-5 py-3">
              <div className="flex flex-wrap items-end gap-2">
                <label className="min-w-[16rem] flex-1 text-sm">
                  <span className="mb-1 block text-xs font-medium text-neutral-500">
                    Seed keyword, topic, or purpose / goal
                  </span>
                  <input
                    value={seed}
                    onChange={(e) => {
                      setSeed(e.target.value);
                      if (e.target.value.trim()) setSeedFieldError(null);
                    }}
                    placeholder="e.g. conversational chatbot — or: attract SMB buyers, goal: demo keywords"
                    aria-invalid={Boolean(seedFieldError)}
                    className={`h-[38px] w-full bg-white px-3 text-sm rounded-lg ${
                      seedFieldError
                        ? "border border-text-danger focus:outline-none focus:ring-2 focus:ring-text-danger/20"
                        : `${WORKTUAL_HAIRLINE}`
                    }`}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") generateKeywords();
                    }}
                  />
                </label>
                <Button type="button" onClick={generateKeywords}>
                  <Sparkles className="h-[18px] w-[18px]" />
                  Generate Keywords
                </Button>
                <div className="relative min-w-[12rem] flex-1">
                  <Search className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-neutral-400" />
                  <input
                    value={keywordSearch}
                    onChange={(e) => setKeywordSearch(e.target.value)}
                    placeholder="Filter table"
                    className={`h-[38px] w-full bg-white pr-3 pl-8 text-sm ${WORKTUAL_HAIRLINE} rounded-lg`}
                  />
                </div>
                <select
                  value={intent}
                  onChange={(e) => setIntent(e.target.value)}
                  className={`h-[38px] rounded-lg bg-white px-2 text-sm ${WORKTUAL_HAIRLINE}`}
                >
                  <option value="">All intents</option>
                  <option value="informational">Informational</option>
                  <option value="commercial">Commercial</option>
                  <option value="transactional">Transactional</option>
                  <option value="navigational">Navigational</option>
                </select>
              </div>
              {seedFieldError ? (
                <p className="text-xs font-medium text-text-danger" role="alert">
                  {seedFieldError}
                </p>
              ) : null}
            </div>
            {keywordError ? (
              <p className="mx-5 mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                {keywordError}
              </p>
            ) : null}
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-neutral-100 text-xs font-semibold tracking-wide text-neutral-500">
                  <tr>
                    <th className="w-10 px-4 py-3">
                      <input
                        type="checkbox"
                        checked={allVisibleSelected}
                        onChange={toggleAllVisible}
                        aria-label="Select all keywords"
                        className="size-4 rounded border-[#bfbfbf] accent-neutral-900"
                      />
                    </th>
                    <th className="px-2 py-3">#</th>
                    <th className="px-3 py-3">Keyword</th>
                    <th className="px-3 py-3">Search Intent</th>
                    <th className="px-3 py-3">Trend</th>
                    <th className="px-3 py-3">Monthly Volume</th>
                    <th className="w-12 px-3 py-3">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visibleKeywords.length === 0 ? (
                    <tr>
                      <td
                        colSpan={7}
                        className="px-4 py-12 text-center text-neutral-500"
                      >
                        {keywordError
                          ? "No keyword rows to show."
                          : "Tell the assistant about your product, or generate keywords from the seed above."}
                      </td>
                    </tr>
                  ) : (
                    visibleKeywords.map((row, index) => (
                      <tr
                        key={row.term}
                        className="border-t border-neutral-100 hover:bg-neutral-50/70"
                      >
                        <td className="px-4 py-3">
                          <input
                            type="checkbox"
                            checked={selectedTerms.has(row.term)}
                            onChange={() => toggleTerm(row.term)}
                            aria-label={`Select ${row.term}`}
                            className="size-4 rounded border-[#bfbfbf] accent-neutral-900"
                          />
                        </td>
                        <td className="px-2 py-3 tabular-nums text-neutral-400">
                          {index + 1}
                        </td>
                        <td className="px-3 py-3 font-medium text-neutral-900">
                          {row.term}
                        </td>
                        <td className="px-3 py-3">
                          {row.intent ? (
                            <span
                              className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${intentPillClass(row.intent)}`}
                            >
                              {intentLabel(row.intent)}
                            </span>
                          ) : (
                            <span className="text-neutral-400">—</span>
                          )}
                        </td>
                        <td className="px-3 py-3">
                          <TrendBars volume={row.volume} />
                        </td>
                        <td
                          className="px-3 py-3 tabular-nums text-neutral-700"
                          title={`KD ${formatNum(row.kd)} · CPC ${formatNum(row.cpc)} · Opportunity ${formatNum(row.opportunity)}`}
                        >
                          {formatNum(row.volume)}
                        </td>
                        <td className="relative px-3 py-3">
                          <button
                            type="button"
                            className={WORKTUAL_ICON_BUTTON}
                            aria-label={`Actions for ${row.term}`}
                            onClick={() =>
                              setRowMenu((open) =>
                                open === row.term ? null : row.term,
                              )
                            }
                          >
                            <MoreHorizontal className="h-[18px] w-[18px]" />
                          </button>
                          {rowMenu === row.term ? (
                            <div
                              className={`absolute top-11 right-3 z-20 w-44 overflow-hidden rounded-xl bg-white py-1 shadow-lg ${WORKTUAL_HAIRLINE}`}
                            >
                              <button
                                type="button"
                                className="block w-full px-3 py-2 text-left text-sm hover:bg-neutral-50"
                                onClick={() => {
                                  if (!queryId) return;
                                  void saveSeoKeyword({
                                    queryId,
                                    term: row.term,
                                    metrics: row as unknown as Record<
                                      string,
                                      unknown
                                    >,
                                  }).then(() => {
                                    setSavedTerms((prev) =>
                                      new Set(prev).add(row.term.toLowerCase()),
                                    );
                                    flashMsg("Saved keyword");
                                    setRowMenu(null);
                                  });
                                }}
                              >
                                {savedTerms.has(row.term.toLowerCase())
                                  ? "Saved"
                                  : "Save keyword"}
                              </button>
                              <button
                                type="button"
                                className="block w-full px-3 py-2 text-left text-sm hover:bg-neutral-50"
                                onClick={() => {
                                  setRowMenu(null);
                                  createContentFromKeyword(row);
                                }}
                              >
                                Create content
                              </button>
                              <button
                                type="button"
                                className="block w-full px-3 py-2 text-left text-sm hover:bg-neutral-50"
                                onClick={() => {
                                  copyText(row.term);
                                  flashMsg("Copied keyword");
                                  setRowMenu(null);
                                }}
                              >
                                Copy keyword
                              </button>
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <div className="flex items-start gap-2.5 border-t border-neutral-100 bg-neutral-50/80 px-5 py-3">
              <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-neutral-500" />
              <p className="text-sm text-neutral-600">
                {keywordSource === "llm"
                  ? "Use a mix of informational and transactional keywords for better reach and conversions. Volumes are LLM estimates until Semrush is enabled."
                  : "Use a mix of informational and transactional keywords for better reach and conversions."}
              </p>
            </div>
          </div>
        ) : null}

        {tab === "content" ? (
          <div className={`overflow-hidden rounded-2xl bg-white ${WORKTUAL_HAIRLINE}`}>
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-neutral-100 px-5 py-4">
              <div>
                <h2 className="text-base font-semibold text-neutral-900">
                  Generated Content
                </h2>
                <p className="mt-0.5 text-sm text-neutral-500">
                  Here&apos;s your AI-generated content. You can edit, copy, download or regenerate.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setTab("library");
                  }}
                >
                  <Library className="h-[18px] w-[18px]" strokeWidth={1.75} />
                  Saved
                </Button>
                <Button type="button" variant="secondary" onClick={regenerateContent}>
                  <RefreshCw className="h-[18px] w-[18px]" strokeWidth={1.75} />
                  Regenerate
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={copyGeneratedContent}
                  disabled={!contentBody && !contentTitle}
                >
                  <Copy className="h-[18px] w-[18px]" strokeWidth={1.75} />
                  Copy
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={!pkg?.blog.markdown}
                  onClick={() => {
                    if (!pkg) return;
                    const blob = new Blob(
                      [[contentTitle, contentBody].filter(Boolean).join("\n\n")],
                      { type: "text/markdown" },
                    );
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `${pkg.slug.replace(/\//g, "-") || "blog"}.md`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                >
                  <Download className="h-[18px] w-[18px]" strokeWidth={1.75} />
                  Download
                </Button>
              </div>
            </div>
            <div className="grid min-h-[28rem] gap-0 lg:grid-cols-[minmax(0,1.15fr)_minmax(18rem,0.85fr)]">
              <div className="flex min-h-0 flex-col border-b border-neutral-100 p-5 lg:border-r lg:border-b-0">
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={contentType}
                    onChange={(e) => setContentType(e.target.value)}
                    className={`h-[38px] rounded-lg bg-white px-2 text-sm ${WORKTUAL_HAIRLINE}`}
                  >
                    {CONTENT_TYPES.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                  {pkg && !pkg.id.startsWith("mock-") ? (
                    <button
                      type="button"
                      className={BTN}
                      onClick={() => {
                        void deleteSeoContent(pkg.id).then(() => {
                          flashMsg("Deleted");
                          void loadContent();
                        });
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete
                    </button>
                  ) : null}
                </div>
                <label className="mt-4 block text-sm">
                  <span className="mb-1 block text-xs font-medium text-neutral-500">
                    Title
                  </span>
                  <input
                    value={contentTitle}
                    onChange={(e) => setContentTitle(e.target.value)}
                    placeholder="Content title"
                    className={`h-[38px] w-full bg-white px-3 text-sm ${WORKTUAL_HAIRLINE} rounded-lg`}
                  />
                </label>
                <div className={`mt-3 flex items-center gap-0.5 rounded-lg px-1 ${WORKTUAL_HAIRLINE}`}>
                  {[
                    { label: "H1", run: () => applyRichFormat("formatBlock", "h1") },
                    { label: "H2", run: () => applyRichFormat("formatBlock", "h2") },
                    { label: "H3", run: () => applyRichFormat("formatBlock", "h3") },
                  ].map((item) => (
                    <button
                      key={item.label}
                      type="button"
                      onClick={item.run}
                      className="h-8 rounded-md px-2 text-xs font-semibold text-neutral-600 hover:bg-neutral-100"
                    >
                      {item.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => applyRichFormat("bold")}
                    className="inline-flex size-8 items-center justify-center rounded-md text-neutral-600 hover:bg-neutral-100"
                    aria-label="Bold"
                  >
                    <Bold className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => applyRichFormat("italic")}
                    className="inline-flex size-8 items-center justify-center rounded-md text-neutral-600 hover:bg-neutral-100"
                    aria-label="Italic"
                  >
                    <Italic className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => applyRichFormat("insertUnorderedList")}
                    className="inline-flex size-8 items-center justify-center rounded-md text-neutral-600 hover:bg-neutral-100"
                    aria-label="List"
                  >
                    <List className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const url = window.prompt("Link URL", "https://");
                      if (url) applyRichFormat("createLink", url);
                    }}
                    className="inline-flex size-8 items-center justify-center rounded-md text-neutral-600 hover:bg-neutral-100"
                    aria-label="Link"
                  >
                    <Link2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div
                  ref={contentRef}
                  contentEditable
                  suppressContentEditableWarning
                  role="textbox"
                  aria-multiline="true"
                  aria-label="Generated content"
                  data-placeholder="Research keywords, then create content from a row or chat."
                  onInput={syncContentFromEditor}
                  className={`mt-3 min-h-[18rem] flex-1 resize-y overflow-y-auto rounded-lg border-0 bg-transparent text-sm leading-7 text-neutral-800 outline-none empty:before:text-neutral-400 empty:before:content-[attr(data-placeholder)] ${EDITOR_PROSE_CLASS}`}
                />
                <div className="mt-2 flex items-center justify-between text-xs text-neutral-400">
                  <span>{wordCount(contentBody)} words</span>
                  <span>
                    {pkg?.createdAt
                      ? `Last saved ${formatDate(pkg.createdAt)}`
                      : "Draft"}
                  </span>
                </div>
              </div>
              <aside className="bg-neutral-50/70 p-5">
                <p className="text-sm font-semibold text-neutral-900">Preview</p>
                <p className="mt-0.5 text-xs text-neutral-500">
                  See how your content looks.
                </p>
                {contentTitle || contentBody ? (
                  <article className={`mt-4 overflow-hidden rounded-2xl bg-white ${WORKTUAL_HAIRLINE}`}>
                    {pkg?.imageUrl ? (
                      <img
                        src={pkg.imageUrl}
                        alt=""
                        className="h-36 w-full object-cover"
                      />
                    ) : null}
                    <div className="space-y-3 p-4">
                      <h3 className="text-lg font-semibold tracking-tight text-neutral-900">
                        {contentTitle || "Untitled"}
                      </h3>
                      <p className="text-xs text-neutral-400">
                        {formatDate(pkg?.createdAt || "") || "Just now"}
                        {" · "}
                        {readMinutes(contentBody)} min read
                      </p>
                      <BlogMarkdown markdown={contentBody} />
                    </div>
                  </article>
                ) : (
                  <p className={`mt-4 rounded-2xl px-4 py-16 text-center text-sm text-neutral-500 ${WORKTUAL_HAIRLINE} border-dashed bg-white`}>
                    Research keywords, then create content from a row or chat.
                  </p>
                )}
              </aside>
            </div>
          </div>
        ) : null}

        {tab === "social" ? (
          <div className={`overflow-hidden rounded-2xl bg-white ${WORKTUAL_HAIRLINE}`}>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-100 px-5 py-3">
              <div className="flex gap-1 overflow-x-auto">
                {SOCIAL_TABS.map((item) => {
                  const selected = socialTab === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setSocialTab(item.id);
                        setSelectedPostId(null);
                      }}
                      className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium ${
                        selected
                          ? "bg-neutral-900 text-white"
                          : "text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900"
                      }`}
                    >
                      <PlatformGlyph
                        platform={item.id}
                        className={`h-3.5 w-3.5 ${selected ? "text-white" : "text-neutral-500"}`}
                      />
                      {item.label}
                    </button>
                  );
                })}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => void generatePosts()}
                  disabled={!pkg?.id || generatingPosts}
                >
                  <RefreshCw className="h-[18px] w-[18px]" strokeWidth={1.75} />
                  {generatingPosts ? "Generating…" : "Regenerate"}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={!draftCaption}
                  onClick={() => {
                    copyText(draftCaption);
                    flashMsg("Copied post");
                  }}
                >
                  <Copy className="h-[18px] w-[18px]" strokeWidth={1.75} />
                  Copy All
                </Button>
              </div>
            </div>
            {platformConn && !platformConn.connected ? (
              <p className="mx-5 mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                {platformConn.needsReauth
                  ? `Reconnect ${SOCIAL_TABS.find((s) => s.id === socialTab)?.label} in Configuration. You can still save and schedule.`
                  : `Connect ${SOCIAL_TABS.find((s) => s.id === socialTab)?.label} in Accounts to publish. Save and schedule still work.`}
              </p>
            ) : null}
            {platformPosts.length > 1 ? (
              <div className="flex flex-wrap gap-1.5 px-5 pt-3">
                {platformPosts.map((post, i) => (
                  <button
                    key={post.id}
                    type="button"
                    onClick={() => setSelectedPostId(post.id)}
                    className={`rounded-full px-3 py-1 text-xs font-medium ${
                      activePost?.id === post.id
                        ? "bg-neutral-900 text-white"
                        : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
                    }`}
                  >
                    Post {i + 1}
                    {post.status === "published"
                      ? " · live"
                      : post.status === "scheduled"
                        ? " · scheduled"
                        : ""}
                  </button>
                ))}
              </div>
            ) : null}
            <div className="grid items-start gap-0 lg:grid-cols-[minmax(0,1.1fr)_minmax(18rem,0.9fr)]">
              <div className="space-y-5 border-b border-neutral-100 p-5 lg:border-r lg:border-b-0">
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-neutral-900">
                      Post Content
                    </h3>
                    <button
                      type="button"
                      className={WORKTUAL_ICON_BUTTON}
                      disabled={!draftCaption}
                      onClick={() => {
                        copyText(draftCaption);
                        flashMsg("Copied post");
                      }}
                      aria-label="Copy post"
                    >
                      <Copy className="h-[18px] w-[18px]" />
                    </button>
                  </div>
                  {socialLoading ? (
                    <p className="mt-3 text-sm text-neutral-500">Loading posts…</p>
                  ) : platformPosts.length === 0 ? (
                    <p className={`mt-3 rounded-2xl px-4 py-10 text-center text-sm text-neutral-500 ${WORKTUAL_HAIRLINE} border-dashed`}>
                      No {SOCIAL_TABS.find((s) => s.id === socialTab)?.label} posts yet.
                      Generate posts from saved content to write captions and images.
                    </p>
                  ) : (
                    <textarea
                      ref={captionRef}
                      value={draftCaption}
                      onChange={(e) => setDraftCaption(e.target.value)}
                      rows={10}
                      className={`mt-3 w-full resize-y rounded-xl bg-white px-3.5 py-3 text-sm leading-6 text-neutral-800 outline-none ${WORKTUAL_HAIRLINE}`}
                      placeholder="Write the caption…"
                    />
                  )}
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-neutral-900">
                    Post Details
                  </h3>
                  <dl className="mt-3 divide-y divide-neutral-100 text-sm">
                    <div className="flex items-center justify-between gap-3 py-2.5">
                      <dt className="text-neutral-500">Tone</dt>
                      <dd className="font-medium text-neutral-900">
                        {postTone(activePost)}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-3 py-2.5">
                      <dt className="text-neutral-500">Post Type</dt>
                      <dd className="font-medium capitalize text-neutral-900">
                        {activePost?.postType || "Promotional"}
                      </dd>
                    </div>
                    <div className="flex items-start justify-between gap-3 py-2.5">
                      <dt className="pt-0.5 text-neutral-500">Hashtags</dt>
                      <dd className="max-w-[70%] text-right font-medium text-[#2563eb]">
                        {activeHashtags.length
                          ? activeHashtags.join(" ")
                          : "—"}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-3 py-2.5">
                      <dt className="text-neutral-500">Characters</dt>
                      <dd className="tabular-nums font-medium text-neutral-900">
                        {draftCaption.length.toLocaleString()} /{" "}
                        {captionLimit.toLocaleString()}
                      </dd>
                    </div>
                  </dl>
                  {activePost && schedulePickerOpen ? (
                    <div className="mt-4 space-y-2">
                      <DateTimeLocalInput
                        label="Publish at"
                        value={scheduleAtLocal}
                        onChange={(value) => {
                          setScheduleAtLocal(value);
                          setScheduleError(null);
                        }}
                        disabled={scheduling}
                        min={toDateTimeLocalValue(new Date())}
                        error={scheduleError ?? undefined}
                      />
                      <button
                        type="button"
                        className="text-xs font-medium text-neutral-500 hover:text-neutral-800"
                        disabled={scheduling}
                        onClick={() => {
                          setSchedulePickerOpen(false);
                          setScheduleError(null);
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : null}
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => void persistCaption()}
                      disabled={!activePost || savingDraft}
                    >
                      <Save className="h-[18px] w-[18px]" />
                      {savingDraft ? "Saving…" : "Save draft"}
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={!activePost || imageUploading}
                      onClick={() => socialImageInputRef.current?.click()}
                    >
                      <ImagePlus className="h-[18px] w-[18px]" />
                      {imageUploading ? "Uploading…" : "Change image"}
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={
                        !activePost ||
                        scheduling ||
                        activePost.status === "published"
                      }
                      onClick={() => void schedulePost()}
                    >
                      {scheduling
                        ? "Scheduling…"
                        : schedulePickerOpen
                          ? "Confirm schedule"
                          : activePost?.status === "scheduled"
                            ? "Reschedule"
                            : "Schedule"}
                    </Button>
                    {activePost && postPermalink(activePost) ? (
                      <a
                        href={postPermalink(activePost) ?? undefined}
                        target="_blank"
                        rel="noreferrer"
                        className={`${WORKTUAL_HEADER_CONTROL} hover:bg-neutral-50`}
                      >
                        <ExternalLink className="h-4 w-4" />
                        View post
                      </a>
                    ) : (
                      <Button
                        type="button"
                        disabled={!activePost || publishing}
                        onClick={() => void publishNow()}
                      >
                        <Send className="h-[18px] w-[18px]" />
                        {publishing
                          ? "Publishing…"
                          : `Publish to ${
                              SOCIAL_TABS.find((s) => s.id === socialTab)
                                ?.label ?? "social"
                            }`}
                      </Button>
                    )}
                  </div>
                  <input
                    ref={socialImageInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void replaceSocialImage(file);
                    }}
                  />
                  {activePost?.lastError ? (
                    <p className="mt-3 text-xs text-amber-800">
                      {activePost.lastError}
                    </p>
                  ) : null}
                </div>
              </div>
              <aside className="bg-neutral-50/70 p-5">
                <p className="text-sm font-semibold text-neutral-900">Preview</p>
                <p className="mt-0.5 text-xs text-neutral-500">
                  See how this post looks on{" "}
                  {SOCIAL_TABS.find((s) => s.id === socialTab)?.label}. Hover the
                  image to replace it.
                </p>
                <div className="mt-4">
                  <SocialPostPreview
                    platform={socialTab}
                    caption={
                      draftCaption ||
                      "Generate a post to preview the caption, hashtags, and image."
                    }
                    imageUrl={
                      activePost
                        ? postImageUrl(activePost, imageCacheBust)
                        : ""
                    }
                    hashtags={activeHashtags}
                    canChangeImage={Boolean(activePost)}
                    imageUploading={imageUploading}
                    onChangeImage={() => socialImageInputRef.current?.click()}
                  />
                </div>
              </aside>
            </div>
          </div>
        ) : null}

        {tab === "library" ? (
          <div className={`overflow-hidden rounded-2xl bg-white ${WORKTUAL_HAIRLINE}`}>
            <div className="border-b border-neutral-100 px-5 py-4">
              <h2 className="text-base font-semibold text-neutral-900">
                Saved work
              </h2>
              <p className="mt-0.5 text-sm text-neutral-500">
                Pick an article to edit, or a social post (draft, scheduled, or
                live) to open.
              </p>
              <div className="mt-4 inline-flex rounded-lg bg-neutral-100 p-1">
                {(
                  [
                    { id: "articles", label: "Articles" },
                    { id: "posts", label: "Social posts" },
                  ] as const
                ).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setLibraryView(item.id)}
                    className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                      libraryView === item.id
                        ? "bg-white text-neutral-900 shadow-sm"
                        : "text-neutral-500 hover:text-neutral-800"
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            {libraryView === "articles" ? (
              libraryArticles.length === 0 ? (
                <p className="px-5 py-16 text-center text-sm text-neutral-500">
                  No articles yet. Create one in Content Generation, then it
                  shows up here.
                </p>
              ) : (
                <div>
                  {libraryArticleGroups.map((group) => (
                    <div key={group.label}>
                      <p className="sticky top-0 z-[1] border-b border-neutral-100 bg-neutral-50/95 px-5 py-2 text-[11px] font-semibold tracking-wide text-neutral-500 uppercase">
                        {group.label}
                      </p>
                      <ul className="divide-y divide-neutral-100">
                        {group.items.map((item) => (
                          <li
                            key={item.id}
                            className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"
                          >
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-semibold text-neutral-900">
                                {item.title || "Untitled article"}
                              </p>
                              <p className="mt-1 text-xs text-neutral-500">
                                {contentTypeLabel(item.contentType)}
                              </p>
                            </div>
                            <Button
                              type="button"
                              variant="secondary"
                              onClick={() => openLibraryContent(item)}
                            >
                              Edit article
                            </Button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )
            ) : libraryPosts.length === 0 ? (
              <p className="px-5 py-16 text-center text-sm text-neutral-500">
                No social posts yet. Generate posts from an article, then Save
                draft — they show up here.
              </p>
            ) : (
              <div>
                {libraryPostGroups.map((group) => (
                  <div key={group.label}>
                    <p className="sticky top-0 z-[1] border-b border-neutral-100 bg-neutral-50/95 px-5 py-2 text-[11px] font-semibold tracking-wide text-neutral-500 uppercase">
                      {group.label}
                    </p>
                    <ul className="divide-y divide-neutral-100">
                      {group.items.map(({ post, articleTitle }) => {
                        const platformLabel =
                          SOCIAL_TABS.find((s) => s.id === post.platform)
                            ?.label || post.platform;
                        const caption = postCaption(post);
                        return (
                          <li
                            key={post.id}
                            className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"
                          >
                            <div className="min-w-0 flex-1">
                              <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-neutral-900">
                                {platformLabel}
                                <span
                                  className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${socialStatusPillClass(post.status)}`}
                                >
                                  {socialStatusLabel(post.status)}
                                </span>
                              </p>
                              <p className="mt-1 truncate text-xs text-neutral-500">
                                {articleTitle}
                              </p>
                              {caption ? (
                                <p className="mt-1 line-clamp-2 text-sm text-neutral-700">
                                  {caption}
                                </p>
                              ) : null}
                            </div>
                            <div className="flex shrink-0 flex-wrap items-center gap-2">
                              <Button
                                type="button"
                                variant="secondary"
                                onClick={() => openLibraryPost(post)}
                              >
                                Open
                              </Button>
                              {post.status !== "published" ? (
                                <ConfirmDeleteButton
                                  compact
                                  name={
                                    postCaption(post).slice(0, 48) ||
                                    `${platformLabel} draft`
                                  }
                                  entityLabel="social post"
                                  consequence="This removes the draft from Saved. Live posts are not deleted."
                                  confirmLabel="Remove"
                                  onConfirm={() => removeLibraryPost(post)}
                                />
                              ) : null}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export { ContentMarketingWorkspace as DigitalMarketingWorkspace };
