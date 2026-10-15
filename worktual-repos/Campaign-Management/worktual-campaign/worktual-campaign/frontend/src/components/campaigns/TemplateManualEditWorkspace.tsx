import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowLeft,
  Bold,
  CloudUpload,
  Columns2,
  Crop,
  Folder,
  Highlighter,
  Image as ImageIcon,
  IndentDecrease,
  IndentIncrease,
  Italic,
  LayoutGrid,
  LayoutTemplate,
  List,
  ListOrdered,
  Loader2,
  Minus,
  Monitor,
  Paintbrush,
  Palette,
  Redo2,
  Shapes,
  Smartphone,
  Square,
  Strikethrough,
  Type,
  Underline,
  Undo2,
} from "lucide-react";
import {
  ChannelTemplatePreview,
  hasEmailAb,
  type TemplateFields,
} from "@/components/campaigns/ChannelTemplatePreview";
import { EditableEmailCanvas } from "@/components/campaigns/EditableEmailCanvas";
import { TemplateImagePicker } from "@/components/campaigns/TemplateImagePicker";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import {
  CHANNEL_LIMITS,
  capText,
  evaluateChannelConstraints,
  hardIssues,
  WHATSAPP_BUTTONS_MAX,
  WHATSAPP_BUTTON_LABEL_MAX,
} from "@/lib/channel-template-constraints";
import {
  canvasFillFromTheme,
  createEmailBlock,
  duplicateEmailBlock,
  EMAIL_CANVAS_ID,
  emailBlocksToFields,
  fieldsToEmailBlocks,
  initialEmailSelectionId,
  insertEmailBlock,
  moveEmailBlock,
  isEmailCellImage,
  parseColumnCells,
  writeColumnCell,
  type CanvasFill,
  type EmailBlock,
  type EmailBlockStyle,
  type EmailBlockType,
} from "@/lib/email-template-blocks";
import { getToken } from "@/services/api";
import { getAgentsSocket, type TemplateCard } from "@/services/agents.socket";
import { patchChannelTemplateFields } from "@/services/channelTemplates.api";

type IdeaChatRow = { role?: string; text?: string };

type Props = {
  template: TemplateCard;
  campaignTitle: string;
  campaign?: { name?: string; goal?: string; objective?: string };
  ideaChat?: IdeaChatRow[];
  abVariant: "a" | "b";
  onAbVariantChange: (v: "a" | "b") => void;
  onBackToAi: () => void;
  onSaved: (next: TemplateCard) => void;
};

type CoachReply = {
  ok?: boolean;
  walkthrough?: string;
  issues?: string[];
  apply?: boolean;
  corrected_content?: string | null;
  field_patches?: Record<string, string>;
  alternatives?: string[];
  needs_input?: boolean;
  question?: string;
};

type LeftTab =
  | "templates"
  | "elements"
  | "brand"
  | "uploads"
  | "projects"
  | "apps";
type ClarifyMsg = { role: "assistant" | "user"; text: string };
type ToolbarMenuId =
  | "fill"
  | "align"
  | "radius"
  | "heading"
  | "spacing"
  | null;
type EditorSnap = { blocks: EmailBlock[]; canvasFill: CanvasFill };

function cloneEditorSnap(
  blocks: EmailBlock[],
  canvasFill: CanvasFill,
): EditorSnap {
  return {
    blocks: JSON.parse(JSON.stringify(blocks)) as EmailBlock[],
    canvasFill: { ...canvasFill },
  };
}

function isVariantBlob(raw: unknown): raw is TemplateFields {
  return Boolean(raw && typeof raw === "object" && !Array.isArray(raw));
}

function editableSlice(
  fields: TemplateFields,
  channel: string,
  abVariant: "a" | "b",
): TemplateFields {
  if (channel === "email" && hasEmailAb(fields)) {
    const nested = abVariant === "a" ? fields.variant_a : fields.variant_b;
    if (isVariantBlob(nested)) return { ...nested };
  }
  return { ...fields };
}

function mergeEditedFields(
  base: TemplateFields,
  edited: TemplateFields,
  channel: string,
  abVariant: "a" | "b",
): TemplateFields {
  if (channel === "email" && hasEmailAb(base)) {
    const key = abVariant === "a" ? "variant_a" : "variant_b";
    return { ...base, [key]: edited };
  }
  return edited;
}

function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <label className="mb-1 block text-[11px] font-semibold tracking-wide text-text-caption uppercase">
      {children}
    </label>
  );
}

function LimitedTextArea({
  label,
  value,
  onChange,
  max,
  warnAt,
  rows = 4,
  locked,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  max: number;
  warnAt?: number;
  rows?: number;
  locked?: boolean;
}) {
  const overWarn = warnAt != null && value.length >= warnAt;
  const atMax = value.length >= max;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <FieldLabel>{label}</FieldLabel>
        <span
          className={`text-[10px] tabular-nums ${
            atMax
              ? "font-semibold text-text-danger"
              : overWarn
                ? "text-amber-700"
                : "text-text-caption"
          }`}
        >
          {value.length}/{max}
        </span>
      </div>
      <textarea
        value={value}
        disabled={locked}
        onChange={(e) => onChange(capText(e.target.value, max))}
        rows={rows}
        className="w-full resize-y rounded-xl border border-border-default bg-white px-3 py-2 text-sm text-text-primary outline-none focus:border-neutral-900 disabled:bg-subtle disabled:text-text-caption"
        spellCheck
      />
    </div>
  );
}

const FONT_OPTIONS = [
  { label: "Arial", value: "Arial, Helvetica, sans-serif" },
  { label: "Georgia", value: "Georgia, serif" },
  { label: "Inter", value: "Inter, system-ui, sans-serif" },
  { label: "Helvetica", value: "Helvetica, Arial, sans-serif" },
  { label: "Times", value: "Times New Roman, Times, serif" },
];

const HEADING_PRESETS = [
  { id: "h1" as const, label: "H1", fontSize: 32, fontWeight: "bold" as const, type: "heading" as const },
  { id: "h2" as const, label: "H2", fontSize: 24, fontWeight: "bold" as const, type: "heading" as const },
  { id: "h3" as const, label: "H3", fontSize: 18, fontWeight: "bold" as const, type: "heading" as const },
  { id: "p" as const, label: "P", fontSize: 15, fontWeight: "normal" as const, type: "text" as const },
];

const LINE_SPACING = [1, 1.15, 1.5, 1.75, 2];

function headingPresetId(block: EmailBlock | null): (typeof HEADING_PRESETS)[number]["id"] {
  if (!block) return "p";
  const size = block.style?.fontSize ?? (block.type === "heading" ? 22 : 15);
  if (size >= 28) return "h1";
  if (size >= 22) return "h2";
  if (block.type === "heading" || size >= 18) return "h3";
  return "p";
}

function fillCssPreview(fill: CanvasFill): string | null {
  const from = fill.gradientFrom?.trim();
  const to = fill.gradientTo?.trim();
  if (from && to) return `linear-gradient(90deg, ${from}, ${to})`;
  const solid = fill.backgroundColor?.trim();
  return solid || null;
}

function ToolbarIconBtn({
  label,
  pressed,
  disabled,
  onClick,
  children,
}: {
  label: string;
  pressed?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex size-8 shrink-0 items-center justify-center rounded-lg ${
        pressed
          ? "bg-neutral-200 text-neutral-900"
          : "text-[#4b4b4b] hover:bg-neutral-100"
      } disabled:cursor-not-allowed disabled:opacity-35`}
    >
      {children}
    </button>
  );
}

function ToolbarPopover({
  open,
  align = "center",
  children,
}: {
  open: boolean;
  align?: "start" | "center" | "end";
  children: ReactNode;
}) {
  if (!open) return null;
  const pos =
    align === "start"
      ? "left-0"
      : align === "end"
        ? "right-0"
        : "left-1/2 -translate-x-1/2";
  return (
    <div
      className={`absolute top-[calc(100%+10px)] z-30 min-w-[13rem] ${pos} rounded-xl border border-neutral-200 bg-white p-3 shadow-lg`}
    >
      {children}
    </div>
  );
}

function FillSwatches({
  fill,
  onLive,
  onCommit,
}: {
  fill: CanvasFill;
  onLive?: (next: CanvasFill) => void;
  onCommit: (next: CanvasFill) => void;
}) {
  const solid = fill.backgroundColor || "#ffffff";
  const from = fill.gradientFrom || "#1e3a8a";
  const to = fill.gradientTo || "#93c5fd";
  const emit = (next: CanvasFill, commit: boolean) => {
    if (commit) onCommit(next);
    else if (onLive) onLive(next);
    else onCommit(next);
  };
  return (
    <div className="space-y-2">
      <p className="text-[11px] font-semibold tracking-wide text-text-caption uppercase">
        Fill
      </p>
      <button
        type="button"
        className="w-full rounded-lg border border-border-default px-2 py-1.5 text-left text-xs text-text-secondary hover:bg-neutral-50"
        onClick={() =>
          onCommit({
            backgroundColor: undefined,
            gradientFrom: undefined,
            gradientTo: undefined,
          })
        }
      >
        No fill
      </button>
      <label className="flex items-center justify-between gap-2 text-xs text-text-secondary">
        Solid
        <input
          type="color"
          value={solid}
          onInput={(e) =>
            emit(
              {
                backgroundColor: (e.target as HTMLInputElement).value,
                gradientFrom: undefined,
                gradientTo: undefined,
              },
              false,
            )
          }
          onChange={(e) =>
            emit(
              {
                backgroundColor: e.target.value,
                gradientFrom: undefined,
                gradientTo: undefined,
              },
              true,
            )
          }
          className="size-7 cursor-pointer rounded border-0 bg-transparent p-0"
        />
      </label>
      <label className="flex items-center justify-between gap-2 text-xs text-text-secondary">
        Gradient start
        <input
          type="color"
          value={from}
          onInput={(e) =>
            emit(
              {
                ...fill,
                gradientFrom: (e.target as HTMLInputElement).value,
                gradientTo: fill.gradientTo || to,
              },
              false,
            )
          }
          onChange={(e) =>
            emit(
              {
                ...fill,
                gradientFrom: e.target.value,
                gradientTo: fill.gradientTo || to,
              },
              true,
            )
          }
          className="size-7 cursor-pointer rounded border-0 bg-transparent p-0"
        />
      </label>
      <label className="flex items-center justify-between gap-2 text-xs text-text-secondary">
        Gradient end
        <input
          type="color"
          value={to}
          onInput={(e) =>
            emit(
              {
                ...fill,
                gradientFrom: fill.gradientFrom || from,
                gradientTo: (e.target as HTMLInputElement).value,
              },
              false,
            )
          }
          onChange={(e) =>
            emit(
              {
                ...fill,
                gradientFrom: fill.gradientFrom || from,
                gradientTo: e.target.value,
              },
              true,
            )
          }
          className="size-7 cursor-pointer rounded border-0 bg-transparent p-0"
        />
      </label>
    </div>
  );
}

function CanvasFormatToolbar({
  selected,
  canvasFill,
  onCanvasFill,
  onStyle,
  onPatch,
  paintArmed,
  onPaint,
}: {
  selected: EmailBlock | null;
  canvasFill: CanvasFill;
  onCanvasFill: (next: CanvasFill, mode?: "live" | "commit") => void;
  onStyle: (patch: Partial<EmailBlockStyle>, mode?: "live" | "commit") => void;
  onPatch: (patch: Partial<EmailBlock>) => void;
  paintArmed: boolean;
  onPaint: () => void;
}) {
  const [menu, setMenu] = useState<ToolbarMenuId>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const canvasOnly = !selected;
  const locked = Boolean(selected?.locked);
  const size = selected?.style?.fontSize ?? 15;
  const align = selected?.style?.textAlign || "left";
  const bold = selected?.style?.fontWeight === "bold";
  const italic = selected?.style?.fontStyle === "italic";
  const underline = selected?.style?.textDecoration === "underline";
  const strike = selected?.style?.textDecoration === "line-through";
  const list = selected?.style?.listStyle || "none";
  const radius = selected?.style?.borderRadius ?? 0;
  const headingId = headingPresetId(selected);
  const textTools =
    !!selected &&
    !locked &&
    (selected.type === "text" ||
      selected.type === "heading" ||
      selected.type === "button" ||
      selected.type === "columns");
  const radiusTools =
    !!selected &&
    !locked &&
    (selected.type === "image" ||
      selected.type === "button" ||
      selected.type === "banner" ||
      selected.type === "heading" ||
      selected.type === "text");
  const blockFill: CanvasFill = {
    backgroundColor: selected?.style?.backgroundColor,
    gradientFrom: selected?.style?.gradientFrom,
    gradientTo: selected?.style?.gradientTo,
  };
  const activeFill = canvasOnly ? canvasFill : blockFill;
  const fillPreview = fillCssPreview(activeFill);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!barRef.current?.contains(e.target as Node)) setMenu(null);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const applyFill = (next: CanvasFill, mode: "live" | "commit" = "commit") => {
    if (canvasOnly) {
      onCanvasFill(next, mode);
      return;
    }
    onStyle(
      {
        backgroundColor: next.backgroundColor,
        gradientFrom: next.gradientFrom,
        gradientTo: next.gradientTo,
      },
      mode,
    );
  };

  return (
    <div
      ref={barRef}
      className="mb-4 flex max-w-full items-center justify-center"
    >
      <div className="flex max-w-full flex-wrap items-center justify-center gap-0.5 rounded-full border border-neutral-200 bg-white px-2 py-1 shadow-[0_8px_24px_rgba(17,17,17,0.08)]">
        <div className="relative">
          <button
            type="button"
            title="Fill"
            aria-label="Fill"
            disabled={locked}
            onClick={() => setMenu(menu === "fill" ? null : "fill")}
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg hover:bg-neutral-100 disabled:opacity-35"
          >
            <span
              className="relative block size-[18px] overflow-hidden rounded-full border border-neutral-300"
              style={{
                background: fillPreview || "#ffffff",
              }}
            >
              {!fillPreview ? (
                <span
                  className="absolute inset-[-2px] block origin-center rotate-[-45deg] border-t-2 border-red-500"
                  aria-hidden
                />
              ) : null}
            </span>
          </button>
          <ToolbarPopover open={menu === "fill"} align="start">
            <FillSwatches
              fill={activeFill}
              onLive={(next) => applyFill(next, "live")}
              onCommit={(next) => applyFill(next, "commit")}
            />
          </ToolbarPopover>
        </div>

        <div className="relative">
          <ToolbarIconBtn
            label="Align"
            disabled={canvasOnly || locked}
            pressed={menu === "align"}
            onClick={() => setMenu(menu === "align" ? null : "align")}
          >
            {align === "center" ? (
              <AlignCenter className="size-[18px]" strokeWidth={1.75} />
            ) : align === "right" ? (
              <AlignRight className="size-[18px]" strokeWidth={1.75} />
            ) : (
              <AlignLeft className="size-[18px]" strokeWidth={1.75} />
            )}
          </ToolbarIconBtn>
          <ToolbarPopover open={menu === "align"} align="start">
            <div className="flex gap-1">
              {(
                [
                  ["left", AlignLeft],
                  ["center", AlignCenter],
                  ["right", AlignRight],
                ] as const
              ).map(([value, Icon]) => (
                <ToolbarIconBtn
                  key={value}
                  label={`Align ${value}`}
                  pressed={align === value}
                  onClick={() => {
                    onStyle({ textAlign: value });
                    setMenu(null);
                  }}
                >
                  <Icon className="size-[18px]" strokeWidth={1.75} />
                </ToolbarIconBtn>
              ))}
            </div>
          </ToolbarPopover>
        </div>

        <div className="relative">
          <ToolbarIconBtn
            label="Corner rounding"
            disabled={!radiusTools}
            pressed={menu === "radius"}
            onClick={() => setMenu(menu === "radius" ? null : "radius")}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
              <path
                d="M4 14V8.5C4 6 6 4 8.5 4H14"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
              />
            </svg>
          </ToolbarIconBtn>
          <ToolbarPopover open={menu === "radius"} align="start">
            <label className="block text-[11px] font-semibold tracking-wide text-text-caption uppercase">
              Corner rounding
            </label>
            <input
              type="range"
              min={0}
              max={40}
              value={radius}
              onInput={(e) =>
                onStyle(
                  { borderRadius: Number((e.target as HTMLInputElement).value) },
                  "live",
                )
              }
              onPointerUp={(e) =>
                onStyle(
                  { borderRadius: Number((e.target as HTMLInputElement).value) },
                  "commit",
                )
              }
              className="mt-2 w-full"
            />
            <p className="mt-1 text-right text-xs tabular-nums text-text-secondary">
              {radius}px
            </p>
          </ToolbarPopover>
        </div>

        <ToolbarIconBtn
          label="Crop (next editor step)"
          disabled
        >
          <Crop className="size-[18px]" strokeWidth={1.75} />
        </ToolbarIconBtn>

        <span className="mx-1 h-5 w-px shrink-0 bg-neutral-200" />

        <div className="relative">
          <button
            type="button"
            title="Heading"
            aria-label="Heading"
            disabled={!textTools}
            onClick={() => setMenu(menu === "heading" ? null : "heading")}
            className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-[#4b4b4b] hover:bg-neutral-100 disabled:opacity-35"
          >
            {headingId.toUpperCase()}
            <span className="text-[9px] text-neutral-400">▾</span>
          </button>
          <ToolbarPopover open={menu === "heading"}>
            <div className="flex flex-col gap-0.5">
              {HEADING_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className={`rounded-lg px-2 py-1.5 text-left text-xs ${
                    headingId === preset.id
                      ? "bg-neutral-900 text-white"
                      : "text-text-primary hover:bg-neutral-50"
                  }`}
                  onClick={() => {
                    if (!selected) return;
                    const nextType =
                      selected.type === "text" || selected.type === "heading"
                        ? preset.type
                        : selected.type;
                    onPatch({
                      type: nextType,
                      style: {
                        ...(selected.style || {}),
                        fontSize: preset.fontSize,
                        fontWeight: preset.fontWeight,
                      },
                    });
                    setMenu(null);
                  }}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </ToolbarPopover>
        </div>

        <select
          aria-label="Font"
          disabled={!textTools}
          value={selected?.style?.fontFamily || FONT_OPTIONS[0].value}
          onChange={(e) => onStyle({ fontFamily: e.target.value })}
          className="h-8 max-w-[7.25rem] shrink-0 rounded-lg border border-neutral-200 bg-white px-2 text-xs text-text-primary outline-none disabled:opacity-35"
        >
          {FONT_OPTIONS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>

        <div className="ml-0.5 inline-flex h-8 shrink-0 items-center rounded-full border border-neutral-200 px-1">
          <button
            type="button"
            aria-label="Smaller"
            disabled={!textTools}
            className="inline-flex size-6 items-center justify-center rounded-full text-sm text-text-secondary hover:bg-neutral-50 disabled:opacity-35"
            onClick={() => onStyle({ fontSize: Math.max(10, size - 1) })}
          >
            −
          </button>
          <span className="min-w-[1.35rem] text-center text-xs tabular-nums text-text-primary">
            {textTools ? size : "–"}
          </span>
          <button
            type="button"
            aria-label="Larger"
            disabled={!textTools}
            className="inline-flex size-6 items-center justify-center rounded-full text-sm text-text-secondary hover:bg-neutral-50 disabled:opacity-35"
            onClick={() => onStyle({ fontSize: Math.min(48, size + 1) })}
          >
            +
          </button>
        </div>

        <label
          title="Text color"
          className={`relative inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg hover:bg-neutral-100 ${
            textTools ? "" : "pointer-events-none opacity-35"
          }`}
        >
          <span className="sr-only">Text color</span>
          <span className="flex flex-col items-center">
            <span className="text-[13px] font-semibold leading-none text-[#4b4b4b]">
              A
            </span>
            <span
              className="mt-0.5 h-[3px] w-3.5 rounded-sm"
              style={{ backgroundColor: selected?.style?.color || "#111827" }}
            />
          </span>
          <input
            type="color"
            disabled={!textTools}
            value={selected?.style?.color || "#374151"}
            onChange={(e) => onStyle({ color: e.target.value })}
            className="absolute inset-0 cursor-pointer opacity-0"
          />
        </label>

        <label
          title="Highlight"
          className={`relative inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg hover:bg-neutral-100 ${
            textTools ? "" : "pointer-events-none opacity-35"
          }`}
        >
          <span className="sr-only">Highlight</span>
          <Highlighter className="size-[18px] text-[#4b4b4b]" strokeWidth={1.75} />
          <span
            className="absolute bottom-1 h-[3px] w-3.5 rounded-sm"
            style={{
              backgroundColor: selected?.style?.highlightColor || "#fde68a",
            }}
          />
          <input
            type="color"
            disabled={!textTools}
            value={selected?.style?.highlightColor || "#fde68a"}
            onChange={(e) => onStyle({ highlightColor: e.target.value })}
            className="absolute inset-0 cursor-pointer opacity-0"
          />
        </label>

        <ToolbarIconBtn
          label="Bold"
          disabled={!textTools}
          pressed={bold}
          onClick={() => onStyle({ fontWeight: bold ? "normal" : "bold" })}
        >
          <Bold className="size-[18px]" strokeWidth={2.25} />
        </ToolbarIconBtn>
        <ToolbarIconBtn
          label="Italic"
          disabled={!textTools}
          pressed={italic}
          onClick={() => onStyle({ fontStyle: italic ? "normal" : "italic" })}
        >
          <Italic className="size-[18px]" strokeWidth={1.75} />
        </ToolbarIconBtn>
        <ToolbarIconBtn
          label="Underline"
          disabled={!textTools}
          pressed={underline}
          onClick={() =>
            onStyle({ textDecoration: underline ? "none" : "underline" })
          }
        >
          <Underline className="size-[18px]" strokeWidth={1.75} />
        </ToolbarIconBtn>
        <ToolbarIconBtn
          label="Strikethrough"
          disabled={!textTools}
          pressed={strike}
          onClick={() =>
            onStyle({ textDecoration: strike ? "none" : "line-through" })
          }
        >
          <Strikethrough className="size-[18px]" strokeWidth={1.75} />
        </ToolbarIconBtn>

        <ToolbarIconBtn
          label="Bulleted list"
          disabled={!textTools}
          pressed={list === "disc"}
          onClick={() =>
            onStyle({ listStyle: list === "disc" ? "none" : "disc" })
          }
        >
          <List className="size-[18px]" strokeWidth={1.75} />
        </ToolbarIconBtn>
        <ToolbarIconBtn
          label="Numbered list"
          disabled={!textTools}
          pressed={list === "decimal"}
          onClick={() =>
            onStyle({ listStyle: list === "decimal" ? "none" : "decimal" })
          }
        >
          <ListOrdered className="size-[18px]" strokeWidth={1.75} />
        </ToolbarIconBtn>

        <div className="relative">
          <ToolbarIconBtn
            label="Line spacing"
            disabled={!textTools}
            pressed={menu === "spacing"}
            onClick={() => setMenu(menu === "spacing" ? null : "spacing")}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
              <path
                d="M4 4h10M4 9h10M4 14h10"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
              <path
                d="M14.5 6.5V3.5L16 5M14.5 11.5v3L16 13"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </ToolbarIconBtn>
          <ToolbarPopover open={menu === "spacing"}>
            <p className="mb-1 text-[11px] font-semibold tracking-wide text-text-caption uppercase">
              Line spacing
            </p>
            {LINE_SPACING.map((value) => (
              <button
                key={value}
                type="button"
                className={`block w-full rounded-lg px-2 py-1.5 text-left text-xs ${
                  (selected?.style?.lineHeight || 1.4) === value
                    ? "bg-neutral-900 text-white"
                    : "text-text-primary hover:bg-neutral-50"
                }`}
                onClick={() => {
                  onStyle({ lineHeight: value });
                  setMenu(null);
                }}
              >
                {value}
              </button>
            ))}
          </ToolbarPopover>
        </div>

        <ToolbarIconBtn
          label="Increase indent"
          disabled={!textTools}
          onClick={() =>
            onStyle({
              paddingLeft: Math.min(64, (selected?.style?.paddingLeft || 0) + 16),
            })
          }
        >
          <IndentIncrease className="size-[18px]" strokeWidth={1.75} />
        </ToolbarIconBtn>
        <ToolbarIconBtn
          label="Decrease indent"
          disabled={!textTools}
          onClick={() =>
            onStyle({
              paddingLeft: Math.max(0, (selected?.style?.paddingLeft || 0) - 16),
            })
          }
        >
          <IndentDecrease className="size-[18px]" strokeWidth={1.75} />
        </ToolbarIconBtn>

        <ToolbarIconBtn
          label="Paint format"
          disabled={canvasOnly || locked}
          pressed={paintArmed}
          onClick={onPaint}
        >
          <Paintbrush className="size-[18px]" strokeWidth={1.75} />
        </ToolbarIconBtn>
      </div>
    </div>
  );
}

const ELEMENT_TOOLS: Array<{
  type: Exclude<EmailBlockType, "subject" | "banner">;
  label: string;
  icon: typeof Type;
}> = [
  { type: "image", label: "Image", icon: ImageIcon },
  { type: "text", label: "Text", icon: Type },
  { type: "heading", label: "Heading", icon: Type },
  { type: "button", label: "Button", icon: Square },
  { type: "columns", label: "2 cells", icon: Columns2 },
  { type: "divider", label: "Divider", icon: Minus },
];

const LEFT_TABS: Array<{
  id: LeftTab;
  label: string;
  icon: typeof Type;
}> = [
  { id: "templates", label: "Templates", icon: LayoutTemplate },
  { id: "elements", label: "Elements", icon: Shapes },
  { id: "brand", label: "Brand", icon: Palette },
  { id: "uploads", label: "Uploads", icon: CloudUpload },
  { id: "projects", label: "Projects", icon: Folder },
  { id: "apps", label: "Apps", icon: LayoutGrid },
];

const EMAIL_LAYOUTS: Array<{
  id: string;
  label: string;
  types: Array<Exclude<EmailBlockType, "subject" | "banner">>;
}> = [
  { id: "hero-cta", label: "Hero + CTA", types: ["image", "heading", "text", "button"] },
  { id: "heading-text", label: "Heading + text", types: ["heading", "text"] },
  { id: "announce", label: "Announcement", types: ["heading", "text", "button"] },
  { id: "photo-note", label: "Photo + note", types: ["image", "text"] },
];

const EMOJI_PICKER = [
  "😊",
  "🎉",
  "✨",
  "🔥",
  "✅",
  "💡",
  "📅",
  "🎁",
  "🚀",
  "❤️",
  "👍",
  "🌟",
  "👋",
  "💼",
  "📣",
  "🔗",
];

const SOCIAL_ICON_PRESETS: Array<{
  id: string;
  label: string;
  href: string;
}> = [
  { id: "instagram", label: "Instagram", href: "https://instagram.com/" },
  { id: "whatsapp", label: "WhatsApp", href: "https://wa.me/" },
  { id: "facebook", label: "Facebook", href: "https://facebook.com/" },
  { id: "email", label: "Email", href: "mailto:" },
];

function patchEmailBlocksFromFields(
  prev: EmailBlock[],
  patches: Record<string, string>,
): EmailBlock[] {
  if (!Object.keys(patches).length) return prev;
  const body = patches.body || patches.greeting;
  const headingText = patches.heading || patches.title;
  let usedBody = false;
  let usedHeading = false;
  return prev.map((b) => {
    if (b.locked) return b;
    if (b.type === "subject" && patches.subject != null) {
      return { ...b, content: patches.subject };
    }
    if (b.type === "heading" && headingText && !usedHeading) {
      usedHeading = true;
      return { ...b, content: headingText };
    }
    if (
      body &&
      !usedBody &&
      (b.type === "text" || (b.type === "heading" && usedHeading))
    ) {
      if (b.type === "text") {
        usedBody = true;
        return { ...b, content: body };
      }
    }
    if (b.type === "button" && patches.cta_label != null) {
      return {
        ...b,
        content: patches.cta_label,
        ...(patches.cta_url ? { href: patches.cta_url } : {}),
      };
    }
    return b;
  });
}

function requestCoach(args: {
  sessionId: string;
  channel: string;
  mode: "assist" | "save_polish" | "save_clarify";
  campaign?: Props["campaign"];
  fields: Record<string, unknown>;
  selected: Record<string, unknown> | null;
  ideaChat?: IdeaChatRow[];
  instruction?: string;
}): Promise<CoachReply> {
  const requestId = `coach-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const socket = getAgentsSocket();
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      socket.off("template_coach_reply", onReply);
      resolve({
        ok: true,
        walkthrough: "Coach timed out. Limits still apply — you can save if they are green.",
        issues: [],
      });
    }, 20000);
    const onReply = (msg: CoachReply & { request_id?: string }) => {
      if (msg.request_id && msg.request_id !== requestId) return;
      window.clearTimeout(timer);
      socket.off("template_coach_reply", onReply);
      resolve(msg);
    };
    socket.on("template_coach_reply", onReply);
    socket.emit("template_coach_message", {
      session_id: args.sessionId,
      token: getToken(),
      channel: args.channel,
      mode: args.mode,
      request_id: requestId,
      campaign: args.campaign || {},
      fields: args.fields,
      selected: args.selected,
      idea_chat: args.ideaChat || [],
      instruction: args.instruction || "",
    });
  });
}

export function TemplateManualEditWorkspace({
  template,
  campaignTitle,
  campaign,
  ideaChat,
  abVariant,
  onAbVariantChange,
  onBackToAi,
  onSaved,
}: Props) {
  const channel = String(template.channel || "email").toLowerCase();
  const sessionId = String(template.session_id || "");
  const baseFields = (template.fields || {}) as TemplateFields;
  const emailAb = channel === "email" && hasEmailAb(baseFields);
  const isEmail = channel === "email";

  const slice = useMemo(
    () => editableSlice(baseFields, channel, abVariant),
    [baseFields, channel, abVariant],
  );

  const [blocks, setBlocks] = useState<EmailBlock[]>(() =>
    isEmail ? fieldsToEmailBlocks(slice) : [],
  );
  const [blocksBaseline, setBlocksBaseline] = useState(() =>
    isEmail ? JSON.stringify(fieldsToEmailBlocks(slice)) : "[]",
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<TemplateFields>(() => slice);
  const [draftBaseline, setDraftBaseline] = useState(() =>
    JSON.stringify(slice),
  );
  const [insertPlace, setInsertPlace] = useState<"below" | "above">("below");
  const [saving, setSaving] = useState(false);
  const [coachBusy, setCoachBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [clarifyOpen, setClarifyOpen] = useState(false);
  const [clarifyMessages, setClarifyMessages] = useState<ClarifyMsg[]>([]);
  const [clarifyInput, setClarifyInput] = useState("");
  const [leftTab, setLeftTab] = useState<LeftTab>("elements");
  const [docLink, setDocLink] = useState("");
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [canvasFill, setCanvasFill] = useState<CanvasFill>(() =>
    canvasFillFromTheme(slice.theme),
  );
  const [canvasFillBaseline, setCanvasFillBaseline] = useState(() =>
    JSON.stringify(canvasFillFromTheme(slice.theme)),
  );
  const [paintArmed, setPaintArmed] = useState(false);
  const paintRef = useRef<{ style: EmailBlockStyle; fromId: string } | null>(
    null,
  );
  const [activeCell, setActiveCell] = useState<"a" | "b">("a");
  const leaveAfterSaveRef = useRef(false);
  const [historyTick, setHistoryTick] = useState(0);
  const historyRef = useRef<{ undo: EditorSnap[]; redo: EditorSnap[] }>({
    undo: [],
    redo: [],
  });
  const blocksRef = useRef(blocks);
  const fillRef = useRef(canvasFill);
  const gestureSnapRef = useRef<EditorSnap | null>(null);
  blocksRef.current = blocks;
  fillRef.current = canvasFill;

  useEffect(() => {
    const next = editableSlice(baseFields, channel, abVariant);
    setDraft(next);
    setDraftBaseline(JSON.stringify(next));
    if (channel === "email") {
      const nextBlocks = fieldsToEmailBlocks(next);
      setBlocks(nextBlocks);
      setBlocksBaseline(JSON.stringify(nextBlocks));
      setCanvasFill(canvasFillFromTheme(next.theme));
      setCanvasFillBaseline(JSON.stringify(canvasFillFromTheme(next.theme)));
      setSelectedId(initialEmailSelectionId(nextBlocks));
    } else {
      setBlocks([]);
      setBlocksBaseline("[]");
      setSelectedId(null);
    }
    setError(null);
    setSavedFlash(false);
    setClarifyOpen(false);
    setClarifyMessages([]);
    setLeaveOpen(false);
    historyRef.current = { undo: [], redo: [] };
    setHistoryTick((n) => n + 1);
  }, [template.template_id, channel, abVariant, template.fields]);

  const selected = blocks.find((b) => b.id === selectedId) || null;

  const emailDraftFields = useMemo(() => {
    if (!isEmail) return draft;
    return emailBlocksToFields(blocks, slice, canvasFill);
  }, [isEmail, blocks, draft, slice, canvasFill]);

  const previewFields = useMemo(
    () => mergeEditedFields(baseFields, emailDraftFields, channel, abVariant),
    [baseFields, emailDraftFields, channel, abVariant],
  );

  const constraintFields = isEmail
    ? (emailDraftFields as Record<string, unknown>)
    : (draft as Record<string, unknown>);

  const liveIssues = useMemo(
    () => evaluateChannelConstraints(channel, constraintFields),
    [channel, constraintFields],
  );
  const blocking = hardIssues(liveIssues);
  const soft = liveIssues.filter((i) => i.severity === "soft");

  const dirty = useMemo(() => {
    if (isEmail) {
      return (
        JSON.stringify(blocks) !== blocksBaseline ||
        JSON.stringify(canvasFill) !== canvasFillBaseline
      );
    }
    return JSON.stringify(draft) !== draftBaseline;
  }, [isEmail, blocks, blocksBaseline, canvasFill, canvasFillBaseline, draft, draftBaseline]);

  const persist = async (
    edited: TemplateFields,
    nextBlocks?: EmailBlock[],
  ) => {
    const nextFields = mergeEditedFields(baseFields, edited, channel, abVariant);
    const updated = await patchChannelTemplateFields(
      template.template_id,
      nextFields,
    );
    onSaved({
      ...template,
      ...updated,
      fields: updated?.fields || nextFields,
    });
    if (isEmail) {
      setBlocksBaseline(JSON.stringify(nextBlocks ?? blocks));
      setCanvasFillBaseline(JSON.stringify(canvasFill));
    } else {
      setDraftBaseline(JSON.stringify(edited));
    }
    setSavedFlash(true);
    window.setTimeout(() => setSavedFlash(false), 2000);
  };

  const selectedSnapshot = () =>
    selected
      ? {
          id: selected.id,
          type: selected.type,
          content: selected.content,
          locked: Boolean(selected.locked),
        }
      : null;

  const openClarify = (question: string) => {
    setClarifyMessages([{ role: "assistant", text: question }]);
    setClarifyInput("");
    setClarifyOpen(true);
  };

  const finishSave = async (
    edited: TemplateFields,
    nextBlocks?: EmailBlock[],
  ) => {
    await persist(edited, nextBlocks);
    setClarifyOpen(false);
    if (leaveAfterSaveRef.current) {
      leaveAfterSaveRef.current = false;
      onBackToAi();
    }
  };

  const save = async () => {
    if (!template.template_id || saving) return;
    if (blocking.length > 0) {
      setError(blocking[0].message);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      let workingBlocks = blocks;
      let workingDraft: TemplateFields = isEmail
        ? emailBlocksToFields(blocks, slice, canvasFill)
        : draft;

      if (sessionId) {
        setCoachBusy(true);
        const reply = await requestCoach({
          sessionId,
          channel,
          mode: "save_polish",
          campaign: { name: campaign?.name || campaignTitle, ...campaign },
          fields: workingDraft as Record<string, unknown>,
          selected: selectedSnapshot(),
          ideaChat,
        });
        setCoachBusy(false);
        if (reply.needs_input && (reply.question || reply.walkthrough)) {
          openClarify(reply.question || reply.walkthrough || "");
          return;
        }
        const patches = reply.field_patches || {};
        if (Object.keys(patches).length > 0) {
          if (isEmail) {
            workingBlocks = patchEmailBlocksFromFields(blocks, patches);
            historyRef.current.undo = [
              ...historyRef.current.undo,
              cloneEditorSnap(blocks, canvasFill),
            ].slice(-40);
            historyRef.current.redo = [];
            setBlocks(workingBlocks);
            setHistoryTick((n) => n + 1);
            workingDraft = emailBlocksToFields(workingBlocks, slice, canvasFill);
          } else {
            workingDraft = { ...draft, ...patches };
            setDraft(workingDraft);
          }
        }
      }

      await finishSave(workingDraft, workingBlocks);
    } catch (err) {
      leaveAfterSaveRef.current = false;
      setError(
        err instanceof Error ? err.message : "Could not save template changes",
      );
    } finally {
      setCoachBusy(false);
      setSaving(false);
    }
  };

  const sendClarify = async () => {
    const text = clarifyInput.trim();
    if (!text || !sessionId || coachBusy) return;
    setClarifyInput("");
    setClarifyMessages((prev) => [...prev, { role: "user", text }]);
    setCoachBusy(true);
    setError(null);
    try {
      const workingDraft: TemplateFields = isEmail
        ? emailBlocksToFields(blocks, slice, canvasFill)
        : draft;
      const reply = await requestCoach({
        sessionId,
        channel,
        mode: "save_clarify",
        campaign: { name: campaign?.name || campaignTitle, ...campaign },
        fields: workingDraft as Record<string, unknown>,
        selected: selectedSnapshot(),
        ideaChat,
        instruction: text,
      });
      const bot = reply.question || reply.walkthrough || "";
      if (bot) {
        setClarifyMessages((prev) => [
          ...prev,
          { role: "assistant", text: bot },
        ]);
      }
      if (reply.needs_input) return;
      let workingBlocks = blocks;
      let nextDraft = workingDraft;
      const patches = reply.field_patches || {};
      if (Object.keys(patches).length > 0) {
        if (isEmail) {
          workingBlocks = patchEmailBlocksFromFields(blocks, patches);
          historyRef.current.undo = [
            ...historyRef.current.undo,
            cloneEditorSnap(blocks, canvasFill),
          ].slice(-40);
          setBlocks(workingBlocks);
          setHistoryTick((n) => n + 1);
          nextDraft = emailBlocksToFields(workingBlocks, slice, canvasFill);
        } else {
          nextDraft = { ...draft, ...patches };
          setDraft(nextDraft);
        }
      }
      setSaving(true);
      await finishSave(nextDraft, workingBlocks);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not finish save",
      );
    } finally {
      setCoachBusy(false);
      setSaving(false);
    }
  };

  const requestLeave = () => {
    if (dirty) {
      setLeaveOpen(true);
      return;
    }
    onBackToAi();
  };

  const applyBlocks = (
    next: EmailBlock[] | ((prev: EmailBlock[]) => EmailBlock[]),
  ) => {
    if (gestureSnapRef.current) {
      historyRef.current.undo = [
        ...historyRef.current.undo,
        gestureSnapRef.current,
      ].slice(-40);
      gestureSnapRef.current = null;
    }
    historyRef.current.undo = [
      ...historyRef.current.undo,
      cloneEditorSnap(blocksRef.current, fillRef.current),
    ].slice(-40);
    historyRef.current.redo = [];
    setBlocks((prev) =>
      typeof next === "function" ? next(prev) : next,
    );
    setHistoryTick((n) => n + 1);
  };

  const beginGesture = () => {
    if (!gestureSnapRef.current) {
      gestureSnapRef.current = cloneEditorSnap(
        blocksRef.current,
        fillRef.current,
      );
      setHistoryTick((n) => n + 1);
    }
  };

  const commitGesture = () => {
    const start = gestureSnapRef.current;
    if (!start) return false;
    gestureSnapRef.current = null;
    historyRef.current.undo = [...historyRef.current.undo, start].slice(-40);
    historyRef.current.redo = [];
    setHistoryTick((n) => n + 1);
    return true;
  };

  const applyCanvasFill = (next: CanvasFill, mode: "live" | "commit" = "commit") => {
    if (mode === "live") {
      beginGesture();
      setCanvasFill(next);
      return;
    }
    if (!commitGesture()) {
      if (JSON.stringify(next) === JSON.stringify(fillRef.current)) return;
      historyRef.current.undo = [
        ...historyRef.current.undo,
        cloneEditorSnap(blocksRef.current, fillRef.current),
      ].slice(-40);
      historyRef.current.redo = [];
      setHistoryTick((n) => n + 1);
    }
    setCanvasFill(next);
  };

  const applyBannerFill = (
    next: CanvasFill,
    mode: "live" | "commit" = "commit",
  ) => {
    const apply = (prev: EmailBlock[]) =>
      prev.map((b) =>
        b.type === "banner"
          ? {
              ...b,
              style: {
                ...(b.style || {}),
                backgroundColor: next.backgroundColor,
                gradientFrom: next.gradientFrom,
                gradientTo: next.gradientTo,
              },
            }
          : b,
      );
    if (mode === "live") {
      beginGesture();
      setBlocks(apply);
      return;
    }
    if (commitGesture()) {
      setBlocks(apply);
      return;
    }
    applyBlocks(apply);
  };

  const patchStyle = (
    patch: Partial<EmailBlockStyle>,
    mode: "live" | "commit" = "commit",
  ) => {
    if (!selectedId || selected?.locked) return;
    const apply = (prev: EmailBlock[]) =>
      prev.map((b) =>
        b.id === selectedId
          ? { ...b, style: { ...(b.style || {}), ...patch } }
          : b,
      );
    if (mode === "live") {
      beginGesture();
      setBlocks(apply);
      return;
    }
    if (commitGesture()) {
      setBlocks(apply);
      return;
    }
    applyBlocks(apply);
  };

  useEffect(() => {
    const clip = paintRef.current;
    if (!clip || !paintArmed) return;
    if (!selectedId || selectedId === EMAIL_CANVAS_ID || selectedId === clip.fromId) {
      return;
    }
    const target = blocks.find((b) => b.id === selectedId);
    if (!target || target.locked) return;
    applyBlocks((prev) =>
      prev.map((b) =>
        b.id === selectedId
          ? { ...b, style: { ...(b.style || {}), ...clip.style } }
          : b,
      ),
    );
  }, [selectedId]);

  const undo = () => {
    if (gestureSnapRef.current) {
      const start = gestureSnapRef.current;
      gestureSnapRef.current = null;
      setBlocks(start.blocks);
      setCanvasFill(start.canvasFill);
      setHistoryTick((n) => n + 1);
      return;
    }
    const last = historyRef.current.undo.pop();
    if (!last) return;
    historyRef.current.redo.push(
      cloneEditorSnap(blocksRef.current, fillRef.current),
    );
    setBlocks(last.blocks);
    setCanvasFill(last.canvasFill);
    setHistoryTick((n) => n + 1);
  };

  const redo = () => {
    const next = historyRef.current.redo.pop();
    if (!next) return;
    gestureSnapRef.current = null;
    historyRef.current.undo.push(
      cloneEditorSnap(blocksRef.current, fillRef.current),
    );
    setBlocks(next.blocks);
    setCanvasFill(next.canvasFill);
    setHistoryTick((n) => n + 1);
  };

  const canUndo =
    historyTick >= 0 &&
    (historyRef.current.undo.length > 0 || Boolean(gestureSnapRef.current));
  const canRedo = historyTick >= 0 && historyRef.current.redo.length > 0;

  const addBlock = (type: Exclude<EmailBlockType, "subject" | "banner">) => {
    const block = createEmailBlock(type);
    applyBlocks((prev) => insertEmailBlock(prev, block, selectedId, insertPlace));
    setSelectedId(block.id);
    return block.id;
  };

  const insertLayout = (
    types: Array<Exclude<EmailBlockType, "subject" | "banner">>,
  ) => {
    const created = types.map((type) => createEmailBlock(type));
    applyBlocks((prev) => {
      let next = prev;
      let after = selectedId;
      for (const block of created) {
        next = insertEmailBlock(next, block, after, insertPlace);
        after = block.id;
      }
      return next;
    });
    if (created[0]) setSelectedId(created[0].id);
  };

  const togglePaint = () => {
    if (paintArmed) {
      paintRef.current = null;
      setPaintArmed(false);
      return;
    }
    if (!selected || selected.locked) return;
    paintRef.current = {
      style: { ...(selected.style || {}) },
      fromId: selected.id,
    };
    setPaintArmed(true);
  };

  const insertEmoji = (emoji: string) => {
    const sel = window.getSelection();
    const anchor = sel?.anchorNode;
    const el = (
      anchor instanceof Element ? anchor : anchor?.parentElement
    )?.closest("[data-email-edit]") as HTMLElement | null;

    if (el && sel && sel.rangeCount > 0 && el.contains(sel.anchorNode)) {
      const blockId = el.dataset.blockId || "";
      const cell = el.dataset.cell === "b" ? "b" : el.dataset.cell === "a" ? "a" : undefined;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        const start = el.selectionStart ?? el.value.length;
        const end = el.selectionEnd ?? start;
        const next = `${el.value.slice(0, start)}${emoji}${el.value.slice(end)}`;
        if (blockId) patchBlock(blockId, { content: next });
        requestAnimationFrame(() => {
          el.focus();
          const pos = start + emoji.length;
          el.setSelectionRange(pos, pos);
        });
        return;
      }
      const range = sel.getRangeAt(0);
      range.deleteContents();
      const node = document.createTextNode(emoji);
      range.insertNode(node);
      range.setStartAfter(node);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      const text = el.innerText || "";
      const target = blocksRef.current.find((b) => b.id === blockId);
      if (!target || target.locked) return;
      if (cell && target.type === "columns") {
        patchBlock(target.id, {
          content: writeColumnCell(target.content, cell, text),
        });
        setActiveCell(cell);
      } else {
        patchBlock(target.id, { content: text });
      }
      setSelectedId(target.id);
      return;
    }

    if (!selected || selected.locked || selected.type === "image") return;
    if (selected.type === "columns") {
      const cells = parseColumnCells(selected.content);
      patchBlock(selected.id, {
        content: writeColumnCell(
          selected.content,
          activeCell,
          `${cells[activeCell] || ""}${emoji}`,
        ),
      });
      return;
    }
    patchBlock(selected.id, { content: `${selected.content || ""}${emoji}` });
  };

  const insertSocialIcon = (preset: (typeof SOCIAL_ICON_PRESETS)[number]) => {
    const block: EmailBlock = {
      ...createEmailBlock("button"),
      content: preset.label,
      href: preset.href,
    };
    applyBlocks((prev) =>
      insertEmailBlock(prev, block, selectedId, insertPlace),
    );
    setSelectedId(block.id);
  };

  const insertDocLink = () => {
    const url = docLink.trim();
    if (!url) return;
    if (selected && !selected.locked && selected.type === "button") {
      patchBlock(selected.id, { href: url });
      setDocLink("");
      return;
    }
    if (selected && !selected.locked && selected.type !== "image") {
      const sep = selected.content.trim() ? " " : "";
      patchBlock(selected.id, { content: `${selected.content}${sep}${url}` });
      setDocLink("");
      return;
    }
    const block: EmailBlock = {
      ...createEmailBlock("button"),
      content: "View document",
      href: url,
    };
    applyBlocks((prev) =>
      insertEmailBlock(prev, block, selectedId, insertPlace),
    );
    setSelectedId(block.id);
    setDocLink("");
  };

  const patchBlock = (id: string, patch: Partial<EmailBlock>) => {
    applyBlocks((prev) =>
      prev.map((b) => {
        if (b.id !== id || b.locked) return b;
        return { ...b, ...patch };
      }),
    );
  };

  const removeBlock = (id: string) => {
    applyBlocks((prev) =>
      prev.filter(
        (b) =>
          b.id !== id ||
          b.type === "subject" ||
          b.type === "banner" ||
          b.locked,
      ),
    );
    setSelectedId((cur) => (cur === id ? null : cur));
  };

  const duplicateSelected = (id?: string) => {
    const target = id || selectedId;
    if (!target) return;
    applyBlocks((prev) => {
      const { blocks: next, newId } = duplicateEmailBlock(prev, target);
      if (newId) setSelectedId(newId);
      return next;
    });
  };

  const moveBlock = (fromId: string, toId: string) => {
    applyBlocks((prev) => moveEmailBlock(prev, fromId, toId));
  };

  const setString = (key: string, value: string) => {
    const lim = (CHANNEL_LIMITS[channel] || []).find((l) => l.key === key);
    setDraft((f) => ({ ...f, [key]: lim ? capText(value, lim.max) : value }));
  };

  const waButtons = Array.isArray(draft.buttons) ? draft.buttons : [];

  useEffect(() => {
    if (!isEmail) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing =
        el &&
        (el.isContentEditable ||
          el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA");
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === "z") {
        if (typing) return;
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (meta && e.key.toLowerCase() === "d") {
        if (typing) return;
        e.preventDefault();
        duplicateSelected();
        return;
      }
      if (typing || !selectedId) return;
      if (e.key === "ArrowUp") {
        e.preventDefault();
        const ids = blocks.filter((b) => b.type !== "subject").map((b) => b.id);
        const i = ids.indexOf(selectedId);
        if (i > 0) moveBlock(selectedId, ids[i - 1]);
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        const ids = blocks.filter((b) => b.type !== "subject").map((b) => b.id);
        const i = ids.indexOf(selectedId);
        if (i >= 0 && i < ids.length - 1) moveBlock(selectedId, ids[i + 1]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isEmail, selectedId, blocks]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 bg-[#f3f4f6] p-4 sm:p-5">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 rounded-2xl border border-neutral-200 bg-white px-3 py-3 shadow-sm sm:px-4">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg hover:bg-state-hover"
            onClick={requestLeave}
            aria-label="Back"
          >
            <ArrowLeft className="size-5" strokeWidth={1.75} />
          </button>
          <div className="min-w-0">
            <p className="truncate text-base font-semibold text-text-primary">
              Edit template
            </p>
            <p className="truncate text-xs text-text-caption">
              {campaignTitle}
              {channel ? ` · ${channel}` : ""}
              {emailAb ? ` · variant ${abVariant.toUpperCase()}` : ""}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {savedFlash ? (
            <span className="text-xs text-emerald-700">Saved</span>
          ) : null}
          {isEmail ? (
            <>
              <div className="flex rounded-lg border border-border-default p-0.5">
                <button
                  type="button"
                  className={`inline-flex size-8 items-center justify-center rounded-md ${
                    device === "desktop"
                      ? "bg-neutral-900 text-white"
                      : "text-text-caption"
                  }`}
                  onClick={() => setDevice("desktop")}
                  aria-label="Desktop width"
                >
                  <Monitor className="size-3.5" />
                </button>
                <button
                  type="button"
                  className={`inline-flex size-8 items-center justify-center rounded-md ${
                    device === "mobile"
                      ? "bg-neutral-900 text-white"
                      : "text-text-caption"
                  }`}
                  onClick={() => setDevice("mobile")}
                  aria-label="Mobile width"
                >
                  <Smartphone className="size-3.5" />
                </button>
              </div>
              <button
                type="button"
                disabled={!canUndo}
                className="inline-flex size-8 items-center justify-center rounded-lg border border-border-default disabled:opacity-40"
                onClick={undo}
                aria-label="Undo"
                title="Undo (⌘Z)"
              >
                <Undo2 className="size-3.5" />
              </button>
              <button
                type="button"
                disabled={!canRedo}
                className="inline-flex size-8 items-center justify-center rounded-lg border border-border-default disabled:opacity-40"
                onClick={redo}
                aria-label="Redo"
                title="Redo (⌘⇧Z)"
              >
                <Redo2 className="size-3.5" />
              </button>
            </>
          ) : null}
          <Button
            type="button"
            variant="primary"
            className="h-9 px-3 text-xs"
            disabled={!dirty || saving || coachBusy || blocking.length > 0}
            onClick={() => void save()}
          >
            {saving || coachBusy ? (
              <>
                <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                {coachBusy ? "Checking text…" : "Saving…"}
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
      {blocking.length > 0 || soft.length > 0 ? (
        <div className="shrink-0 space-y-1 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
          {blocking.map((i) => (
            <p key={i.message}>{i.message}</p>
          ))}
          {soft.map((i) => (
            <p key={i.message}>{i.message}</p>
          ))}
        </div>
      ) : null}

      <div
        className={
          isEmail
            ? "grid min-h-0 flex-1 overflow-hidden rounded-2xl border border-neutral-200 bg-white lg:grid-cols-[72px_minmax(220px,260px)_minmax(0,1fr)]"
            : "grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(200px,240px)_minmax(0,1fr)]"
        }
      >
        {isEmail ? (
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
        ) : null}
        <aside
          className={
            isEmail
              ? "chat-scroll-xs flex min-h-0 flex-col overflow-y-auto border-r border-[#e5e5e5] bg-white p-4"
              : "chat-scroll-xs flex min-h-0 flex-col overflow-y-auto rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm"
          }
        >
          {isEmail ? (
            <>
              {emailAb ? (
                <div className="mb-3 flex gap-1.5">
                  {(["a", "b"] as const).map((letter) => (
                    <button
                      key={letter}
                      type="button"
                      onClick={() => onAbVariantChange(letter)}
                      className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${
                        abVariant === letter
                          ? "border-neutral-900 bg-neutral-900 text-white"
                          : "border-border-default text-text-secondary"
                      }`}
                    >
                      Variant {letter.toUpperCase()}
                    </button>
                  ))}
                </div>
              ) : null}
              {leftTab === "templates" ? (
                <>
                  <p className="mb-2 text-[11px] font-semibold tracking-wide text-text-caption uppercase">
                    Templates
                  </p>
                  <div className="grid grid-cols-1 gap-2">
                    {EMAIL_LAYOUTS.map((layout) => (
                      <button
                        key={layout.id}
                        type="button"
                        onClick={() => insertLayout(layout.types)}
                        className="rounded-xl border border-border-default bg-subtle px-3 py-3 text-left text-xs font-medium text-text-primary hover:border-neutral-900 hover:bg-white"
                      >
                        {layout.label}
                      </button>
                    ))}
                  </div>
                  <p className="mt-3 text-xs leading-5 text-text-caption">
                    Inserts a starting layout at the selected block.
                  </p>
                </>
              ) : null}
              {leftTab === "elements" ? (
                <>
                  <p className="mb-2 text-[11px] font-semibold tracking-wide text-text-caption uppercase">
                    Elements
                  </p>
                  <div className="mb-2 flex gap-1 rounded-lg border border-border-default p-0.5 text-[10px]">
                    <button
                      type="button"
                      className={`flex-1 rounded-md px-2 py-1 font-medium ${
                        insertPlace === "above"
                          ? "bg-neutral-900 text-white"
                          : "text-text-caption"
                      }`}
                      onClick={() => setInsertPlace("above")}
                    >
                      Insert above
                    </button>
                    <button
                      type="button"
                      className={`flex-1 rounded-md px-2 py-1 font-medium ${
                        insertPlace === "below"
                          ? "bg-neutral-900 text-white"
                          : "text-text-caption"
                      }`}
                      onClick={() => setInsertPlace("below")}
                    >
                      Insert below
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {ELEMENT_TOOLS.map(({ type, label, icon: Icon }) => (
                      <button
                        key={type}
                        type="button"
                        onClick={() => addBlock(type)}
                        className="flex flex-col items-center gap-1.5 rounded-xl border border-border-default bg-subtle px-2 py-3 text-[11px] font-medium text-text-primary hover:border-neutral-900 hover:bg-white"
                      >
                        <Icon className="size-4" strokeWidth={1.75} />
                        {label}
                      </button>
                    ))}
                  </div>
                  <p className="mt-4 mb-2 text-[11px] font-semibold tracking-wide text-text-caption uppercase">
                    Emojis
                  </p>
                  <div className="grid grid-cols-4 gap-1.5">
                    {EMOJI_PICKER.map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => insertEmoji(emoji)}
                        className="rounded-lg border border-border-default py-2 text-lg hover:bg-neutral-50"
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                </>
              ) : null}
              {leftTab === "brand" ? (
                <>
                  <p className="mb-2 text-[11px] font-semibold tracking-wide text-text-caption uppercase">
                    Brand
                  </p>
                  <p className="mb-2 text-xs text-text-caption">Canvas</p>
                  <FillSwatches
                    fill={canvasFill}
                    onLive={(next) => applyCanvasFill(next, "live")}
                    onCommit={(next) => applyCanvasFill(next, "commit")}
                  />
                  {blocks.find((b) => b.type === "banner") ? (
                    <div className="mt-4">
                      <p className="mb-2 text-xs text-text-caption">Banner</p>
                      <FillSwatches
                        fill={{
                          backgroundColor: blocks.find((b) => b.type === "banner")
                            ?.style?.backgroundColor,
                          gradientFrom: blocks.find((b) => b.type === "banner")
                            ?.style?.gradientFrom,
                          gradientTo: blocks.find((b) => b.type === "banner")
                            ?.style?.gradientTo,
                        }}
                        onLive={(next) => applyBannerFill(next, "live")}
                        onCommit={(next) => applyBannerFill(next, "commit")}
                      />
                    </div>
                  ) : null}
                </>
              ) : null}
              {leftTab === "uploads" ? (
                <>
                  <p className="mb-2 text-[11px] font-semibold tracking-wide text-text-caption uppercase">
                    Uploads
                  </p>
                  <button
                    type="button"
                    onClick={() => addBlock("image")}
                    className="mb-3 w-full rounded-xl border border-border-default bg-subtle px-2 py-2 text-xs font-medium text-text-primary hover:border-neutral-900 hover:bg-white"
                  >
                    Add image block
                  </button>
                  {selected?.type === "columns" && !selected.locked ? (
                    <>
                      <p className="mb-2 text-xs text-text-caption">
                        Cell {activeCell === "a" ? "1" : "2"} — click a cell,
                        then upload.
                      </p>
                      <TemplateImagePicker
                      url={
                        isEmailCellImage(
                          parseColumnCells(selected.content)[activeCell],
                        )
                          ? parseColumnCells(selected.content)[activeCell]
                          : ""
                      }
                      onUrlChange={(next) =>
                        patchBlock(selected.id, {
                          content: writeColumnCell(
                            selected.content,
                            activeCell,
                            next,
                          ),
                        })
                      }
                      showPreview
                    />
                    </>
                  ) : selected?.type === "image" && !selected.locked ? (
                    <TemplateImagePicker
                      url={selected.content}
                      onUrlChange={(next) =>
                        patchBlock(selected.id, { content: next })
                      }
                      showPreview
                    />
                  ) : (
                    <p className="text-xs leading-5 text-text-caption">
                      Select an image, or a 2-cell block, then upload into that
                      cell.
                    </p>
                  )}
                </>
              ) : null}
              {leftTab === "projects" ? (
                <>
                  <p className="mb-2 text-[11px] font-semibold tracking-wide text-text-caption uppercase">
                    Projects
                  </p>
                  <Input
                    label="Document URL"
                    value={docLink}
                    onChange={(e) => setDocLink(e.target.value)}
                    placeholder="https://"
                  />
                  <button
                    type="button"
                    onClick={insertDocLink}
                    className="mt-2 w-full rounded-xl border border-border-default bg-subtle px-2 py-2 text-xs font-medium text-text-primary hover:border-neutral-900 hover:bg-white"
                  >
                    Insert link
                  </button>
                  <p className="mt-3 text-xs leading-5 text-text-caption">
                    Applies to the selected button or text, or adds a new
                    button.
                  </p>
                </>
              ) : null}
              {leftTab === "apps" ? (
                <>
                  <p className="mb-2 text-[11px] font-semibold tracking-wide text-text-caption uppercase">
                    Apps
                  </p>
                  <div className="grid grid-cols-1 gap-2">
                    {SOCIAL_ICON_PRESETS.map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => insertSocialIcon(preset)}
                        className="rounded-xl border border-border-default bg-subtle px-3 py-2 text-left text-xs font-medium text-text-primary hover:border-neutral-900 hover:bg-white"
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                  <p className="mt-3 text-xs leading-5 text-text-caption">
                    Inserts a social button. Set the full URL after inserting.
                  </p>
                </>
              ) : null}
            </>
          ) : (
            <div className="space-y-3">
              <p className="text-[11px] font-semibold tracking-wide text-text-caption uppercase">
                Content
              </p>
              {channel === "whatsapp" ? (
                <>
                  <Input
                    label="Template name"
                    value={String(draft.name || "")}
                    onChange={(e) =>
                      setDraft((f) => ({
                        ...f,
                        name: e.target.value
                          .toLowerCase()
                          .replace(/[^a-z0-9_]+/g, "_"),
                      }))
                    }
                  />
                  <LimitedTextArea
                    label="Header"
                    max={60}
                    rows={2}
                    value={String(draft.header || draft.title || "")}
                    onChange={(v) =>
                      setDraft((f) => ({ ...f, header: v, title: v }))
                    }
                  />
                  <LimitedTextArea
                    label="Body"
                    max={1024}
                    warnAt={920}
                    rows={8}
                    value={String(draft.body || "")}
                    onChange={(v) => setString("body", v)}
                  />
                  <LimitedTextArea
                    label="Footer (static tags not allowed)"
                    max={60}
                    rows={2}
                    value={String(draft.footer || "")}
                    onChange={(v) =>
                      setString("footer", v.replace(/\{\{[^}]*\}\}/g, ""))
                    }
                  />
                  <p className="text-[11px] text-text-caption">
                    Buttons {waButtons.length}/{WHATSAPP_BUTTONS_MAX} · label ≤
                    {WHATSAPP_BUTTON_LABEL_MAX}
                  </p>
                  {waButtons.slice(0, WHATSAPP_BUTTONS_MAX).map((raw, i) => {
                    const btn = raw as { label?: string; text?: string; url?: string };
                    return (
                      <Input
                        key={i}
                        label={`Button ${i + 1}`}
                        value={String(btn.label || btn.text || "")}
                        onChange={(e) => {
                          const next = [...waButtons];
                          next[i] = {
                            ...btn,
                            label: capText(e.target.value, WHATSAPP_BUTTON_LABEL_MAX),
                            text: capText(e.target.value, WHATSAPP_BUTTON_LABEL_MAX),
                          };
                          setDraft((f) => ({ ...f, buttons: next }));
                        }}
                      />
                    );
                  })}
                  {waButtons.length < WHATSAPP_BUTTONS_MAX ? (
                    <button
                      type="button"
                      className="text-xs font-medium text-text-primary underline"
                      onClick={() =>
                        setDraft((f) => ({
                          ...f,
                          buttons: [
                            ...waButtons,
                            { label: "Learn more", text: "Learn more" },
                          ],
                        }))
                      }
                    >
                      Add button
                    </button>
                  ) : null}
                </>
              ) : null}
              {channel === "sms" ? (
                <LimitedTextArea
                  label="Message"
                  max={320}
                  warnAt={160}
                  rows={8}
                  value={String(draft.body || "")}
                  onChange={(v) => setString("body", v)}
                />
              ) : null}
              {channel === "push" || channel === "web" ? (
                <>
                  <LimitedTextArea
                    label="Title"
                    max={channel === "push" ? 50 : 60}
                    rows={2}
                    value={String(draft.title || "")}
                    onChange={(v) => setString("title", v)}
                  />
                  <LimitedTextArea
                    label="Body"
                    max={120}
                    rows={5}
                    value={String(draft.body || "")}
                    onChange={(v) => setString("body", v)}
                  />
                  <Input
                    label="CTA label"
                    value={String(draft.cta_label || "")}
                    onChange={(e) => setString("cta_label", e.target.value)}
                  />
                </>
              ) : null}
              {!["whatsapp", "sms", "push", "web"].includes(channel) ? (
                <LimitedTextArea
                  label="Body"
                  max={4000}
                  rows={8}
                  value={String(draft.body || "")}
                  onChange={(v) => setString("body", v)}
                />
              ) : null}
            </div>
          )}
        </aside>

        <section
          className={
            isEmail
              ? "flex min-h-0 flex-col bg-[#f3f4f6] p-4 sm:p-6"
              : "chat-scroll-xs flex min-h-0 flex-col overflow-y-auto rounded-2xl border border-neutral-200 bg-[#f3f4f6] p-4 sm:p-6"
          }
        >
          {isEmail ? (
            <CanvasFormatToolbar
              selected={selectedId === EMAIL_CANVAS_ID ? null : selected}
              canvasFill={canvasFill}
              onCanvasFill={applyCanvasFill}
              onStyle={patchStyle}
              onPatch={(patch) => {
                if (selected) patchBlock(selected.id, patch);
              }}
              paintArmed={paintArmed}
              onPaint={togglePaint}
            />
          ) : null}
          <div className="chat-scroll-xs mx-auto min-h-0 w-full max-w-xl flex-1 overflow-y-auto">
            {isEmail ? (
              <EditableEmailCanvas
                blocks={blocks}
                selectedId={selectedId}
                device={device}
                canvasFill={canvasFill}
                onSelect={setSelectedId}
                onChangeBlock={patchBlock}
                onRemoveBlock={removeBlock}
                onDuplicateBlock={(id) => duplicateSelected(id)}
                onMoveBlock={moveBlock}
                activeCell={activeCell}
                onActiveCell={setActiveCell}
              />
            ) : (
              <ChannelTemplatePreview
                channel={channel}
                fields={previewFields}
                abVariant={abVariant}
                onAbVariantChange={onAbVariantChange}
              />
            )}
          </div>
        </section>
      </div>

      {leaveOpen ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
          <div
            role="dialog"
            aria-labelledby="manual-edit-leave-title"
            className="w-full max-w-sm rounded-2xl border border-neutral-200 bg-white p-5 shadow-lg"
          >
            <p
              id="manual-edit-leave-title"
              className="text-sm font-semibold text-text-primary"
            >
              Save template changes?
            </p>
            <p className="mt-1 text-xs leading-5 text-text-caption">
              You have unsaved edits. Save before going back to AI Edit?
            </p>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                className="h-9 px-3 text-xs"
                onClick={() => setLeaveOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="h-9 px-3 text-xs"
                onClick={() => {
                  setLeaveOpen(false);
                  onBackToAi();
                }}
              >
                Don't save
              </Button>
              <Button
                type="button"
                variant="primary"
                className="h-9 px-3 text-xs"
                disabled={saving || coachBusy || blocking.length > 0}
                onClick={() => {
                  setLeaveOpen(false);
                  leaveAfterSaveRef.current = true;
                  void save();
                }}
              >
                Save
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {clarifyOpen ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
          <div
            role="dialog"
            aria-labelledby="manual-edit-clarify-title"
            className="flex max-h-[min(480px,80vh)] w-full max-w-md flex-col rounded-2xl border border-neutral-200 bg-white p-5 shadow-lg"
          >
            <p
              id="manual-edit-clarify-title"
              className="text-sm font-semibold text-text-primary"
            >
              Need a quick check before saving
            </p>
            <p className="mt-1 text-xs text-text-caption">
              Some wording isn’t auto-fixed. Chat below, or cancel and keep
              editing.
            </p>
            <div className="mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto rounded-xl border border-neutral-100 bg-neutral-50 p-3">
              {clarifyMessages.map((m, i) => (
                <p
                  key={`${m.role}-${i}`}
                  className={`text-xs leading-5 ${
                    m.role === "user"
                      ? "text-text-primary"
                      : "text-text-secondary"
                  }`}
                >
                  <span className="font-semibold">
                    {m.role === "user" ? "You" : "AI"}:{" "}
                  </span>
                  {m.text}
                </p>
              ))}
            </div>
            <div className="mt-3 flex gap-2">
              <input
                value={clarifyInput}
                onChange={(e) => setClarifyInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void sendClarify();
                  }
                }}
                placeholder="Reply…"
                className="h-9 min-w-0 flex-1 rounded-lg border border-border-default px-3 text-xs outline-none focus:border-neutral-900"
              />
              <Button
                type="button"
                variant="primary"
                className="h-9 px-3 text-xs"
                disabled={!clarifyInput.trim() || coachBusy}
                onClick={() => void sendClarify()}
              >
                Send
              </Button>
            </div>
            <button
              type="button"
              className="mt-2 self-end text-xs font-medium text-text-caption hover:text-text-primary"
              onClick={() => {
                setClarifyOpen(false);
                leaveAfterSaveRef.current = false;
              }}
            >
              Cancel save
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
