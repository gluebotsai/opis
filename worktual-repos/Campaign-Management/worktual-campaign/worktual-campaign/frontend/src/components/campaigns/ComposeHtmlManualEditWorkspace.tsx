/**
 * Manual edit for Phase 2 compose emails (`fields.compiled_html`).
 * Same left-rail + right-canvas chrome as the old campaign editor.
 * HTML stays the source of truth — no conversion to the block canvas.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowLeft,
  Code2,
  Eye,
  Image as ImageIcon,
  Loader2,
  Monitor,
  Palette,
  Smartphone,
  Sparkles,
  Type,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { TemplateImagePicker } from "@/components/campaigns/TemplateImagePicker";
import { patchChannelTemplateFields } from "@/services/channelTemplates.api";
import type { TemplateCard } from "@/services/agents.socket";
import { getAgentsSocket } from "@/services/agents.socket";
import { getToken } from "@/services/api";
import type { TemplateFields } from "@/components/campaigns/ChannelTemplatePreview";
import {
  inspectComposeHtml,
  persistComposeHtml,
  previewComposeHtml,
  serializeIframeDocument,
  setComposeBackground,
  setComposeCta,
  setComposeFooterAlign,
  setComposeHeading,
  setComposeHeroUrl,
  ensureComposeUnsubscribeLink,
  type FooterAlign,
} from "@/lib/compose-html-manual-edit";

type Props = {
  template: TemplateCard;
  campaignTitle: string;
  baseFields: TemplateFields;
  onBackToAi: () => void;
  onSaved: (next: TemplateCard) => void;
};

type LeftTab = "email" | "brand" | "images" | "footer";

const LEFT_TABS: Array<{
  id: LeftTab;
  label: string;
  icon: typeof Type;
}> = [
  { id: "email", label: "Email", icon: Type },
  { id: "brand", label: "Brand", icon: Palette },
  { id: "images", label: "Images", icon: ImageIcon },
  { id: "footer", label: "Footer", icon: AlignCenter },
];

export function hasComposeCompiledHtml(
  fields: TemplateFields | Record<string, unknown> | null | undefined,
): boolean {
  if (!fields || typeof fields !== "object") return false;
  const rec = fields as Record<string, unknown>;
  const html = String(rec.compiled_html || rec.html || "").trim();
  return /<(html|body|table|div|p)\b/i.test(html);
}

export function ComposeHtmlManualEditWorkspace({
  template,
  campaignTitle,
  baseFields,
  onBackToAi,
  onSaved,
}: Props) {
  const initialHtml = String(
    baseFields.compiled_html || baseFields.html || "",
  ).trim();
  const [subject, setSubject] = useState(() =>
    String(baseFields.subject || "").trim(),
  );
  const [preheader, setPreheader] = useState(() =>
    String(baseFields.preheader || "").trim(),
  );
  const [html, setHtml] = useState(() =>
    ensureComposeUnsubscribeLink(initialHtml),
  );
  const [baseline, setBaseline] = useState(() =>
    JSON.stringify({
      subject: String(baseFields.subject || "").trim(),
      preheader: String(baseFields.preheader || "").trim(),
      html: initialHtml,
    }),
  );
  const [leftTab, setLeftTab] = useState<LeftTab>("email");
  const [mode, setMode] = useState<"preview" | "source">("preview");
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const [canvasDirty, setCanvasDirty] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [imageBrief, setImageBrief] = useState("");
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const inspect = useMemo(() => inspectComposeHtml(html), [html]);

  useEffect(() => {
    const nextHtml = String(
      baseFields.compiled_html || baseFields.html || "",
    ).trim();
    const nextSubject = String(baseFields.subject || "").trim();
    const nextPre = String(baseFields.preheader || "").trim();
    setSubject(nextSubject);
    setPreheader(nextPre);
    setHtml(ensureComposeUnsubscribeLink(nextHtml));
    setBaseline(
      JSON.stringify({
        subject: nextSubject,
        preheader: nextPre,
        html: nextHtml,
      }),
    );
    setError(null);
    setSavedFlash(false);
    setCanvasDirty(false);
  }, [template.template_id, baseFields]);

  const dirty = useMemo(
    () =>
      canvasDirty ||
      JSON.stringify({ subject, preheader, html }) !== baseline,
    [subject, preheader, html, baseline, canvasDirty],
  );

  const liveHtmlFromCanvas = () => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc) return html;
    return serializeIframeDocument(doc, html);
  };

  const syncFromIframe = () => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc) return;
    const next = serializeIframeDocument(doc, html);
    if (next !== html) {
      setHtml(next);
      setCanvasDirty(false);
    }
  };

  const enableCanvasEdit = () => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc) return;
    try {
      doc.designMode = "on";
    } catch {
      /* sandbox / browser */
    }
    doc.body?.setAttribute("contenteditable", "true");
    const onInput = () => setCanvasDirty(true);
    doc.addEventListener("input", onInput);
  };

  const save = async () => {
    if (!template.template_id || saving) return;
    const liveHtml =
      mode === "preview"
        ? liveHtmlFromCanvas()
        : persistComposeHtml(html);
    if (!liveHtml.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const inspectLive = inspectComposeHtml(liveHtml);
      const nextFields: TemplateFields = {
        ...baseFields,
        subject: subject.trim(),
        preheader: preheader.trim(),
        compiled_html: liveHtml,
        pipeline: "compose",
        ...(inspectLive.heroUrl
          ? { header_image: inspectLive.heroUrl, image_url: inspectLive.heroUrl }
          : {}),
      };
      delete (nextFields as { sections?: unknown }).sections;
      delete (nextFields as { blocks?: unknown }).blocks;

      const updated = await patchChannelTemplateFields(
        template.template_id,
        nextFields,
      );
      const savedFields = (updated?.fields || nextFields) as TemplateFields;
      onSaved({
        ...template,
        ...updated,
        fields: savedFields,
      });
      setHtml(String(savedFields.compiled_html || liveHtml).trim());
      setBaseline(
        JSON.stringify({
          subject: String(savedFields.subject || subject).trim(),
          preheader: String(savedFields.preheader || preheader).trim(),
          html: String(savedFields.compiled_html || liveHtml).trim(),
        }),
      );
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 2000);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not save template changes",
      );
    } finally {
      setSaving(false);
    }
  };

  const generateHero = async () => {
    const sessionId = String(template.session_id || "").trim();
    const tid = String(template.template_id || "").trim();
    if (!sessionId || !tid || generating) return;
    if (mode === "preview") syncFromIframe();
    setGenerating(true);
    setError(null);
    const sock = getAgentsSocket();
    const onReady = (payload: {
      ok?: boolean;
      url?: string;
      error?: string;
      template_id?: string;
      session_id?: string;
    }) => {
      if (payload.template_id && payload.template_id !== tid) return;
      if (payload.session_id && payload.session_id !== sessionId) return;
      sock.off("compose_image_ready", onReady);
      window.clearTimeout(timer);
      setGenerating(false);
      const url = String(payload.url || "").trim();
      if (!payload.ok || !url) {
        setError(payload.error || "Could not generate image");
        return;
      }
      const live = mode === "preview" ? liveHtmlFromCanvas() : html;
      setHtml(setComposeHeroUrl(live, url));
      setCanvasDirty(true);
    };
    const timer = window.setTimeout(() => {
      sock.off("compose_image_ready", onReady);
      setGenerating(false);
      setError("Image generation timed out. Try again.");
    }, 120000);
    sock.on("compose_image_ready", onReady);
    sock.emit("compose_generate_image", {
      session_id: sessionId,
      token: getToken(),
      template_id: tid,
      brief: imageBrief.trim(),
    });
  };

  const channel = String(template.channel || "email");

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-3 sm:p-4">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-2xl border border-[#bfbfbf] bg-white px-3 py-3 sm:px-4">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg hover:bg-state-hover"
            onClick={onBackToAi}
            aria-label="Back"
          >
            <ArrowLeft className="size-[18px]" strokeWidth={2.25} />
          </button>
          <div className="min-w-0">
            <p className="truncate text-base font-semibold text-text-primary">
              Edit template
            </p>
            <p className="truncate text-xs text-text-caption">
              {campaignTitle}
              {channel ? ` · ${channel}` : ""}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {savedFlash ? (
            <span className="text-xs text-emerald-700">Saved</span>
          ) : null}
          <div className="flex rounded-lg border border-[#bfbfbf] p-0.5">
            <button
              type="button"
              className={`inline-flex size-9 items-center justify-center rounded-md ${
                device === "desktop"
                  ? "bg-[#111111] text-white"
                  : "text-text-caption"
              }`}
              onClick={() => setDevice("desktop")}
              aria-label="Desktop width"
            >
              <Monitor className="size-[18px]" strokeWidth={2.25} />
            </button>
            <button
              type="button"
              className={`inline-flex size-9 items-center justify-center rounded-md ${
                device === "mobile"
                  ? "bg-[#111111] text-white"
                  : "text-text-caption"
              }`}
              onClick={() => setDevice("mobile")}
              aria-label="Mobile width"
            >
              <Smartphone className="size-[18px]" strokeWidth={2.25} />
            </button>
          </div>
          <div className="flex rounded-lg border border-[#bfbfbf] p-0.5">
            <button
              type="button"
              className={`inline-flex h-[38px] items-center gap-1 rounded-md px-3 text-xs font-medium ${
                mode === "preview"
                  ? "bg-[#111111] text-white"
                  : "text-text-caption"
              }`}
              onClick={() => setMode("preview")}
            >
              <Eye className="size-[18px]" strokeWidth={2.25} />
              Preview
            </button>
            <button
              type="button"
              className={`inline-flex h-[38px] items-center gap-1 rounded-md px-3 text-xs font-medium ${
                mode === "source"
                  ? "bg-[#111111] text-white"
                  : "text-text-caption"
              }`}
              onClick={() => {
                syncFromIframe();
                setMode("source");
              }}
            >
              <Code2 className="size-[18px]" strokeWidth={2.25} />
              HTML
            </button>
          </div>
          <Button
            type="button"
            variant="primary"
            className="h-[38px] px-3 text-xs"
            disabled={!dirty || saving || !html.trim()}
            onClick={() => void save()}
          >
            {saving ? (
              <>
                <Loader2 className="mr-1.5 size-[18px] animate-spin" />
                Saving…
              </>
            ) : (
              "Save"
            )}
          </Button>
        </div>
      </header>

      {error ? (
        <p className="shrink-0 text-sm text-text-danger" role="alert">
          {error}
        </p>
      ) : null}

      <div className="grid min-h-0 flex-1 overflow-hidden rounded-2xl border border-[#bfbfbf] bg-white lg:grid-cols-[72px_minmax(220px,260px)_minmax(0,1fr)]">
        <nav className="flex shrink-0 flex-col gap-0.5 border-r border-[#e5e5e5] bg-[#f7f7f8] py-2">
          {LEFT_TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              title={label}
              aria-label={label}
              aria-current={leftTab === id ? "page" : undefined}
              onClick={() => setLeftTab(id)}
              className={`relative mx-1 flex flex-col items-center gap-1 rounded-xl px-1 py-2.5 text-[11px] font-medium ${
                leftTab === id
                  ? "bg-white text-[#111111] shadow-sm"
                  : "text-[#6b6b6b] hover:bg-white/70 hover:text-[#111111]"
              }`}
            >
              <Icon className="size-[22px]" strokeWidth={1.75} />
              {label}
            </button>
          ))}
        </nav>

        <aside className="chat-scroll-xs flex min-h-0 flex-col overflow-y-auto border-r border-[#e5e5e5] bg-white p-4">
          {leftTab === "email" ? (
            <>
              <p className="mb-2 text-[11px] font-semibold tracking-wide text-text-caption uppercase">
                Email
              </p>
              <div className="flex flex-col gap-3">
                <Input
                  label="Subject"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="h-[38px] text-sm"
                />
                <Input
                  label="Preheader"
                  value={preheader}
                  onChange={(e) => setPreheader(e.target.value)}
                  className="h-[38px] text-sm"
                />
                <Input
                  label="Heading"
                  value={inspect.heading}
                  onChange={(e) =>
                    setHtml(setComposeHeading(html, e.target.value))
                  }
                  className="h-[38px] text-sm"
                />
                <Input
                  label="Button label"
                  value={inspect.ctaLabel}
                  onChange={(e) =>
                    setHtml(
                      setComposeCta(html, e.target.value, inspect.ctaHref),
                    )
                  }
                  className="h-[38px] text-sm"
                />
                <Input
                  label="Button URL"
                  value={inspect.ctaHref}
                  onChange={(e) =>
                    setHtml(
                      setComposeCta(html, inspect.ctaLabel, e.target.value),
                    )
                  }
                  className="h-[38px] text-sm"
                />
                <p className="text-xs leading-5 text-text-caption">
                  Click the email on the right to edit copy in place. Use the
                  other tabs for image, color, and footer alignment.
                </p>
              </div>
            </>
          ) : null}

          {leftTab === "brand" ? (
            <>
              <p className="mb-2 text-[11px] font-semibold tracking-wide text-text-caption uppercase">
                Brand
              </p>
              <label className="flex flex-col gap-2 text-sm font-medium text-text-primary">
                Canvas color
                <input
                  type="color"
                  value={
                    /^#[0-9a-f]{6}$/i.test(inspect.background)
                      ? inspect.background
                      : "#f3f4f6"
                  }
                  onChange={(e) =>
                    setHtml(setComposeBackground(html, e.target.value))
                  }
                  className="h-[38px] w-full cursor-pointer rounded-lg border border-[#bfbfbf] bg-white p-1"
                />
              </label>
              <p className="mt-3 text-xs leading-5 text-text-caption">
                Sets the email body background. Headline and button colors can
                still be changed in the canvas or HTML.
              </p>
            </>
          ) : null}

          {leftTab === "images" ? (
            <>
              <p className="mb-2 text-[11px] font-semibold tracking-wide text-text-caption uppercase">
                Images
              </p>
              <TemplateImagePicker
                url={inspect.heroUrl}
                onUrlChange={(next) => setHtml(setComposeHeroUrl(html, next))}
                showPreview
              />
              <Input
                className="mt-3"
                label="Visual direction"
                value={imageBrief}
                placeholder="Optional — Gandhi Jayanti, Pro Plan, festive…"
                onChange={(e) => setImageBrief(e.target.value)}
              />
              <button
                type="button"
                disabled={generating || !String(template.session_id || "").trim()}
                onClick={() => void generateHero()}
                className="mt-2 inline-flex h-[38px] w-full items-center justify-center gap-1.5 rounded-lg border border-[#bfbfbf] bg-white px-3 text-xs font-medium text-text-primary disabled:opacity-50"
              >
                {generating ? (
                  <Loader2 className="size-[18px] animate-spin" />
                ) : (
                  <Sparkles className="size-[18px]" strokeWidth={2.25} />
                )}
                {generating ? "Generating…" : "Generate with AI"}
              </button>
              <p className="mt-3 text-xs leading-5 text-text-caption">
                Generate a Gemini hero, or upload / paste a public URL. Save
                writes the same URL into the email HTML.
              </p>
            </>
          ) : null}

          {leftTab === "footer" ? (
            <>
              <p className="mb-2 text-[11px] font-semibold tracking-wide text-text-caption uppercase">
                Footer
              </p>
              <p className="mb-2 text-xs text-text-caption">Alignment</p>
              <div className="flex gap-1 rounded-lg border border-[#bfbfbf] p-0.5">
                {(
                  [
                    ["left", AlignLeft],
                    ["center", AlignCenter],
                    ["right", AlignRight],
                  ] as const
                ).map(([id, Icon]) => (
                  <button
                    key={id}
                    type="button"
                    aria-label={`Align ${id}`}
                    onClick={() =>
                      setHtml(setComposeFooterAlign(html, id as FooterAlign))
                    }
                    className={`inline-flex h-[38px] flex-1 items-center justify-center rounded-md ${
                      inspect.footerAlign === id
                        ? "bg-[#111111] text-white"
                        : "text-text-caption hover:bg-neutral-50"
                    }`}
                  >
                    <Icon className="size-[18px]" strokeWidth={2.25} />
                  </button>
                ))}
              </div>
              <p className="mt-3 text-xs leading-5 text-text-caption">
                Unsubscribe is always a link. Send replaces it with the live
                opt-out URL. Align left, center, or right.
              </p>
            </>
          ) : null}
        </aside>

        <section className="flex min-h-0 flex-col bg-[#f3f4f6] p-4 sm:p-6">
          <div
            className={`chat-scroll-xs mx-auto min-h-0 w-full flex-1 overflow-auto ${
              device === "mobile" ? "max-w-[390px]" : "max-w-[640px]"
            }`}
          >
            {mode === "preview" ? (
              <div className="overflow-hidden rounded-2xl border border-[#bfbfbf] bg-white">
                {subject ? (
                  <p className="border-b border-[#e5e5e5] px-4 py-2 text-sm text-neutral-800">
                    <span className="font-semibold">Subject:</span> {subject}
                  </p>
                ) : null}
                <iframe
                  ref={iframeRef}
                  title="Email canvas"
                  sandbox="allow-same-origin"
                  srcDoc={previewComposeHtml(html)}
                  onLoad={enableCanvasEdit}
                  onBlur={syncFromIframe}
                  className="w-full bg-white"
                  style={{ height: 720, border: 0 }}
                />
              </div>
            ) : (
              <textarea
                value={html}
                onChange={(e) => setHtml(e.target.value)}
                spellCheck={false}
                className="min-h-[720px] w-full rounded-2xl border border-[#bfbfbf] bg-white p-3 font-mono text-[11px] leading-5 text-neutral-800 outline-none focus:border-[#111111]"
              />
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
