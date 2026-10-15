/**
 * Channel template cards — System vs Phone frames with distinct B2B scenes.
 */

import type { ReactNode } from "react";
import type { CampaignTemplate, TemplatePreviewMeta } from "@/lib/campaign-templates";
import { resolveTemplatePreviewImage } from "@/lib/template-preview-images";
import {
  ChannelTemplatePreview,
  type TemplateFields,
} from "@/components/campaigns/ChannelTemplatePreview";
import {
  GalleryWebPushPhonePreview,
  GalleryWebPushSystemPreview,
  resolveWebPushContent,
} from "@/components/campaigns/WebPushGalleryPreview";

export type LibraryDisplayMode = "system" | "phone";

const SCENE_BG: Record<string, string> = {
  boardroom: "#0f2744",
  dashboard: "#0b1f33",
  webinar: "#312e81",
  launch: "#0c4a6e",
  handshake: "#14532d",
  growth: "#172554",
  security: "#1e293b",
  calendar: "#7c2d12",
  offer: "#581c87",
  invoice: "#334155",
  support: "#0e7490",
  team: "#3b0764",
  mobile: "#4c1d95",
  announce: "#9a3412",
  checklist: "#065f46",
  leads: "#1e3a8a",
  demo: "#164e63",
  renewal: "#713f12",
  feedback: "#831843",
  pipeline: "#1c1917",
};

/** Distinct B2B scene illustration per visualKey (not same gradient circles). */
function B2bScene({
  visualKey,
  imageSrc,
  className,
}: {
  visualKey: string;
  imageSrc?: string | null;
  className?: string;
}) {
  const bg = SCENE_BG[visualKey] || SCENE_BG.boardroom;
  if (imageSrc) {
    return (
      <div className={`relative overflow-hidden ${className || ""}`}>
        <img
          src={imageSrc}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          onError={(e) => {
            // Fall back to SVG scene if asset 404s
            const el = e.currentTarget;
            el.style.display = "none";
            const parent = el.parentElement;
            if (parent) parent.style.backgroundColor = bg;
          }}
        />
        <svg
          viewBox="0 0 320 180"
          className="absolute inset-0 -z-10 h-full w-full"
          preserveAspectRatio="xMidYMid slice"
          aria-hidden
        >
          {sceneArtwork(visualKey)}
        </svg>
      </div>
    );
  }

  return (
    <div
      className={`relative overflow-hidden ${className || ""}`}
      style={{ backgroundColor: bg }}
    >
      <svg
        viewBox="0 0 320 180"
        className="absolute inset-0 h-full w-full"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden
      >
        {sceneArtwork(visualKey)}
      </svg>
    </div>
  );
}

function sceneArtwork(key: string): ReactNode {
  switch (key) {
    case "dashboard":
      return (
        <>
          <rect x="24" y="28" width="272" height="124" rx="8" fill="#1e3a5f" />
          <rect x="40" y="44" width="80" height="10" rx="2" fill="#38bdf8" opacity="0.9" />
          <rect x="40" y="66" width="48" height="64" rx="3" fill="#22d3ee" opacity="0.85" />
          <rect x="98" y="86" width="48" height="44" rx="3" fill="#60a5fa" opacity="0.85" />
          <rect x="156" y="74" width="48" height="56" rx="3" fill="#a78bfa" opacity="0.85" />
          <rect x="214" y="54" width="48" height="76" rx="3" fill="#34d399" opacity="0.85" />
          <circle cx="260" cy="40" r="14" fill="#fbbf24" opacity="0.7" />
        </>
      );
    case "webinar":
      return (
        <>
          <rect x="40" y="36" width="240" height="110" rx="10" fill="#1e1b4b" />
          <circle cx="160" cy="78" r="28" fill="#7c3aed" />
          <polygon points="152,64 152,92 178,78" fill="white" />
          <rect x="70" y="128" width="180" height="8" rx="2" fill="#c4b5fd" opacity="0.5" />
          <circle cx="90" cy="150" r="6" fill="#a78bfa" />
          <circle cx="120" cy="150" r="6" fill="#a78bfa" />
          <circle cx="150" cy="150" r="6" fill="#a78bfa" />
          <circle cx="180" cy="150" r="6" fill="#a78bfa" />
        </>
      );
    case "launch":
      return (
        <>
          <rect x="36" y="40" width="160" height="100" rx="8" fill="#075985" />
          <rect x="48" y="54" width="100" height="8" rx="2" fill="#7dd3fc" />
          <rect x="48" y="72" width="136" height="50" rx="4" fill="#0ea5e9" opacity="0.5" />
          <path
            d="M220 120 L248 48 L276 120 Z"
            fill="#38bdf8"
            opacity="0.95"
          />
          <circle cx="248" cy="40" r="10" fill="#fef08a" />
          <rect x="210" y="128" width="80" height="18" rx="4" fill="#bae6fd" />
        </>
      );
    case "growth":
      return (
        <>
          <polyline
            points="40,140 90,110 130,118 180,70 240,50 280,36"
            fill="none"
            stroke="#60a5fa"
            strokeWidth="6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <polyline
            points="40,150 90,130 130,135 180,100 240,88 280,70"
            fill="none"
            stroke="#34d399"
            strokeWidth="4"
            opacity="0.7"
          />
          <circle cx="280" cy="36" r="8" fill="#fbbf24" />
          <rect x="36" y="30" width="70" height="22" rx="4" fill="#1e40af" />
          <text x="48" y="45" fill="white" fontSize="12" fontFamily="sans-serif">
            +42%
          </text>
        </>
      );
    case "handshake":
      return (
        <>
          <ellipse cx="110" cy="100" rx="36" ry="48" fill="#86efac" opacity="0.9" />
          <ellipse cx="210" cy="100" rx="36" ry="48" fill="#4ade80" opacity="0.9" />
          <rect x="120" y="88" width="80" height="28" rx="10" fill="#bbf7d0" />
          <rect x="90" y="40" width="140" height="18" rx="4" fill="#166534" opacity="0.6" />
          <circle cx="160" cy="150" r="6" fill="#fef08a" />
        </>
      );
    case "boardroom":
      return (
        <>
          <rect x="50" y="90" width="220" height="50" rx="6" fill="#1e3a5f" />
          <circle cx="90" cy="70" r="16" fill="#94a3b8" />
          <circle cx="140" cy="62" r="16" fill="#cbd5e1" />
          <circle cx="190" cy="62" r="16" fill="#94a3b8" />
          <circle cx="240" cy="70" r="16" fill="#cbd5e1" />
          <rect x="120" y="108" width="80" height="8" rx="2" fill="#38bdf8" opacity="0.6" />
          <rect x="70" y="40" width="40" height="28" rx="3" fill="#334155" />
          <rect x="210" y="40" width="40" height="28" rx="3" fill="#334155" />
        </>
      );
    case "checklist":
      return (
        <>
          <rect x="60" y="36" width="200" height="112" rx="10" fill="#064e3b" />
          {[0, 1, 2, 3].map((i) => (
            <g key={i}>
              <rect
                x="78"
                y={52 + i * 22}
                width="14"
                height="14"
                rx="3"
                fill="#34d399"
              />
              <rect
                x="102"
                y={54 + i * 22}
                width={120 - i * 12}
                height="10"
                rx="2"
                fill="#a7f3d0"
                opacity="0.8"
              />
            </g>
          ))}
        </>
      );
    case "leads":
      return (
        <>
          <circle cx="100" cy="80" r="32" fill="#3b82f6" opacity="0.9" />
          <circle cx="160" cy="70" r="36" fill="#60a5fa" opacity="0.85" />
          <circle cx="220" cy="85" r="28" fill="#93c5fd" opacity="0.9" />
          <rect x="70" y="120" width="180" height="24" rx="12" fill="#1e40af" />
          <rect x="100" y="126" width="120" height="10" rx="2" fill="#bfdbfe" />
        </>
      );
    case "announce":
      return (
        <>
          <rect x="40" y="40" width="140" height="100" rx="6" fill="#7c2d12" />
          <rect x="52" y="54" width="100" height="8" rx="2" fill="#fdba74" />
          <rect x="52" y="72" width="116" height="50" rx="3" fill="#ea580c" opacity="0.45" />
          <path d="M200 50 L250 90 L200 130 Z" fill="#fb923c" />
          <circle cx="260" cy="90" r="20" fill="#fef08a" opacity="0.85" />
        </>
      );
    case "feedback":
      return (
        <>
          {[0, 1, 2, 3, 4].map((i) => (
            <polygon
              key={i}
              points={starPoints(55 + i * 45, 90, 16)}
              fill={i < 4 ? "#f9a8d4" : "#64748b"}
            />
          ))}
          <rect x="70" y="130" width="180" height="16" rx="8" fill="#9d174d" opacity="0.7" />
        </>
      );
    case "calendar":
      return (
        <>
          <rect x="70" y="36" width="180" height="120" rx="10" fill="#9a3412" />
          <rect x="70" y="36" width="180" height="28" rx="10" fill="#ea580c" />
          <rect x="70" y="52" width="180" height="12" fill="#ea580c" />
          {[0, 1, 2].map((r) =>
            [0, 1, 2, 3].map((c) => (
              <rect
                key={`${r}-${c}`}
                x={90 + c * 38}
                y={78 + r * 24}
                width="22"
                height="16"
                rx="2"
                fill="#fdba74"
                opacity={r === 1 && c === 2 ? 1 : 0.45}
              />
            )),
          )}
        </>
      );
    case "offer":
      return (
        <>
          <circle cx="160" cy="90" r="55" fill="#7e22ce" />
          <circle cx="160" cy="90" r="40" fill="#a855f7" />
          <text
            x="160"
            y="98"
            textAnchor="middle"
            fill="white"
            fontSize="28"
            fontFamily="sans-serif"
            fontWeight="700"
          >
            %
          </text>
          <rect x="100" y="150" width="120" height="14" rx="4" fill="#e9d5ff" opacity="0.7" />
        </>
      );
    case "security":
      return (
        <>
          <path
            d="M160 40 L220 60 L220 110 C220 140 160 160 160 160 C160 160 100 140 100 110 L100 60 Z"
            fill="#475569"
          />
          <rect x="145" y="90" width="30" height="36" rx="4" fill="#94a3b8" />
          <circle cx="160" cy="82" r="12" fill="#cbd5e1" />
        </>
      );
    case "invoice":
      return (
        <>
          <rect x="90" y="30" width="140" height="130" rx="6" fill="#e2e8f0" />
          <rect x="106" y="48" width="90" height="8" rx="2" fill="#64748b" />
          <rect x="106" y="68" width="108" height="6" rx="2" fill="#94a3b8" />
          <rect x="106" y="84" width="108" height="6" rx="2" fill="#94a3b8" />
          <rect x="106" y="100" width="70" height="6" rx="2" fill="#94a3b8" />
          <rect x="106" y="126" width="80" height="18" rx="4" fill="#334155" />
        </>
      );
    case "mobile":
      return (
        <>
          <rect x="120" y="28" width="80" height="130" rx="12" fill="#1e1b4b" />
          <rect x="128" y="42" width="64" height="90" rx="4" fill="#8b5cf6" opacity="0.7" />
          <circle cx="160" cy="146" r="6" fill="#c4b5fd" />
          <rect x="50" y="70" width="50" height="40" rx="6" fill="#6d28d9" opacity="0.6" />
          <rect x="220" y="70" width="50" height="40" rx="6" fill="#6d28d9" opacity="0.6" />
        </>
      );
    case "support":
      return (
        <>
          <ellipse cx="160" cy="88" rx="70" ry="50" fill="#0891b2" />
          <ellipse cx="160" cy="88" rx="40" ry="28" fill="#67e8f9" opacity="0.5" />
          <rect x="130" y="130" width="60" height="20" rx="6" fill="#155e75" />
        </>
      );
    case "demo":
      return (
        <>
          <rect x="50" y="50" width="220" height="90" rx="8" fill="#0e7490" />
          <circle cx="120" cy="95" r="22" fill="#22d3ee" />
          <rect x="156" y="78" width="90" height="10" rx="2" fill="#a5f3fc" />
          <rect x="156" y="98" width="70" height="10" rx="2" fill="#67e8f9" opacity="0.7" />
        </>
      );
    default:
      return (
        <>
          <rect x="40" y="40" width="240" height="100" rx="8" fill="#1e3a5f" opacity="0.8" />
          <circle cx="100" cy="90" r="24" fill="#94a3b8" />
          <rect x="140" y="70" width="120" height="12" rx="2" fill="#cbd5e1" />
          <rect x="140" y="94" width="90" height="10" rx="2" fill="#64748b" />
        </>
      );
  }
}

function starPoints(cx: number, cy: number, r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 5; i++) {
    const a = (Math.PI / 2) * 3 + (i * 2 * Math.PI) / 5;
    const b = a + Math.PI / 5;
    pts.push(
      `${cx + Math.cos(a) * r},${cy + Math.sin(a) * r}`,
      `${cx + Math.cos(b) * (r * 0.4)},${cy + Math.sin(b) * (r * 0.4)}`,
    );
  }
  return pts.join(" ");
}

function highlightBody(
  text: string,
  highlight?: string,
  style: "sms" | "link" = "sms",
) {
  if (!highlight || !text.includes(highlight)) {
    return <span>{text}</span>;
  }
  const parts = text.split(highlight);
  return (
    <>
      {parts.map((part, i) => (
        <span key={i}>
          {part}
          {i < parts.length - 1 ? (
            style === "link" ? (
              <span className="font-semibold text-[#2563eb]">{highlight}</span>
            ) : (
              <span className="mx-0.5 inline rounded-[2px] bg-[#f97316] px-0.5 text-[9px] font-semibold text-[#1e3a8a] underline decoration-[#1e3a8a]">
                {highlight}
              </span>
            )
          ) : null}
        </span>
      ))}
    </>
  );
}

function PhoneChrome({
  children,
  footer,
}: {
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="flex h-full w-full items-stretch justify-center bg-white p-0">
      <div className="relative flex h-full w-full flex-col overflow-hidden rounded-[1.4rem] border-[3px] border-neutral-900 bg-white shadow-lg">
        <div className="relative z-10 flex shrink-0 items-center justify-between px-2.5 pt-1 pb-0.5">
          <span className="text-[7px] font-semibold text-neutral-900">9:41</span>
          <div className="absolute top-1 left-1/2 h-2 w-10 -translate-x-1/2 rounded-full bg-neutral-900" />
          <div className="flex items-center gap-0.5 text-[7px] text-neutral-600">
            <span>●●</span>
            <span className="ml-0.5 inline-block h-1.5 w-3 rounded-[1px] border border-neutral-600" />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
        {footer}
      </div>
    </div>
  );
}

function SmsPhone({ meta }: { meta: TemplatePreviewMeta }) {
  const text = meta.body || meta.headline;
  const highlight = meta.ctaHighlight || "Shop Now";
  return (
    <PhoneChrome
      footer={
        <div className="flex shrink-0 items-center gap-1 bg-white px-1.5 pb-1.5 pt-1">
          <span className="inline-flex size-4 items-center justify-center rounded-full text-[8px] text-neutral-400">
            ⌕
          </span>
          <span className="inline-flex size-4 items-center justify-center rounded-full bg-neutral-100 text-[7px] text-neutral-400">
            A
          </span>
          <span className="flex h-5 flex-1 items-center rounded-full border border-neutral-200 bg-white px-2 text-[7px] text-neutral-400">
            iMessage
            <span className="ml-auto text-[8px] text-neutral-300">🎤</span>
          </span>
        </div>
      }
    >
      <div className="flex h-full flex-col bg-white">
        {/* Compact contact header — matches iMessage mock */}
        <div className="flex shrink-0 flex-col items-center px-2 pb-1 pt-0.5">
          <div className="mb-0.5 flex w-full items-center">
            <span className="text-[11px] leading-none text-sky-500">‹</span>
          </div>
          <span className="inline-flex size-5 items-center justify-center rounded-full bg-neutral-200">
            <span className="size-1.5 rounded-full bg-neutral-400" />
          </span>
          <p className="mt-0.5 text-[7px] font-medium text-neutral-600">
            +12722370167
          </p>
        </div>
        <div className="flex min-h-0 flex-1 flex-col justify-start px-2 pt-1">
          <div className="max-w-[94%] self-start rounded-2xl rounded-bl-md bg-[#e9e9eb] px-2 py-1.5">
            <p className="text-[9px] leading-snug text-neutral-900">
              {highlightBody(text, text.includes(highlight) ? highlight : undefined)}
            </p>
          </div>
        </div>
      </div>
    </PhoneChrome>
  );
}

function WhatsAppPhone({
  meta,
  imageSrc,
  withMedia,
}: {
  meta: TemplatePreviewMeta;
  imageSrc?: string | null;
  withMedia: boolean;
}) {
  return (
    <PhoneChrome
      footer={
        <div className="flex shrink-0 items-center gap-1 bg-[#f0f2f5] px-1.5 py-1.5">
          <span className="size-5 rounded-full bg-neutral-300" />
          <span className="size-5 rounded-full bg-neutral-300" />
          <span className="h-5 flex-1 rounded-full bg-white px-2 text-[8px] leading-5 text-neutral-400">
            Message
          </span>
          <span className="size-5 rounded-full bg-neutral-300" />
        </div>
      }
    >
      <div className="flex h-full flex-col" style={{ backgroundColor: "#efeae2" }}>
        <div className="flex items-center gap-1.5 bg-white px-2 py-1.5 shadow-sm">
          <span className="text-[11px] text-neutral-500">‹</span>
          <span className="inline-flex size-6 items-center justify-center rounded-full bg-neutral-200 text-[8px] text-neutral-500">
            ●
          </span>
          <p className="truncate text-[10px] font-semibold text-neutral-800">
            Business number
          </p>
        </div>
        <div className="flex flex-1 flex-col justify-center px-2 py-2">
          <div className="max-w-[96%] overflow-hidden rounded-lg bg-white shadow-sm">
            {withMedia ? (
              <B2bScene
                visualKey={meta.visualKey}
                imageSrc={imageSrc}
                className="h-16 w-full"
              />
            ) : null}
            <div className="px-2 py-1.5">
              <p className="text-[11px] font-bold text-neutral-900">
                {meta.headline}
              </p>
              <p className="mt-1 line-clamp-5 text-[9px] leading-relaxed text-neutral-600">
                {meta.body}
              </p>
              <p className="mt-1.5 text-[8px] text-neutral-400">
                {meta.footer || "WhatsApp Business Platform sample message"}
              </p>
            </div>
          </div>
        </div>
      </div>
    </PhoneChrome>
  );
}

function AppPushPhone({ meta }: { meta: TemplatePreviewMeta }) {
  const body = meta.body || meta.headline;
  const highlight = meta.ctaHighlight;
  // Append CTA as blue link when set and not already in body
  const showCta =
    Boolean(meta.cta) && !highlight && !(meta.cta && body.includes(meta.cta));
  return (
    <PhoneChrome>
      <div
        className="relative flex h-full flex-col"
        style={{
          background:
            "linear-gradient(165deg, #5b7c99 0%, #3d5a73 35%, #2c4560 70%, #1e3348 100%)",
        }}
      >
        {/* Soft wallpaper shapes */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden opacity-40">
          <div className="absolute -top-6 -right-8 size-28 rounded-full bg-[#f0a070]/30 blur-2xl" />
          <div className="absolute top-1/3 -left-10 size-32 rounded-full bg-[#8eb4d4]/25 blur-2xl" />
          <div className="absolute bottom-8 right-4 size-20 rounded-full bg-[#c4a882]/20 blur-xl" />
        </div>

        <div className="relative px-3 pt-4">
          <p className="text-[20px] font-light leading-none tracking-tight text-[#7dcea0]">
            12:30
          </p>
          <p className="mt-0.5 text-[8px] font-medium text-white/90">
            Sun, Oct 31
          </p>
        </div>

        <div className="relative mx-2 mt-4 rounded-2xl bg-white/95 px-2 py-2 shadow-lg backdrop-blur-sm">
          <div className="flex items-start gap-1.5">
            <img
              src="/brand/worktual-logo.png"
              alt=""
              className="size-6 shrink-0 rounded-full bg-neutral-900 object-contain p-0.5"
            />
            <p className="min-w-0 flex-1 pt-0.5 text-[9px] leading-snug text-neutral-800">
              {highlight
                ? highlightBody(body, highlight, "link")
                : body}
              {showCta ? (
                <>
                  {" "}
                  <span className="font-semibold text-[#2563eb]">
                    {meta.cta}…
                  </span>
                </>
              ) : null}
            </p>
            <span className="shrink-0 text-[8px] text-neutral-400">▾</span>
          </div>
        </div>
      </div>
    </PhoneChrome>
  );
}

function EmailPhone({
  meta,
  imageSrc,
}: {
  meta: TemplatePreviewMeta;
  imageSrc?: string | null;
}) {
  const bullets = meta.bullets?.slice(0, 4) || [];
  const showHero = meta.kind === "email_hero";
  return (
    <PhoneChrome>
      <div className="flex h-full flex-col overflow-hidden bg-[#f3f4f6]">
        <p className="shrink-0 truncate px-2 pt-1 text-[8px] text-neutral-500">
          Subject: {meta.subject || meta.headline}
        </p>
        <div className="m-1.5 min-h-0 flex-1 overflow-hidden rounded border border-neutral-200 bg-white">
          <div
            className="email-preview-scroll gallery-preview-scroll flex h-full flex-col overflow-y-auto px-2 py-1.5"
          >
            <div className="mb-1.5 flex items-center justify-center gap-1">
              <img
                src="/brand/worktual-logo.png"
                alt=""
                className="size-3.5 shrink-0 object-contain"
              />
              <span className="text-[9px] font-semibold tracking-tight text-neutral-900">
                Worktual
              </span>
            </div>
            <p className="text-[9px] text-neutral-800">
              {meta.greeting || "Dear {{firstName}},"}
            </p>
            {showHero ? (
              <B2bScene
                visualKey={meta.visualKey}
                imageSrc={imageSrc}
                className="mt-1.5 h-14 w-full shrink-0 rounded"
              />
            ) : null}
            {bullets.length > 0 ? (
              <ul className="mt-1.5 space-y-0.5">
                {bullets.map((b) => (
                  <li
                    key={b}
                    className="flex gap-1 text-[7px] leading-snug text-neutral-600"
                  >
                    <span className="mt-0.5 shrink-0 text-neutral-400">•</span>
                    <span className="line-clamp-2">{b}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1.5 line-clamp-3 text-[8px] leading-snug text-neutral-600">
                {meta.body}
              </p>
            )}
            {meta.cta ? (
              <div className="mt-2 flex justify-center">
                <span className="inline-flex rounded bg-[#f97316] px-2.5 py-1 text-[8px] font-semibold text-white">
                  {meta.cta}
                </span>
              </div>
            ) : null}
            <p className="mt-2 whitespace-pre-line text-[7px] leading-snug text-neutral-600">
              {meta.closing || "Best regards,\nWorktual Team"}
            </p>
            <p className="mt-1 text-[7px] text-sky-600 underline">Unsubscribe</p>
          </div>
        </div>
      </div>
    </PhoneChrome>
  );
}

function WebPushPhone({
  meta,
  imageSrc,
}: {
  meta: TemplatePreviewMeta;
  imageSrc?: string | null;
}) {
  const content = resolveWebPushContent(
    {
      title: meta.headline,
      body: meta.body,
      cta_label: meta.cta,
      image_url: imageSrc || undefined,
    },
    meta,
    { previewImage: imageSrc, preview: meta },
  );
  return (
    <GalleryWebPushPhonePreview
      fields={{
        title: content.title,
        body: content.body,
        cta_label: content.cta,
        image_url: content.imageSrc || undefined,
      }}
    />
  );
}

/** Compact system/desktop email card */
function EmailSystem({
  meta,
  imageSrc,
  withHero,
}: {
  meta: TemplatePreviewMeta;
  imageSrc?: string | null;
  withHero: boolean;
}) {
  return (
    <div className="flex h-full flex-col bg-[#eef2f7] p-2">
      <div className="mb-1 flex items-center gap-1 px-0.5">
        <span className="size-1.5 rounded-full bg-red-400" />
        <span className="size-1.5 rounded-full bg-amber-400" />
        <span className="size-1.5 rounded-full bg-emerald-400" />
        <span className="ml-2 truncate text-[8px] text-neutral-400">
          Inbox · Worktual
        </span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-neutral-200 bg-white">
        {withHero ? (
          <B2bScene
            visualKey={meta.visualKey}
            imageSrc={imageSrc}
            className="h-[38%] w-full shrink-0"
          />
        ) : (
          <div className="flex h-8 shrink-0 items-center justify-center gap-1 border-b border-neutral-100">
            <img
              src="/brand/worktual-logo.png"
              alt=""
              className="size-3.5 object-contain"
            />
            <span className="text-[9px] font-semibold text-neutral-800">
              Worktual
            </span>
          </div>
        )}
        <div className="flex min-h-0 flex-1 flex-col px-3 pt-2.5 pb-3">
          {meta.eyebrow && withHero ? (
            <p className="mb-0.5 text-[8px] font-semibold uppercase tracking-wider text-sky-700">
              {meta.eyebrow}
            </p>
          ) : null}
          <p className="line-clamp-2 text-[12px] font-bold leading-snug text-neutral-900">
            {meta.headline}
          </p>
          <p className="mt-1.5 line-clamp-3 flex-1 text-[10px] leading-relaxed text-neutral-600">
            {meta.body}
          </p>
          {meta.cta ? (
            <div className="mt-2 flex justify-center">
              <span className="inline-flex h-7 items-center rounded-md bg-[#2563eb] px-3.5 text-[10px] font-semibold text-white">
                {meta.cta}
              </span>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function WhatsAppSystem({
  meta,
  imageSrc,
  withMedia,
}: {
  meta: TemplatePreviewMeta;
  imageSrc?: string | null;
  withMedia: boolean;
}) {
  return (
    <div className="flex h-full flex-col bg-[#111b21]">
      <div className="flex items-center gap-2 border-b border-white/10 bg-[#202c33] px-2.5 py-1.5">
        <span className="inline-flex size-6 items-center justify-center rounded-full bg-[#00a884] text-[8px] font-bold text-white">
          W
        </span>
        <div className="min-w-0">
          <p className="truncate text-[10px] font-semibold text-white">
            Business number
          </p>
          <p className="text-[8px] text-white/50">Business account</p>
        </div>
      </div>
      <div
        className="flex min-h-0 flex-1 flex-col p-2"
        style={{ backgroundColor: "#0b141a" }}
      >
        <div className="overflow-hidden rounded-lg bg-[#202c33] shadow-sm">
          {withMedia ? (
            <B2bScene
              visualKey={meta.visualKey}
              imageSrc={imageSrc}
              className="h-[36%] w-full"
            />
          ) : null}
          <div className="px-2.5 py-2">
            <p className="text-[11px] font-bold text-white">{meta.headline}</p>
            <p className="mt-1 line-clamp-4 text-[10px] leading-relaxed text-white/70">
              {meta.body}
            </p>
            <p className="mt-1.5 text-[8px] text-white/40">
              {meta.footer || "WhatsApp Business Platform sample message"}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function WebPushSystem({
  meta,
  imageSrc,
}: {
  meta: TemplatePreviewMeta;
  imageSrc?: string | null;
}) {
  const content = resolveWebPushContent(
    {
      title: meta.headline,
      body: meta.body,
      cta_label: meta.cta,
      image_url: imageSrc || undefined,
    },
    meta,
    { previewImage: imageSrc, preview: meta },
  );
  return (
    <GalleryWebPushSystemPreview
      fields={{
        title: content.title,
        body: content.body,
        cta_label: content.cta,
        image_url: content.imageSrc || undefined,
      }}
    />
  );
}

/** Phone mockup showing the actual Director email design (sections + theme). */
export function GalleryEmailPhonePreview({
  fields,
}: {
  fields: TemplateFields;
}) {
  const subject = String(fields.subject || "").trim();
  return (
    <PhoneChrome>
      <div className="flex h-full flex-col overflow-hidden bg-[#f3f4f6]">
        <p className="shrink-0 truncate px-2 pt-0.5 text-[7px] text-neutral-500">
          {subject || "Email"}
        </p>
        <div className="gallery-preview-scroll mx-1 mb-1 min-h-0 flex-1 overflow-y-auto overflow-x-hidden rounded border border-neutral-200 bg-white">
          <ChannelTemplatePreview
            channel="email"
            fields={fields}
            compact
            hideSubject
          />
        </div>
      </div>
    </PhoneChrome>
  );
}

export function LibraryTemplatePreview({
  template,
  displayMode = "system",
}: {
  template: CampaignTemplate;
  displayMode?: LibraryDisplayMode;
}) {
  const meta = template.preview;
  if (!meta) {
    return (
      <div className="flex h-full flex-col bg-white p-4">
        <p className="line-clamp-6 text-[12px] leading-relaxed text-neutral-600">
          {template.bodyPreview || template.description}
        </p>
      </div>
    );
  }

  const img = resolveTemplatePreviewImage(template);
  const phone = displayMode === "phone";

  if (phone) {
    switch (meta.kind) {
      case "email_hero":
      case "email_text":
        return <EmailPhone meta={meta} imageSrc={img} />;
      case "sms":
        return <SmsPhone meta={meta} />;
      case "wa_media":
        return <WhatsAppPhone meta={meta} imageSrc={img} withMedia />;
      case "wa_text":
        return <WhatsAppPhone meta={meta} withMedia={false} />;
      case "app_visual":
      case "app_text":
        return <AppPushPhone meta={meta} />;
      case "web_visual":
      case "web_text":
        return <WebPushPhone meta={meta} imageSrc={img} />;
      default:
        return <EmailPhone meta={meta} imageSrc={img} />;
    }
  }

  // System view
  switch (meta.kind) {
    case "email_hero":
      return <EmailSystem meta={meta} imageSrc={img} withHero />;
    case "email_text":
      return <EmailSystem meta={meta} withHero={false} />;
    case "wa_media":
      return <WhatsAppSystem meta={meta} imageSrc={img} withMedia />;
    case "wa_text":
      return <WhatsAppSystem meta={meta} withMedia={false} />;
    case "web_visual":
    case "web_text":
      return <WebPushSystem meta={meta} imageSrc={img} />;
    case "sms":
      return <SmsPhone meta={meta} />;
    case "app_visual":
    case "app_text":
      return <AppPushPhone meta={meta} />;
    default:
      return <EmailSystem meta={meta} withHero={false} />;
  }
}

export function templateHasVisual(template: CampaignTemplate): boolean {
  const kind = template.preview?.kind;
  if (!kind) return Boolean(resolveTemplatePreviewImage(template));
  return (
    kind === "email_hero" ||
    kind === "wa_media" ||
    kind === "web_visual" ||
    Boolean(resolveTemplatePreviewImage(template))
  );
}
