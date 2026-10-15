import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  ChevronDown,
  Highlighter,
  Italic,
  List,
  ListOrdered,
  Strikethrough,
  Underline,
} from "lucide-react";
import type { RichTextFormatState } from "@/components/email/RichTextEditor";

const FONTS = [
  { label: "Font", value: "" },
  { label: "Sans serif", value: "Arial, sans-serif" },
  { label: "Serif", value: "Georgia, serif" },
  { label: "Monospace", value: "ui-monospace, monospace" },
  { label: "Arial", value: "Arial" },
  { label: "Georgia", value: "Georgia" },
  { label: "Times", value: "Times New Roman" },
];

const SIZES = [
  { label: "Size", value: "" },
  { label: "Small", value: "12px" },
  { label: "Normal", value: "14px" },
  { label: "Large", value: "18px" },
  { label: "Huge", value: "24px" },
];

const TEXT_COLORS = [
  "#111827",
  "#6b7280",
  "#dc2626",
  "#ea580c",
  "#ca8a04",
  "#16a34a",
  "#2563eb",
  "#7c3aed",
  "#ffffff",
];

const HIGHLIGHT_COLORS = [
  { label: "None", value: "transparent" },
  { label: "Yellow", value: "#fef08a" },
  { label: "Green", value: "#bbf7d0" },
  { label: "Red", value: "#fecaca" },
  { label: "Blue", value: "#bfdbfe" },
  { label: "Orange", value: "#fed7aa" },
  { label: "Purple", value: "#e9d5ff" },
];

function ToolButton({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        active
          ? "bg-white text-neutral-900 hover:bg-white [&_svg]:stroke-neutral-900"
          : "text-white hover:bg-white/10 [&_svg]:stroke-white"
      }`}
    >
      {children}
    </button>
  );
}

function Menu({
  label,
  disabled,
  children,
}: {
  label: ReactNode;
  disabled?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        disabled={disabled}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-8 shrink-0 cursor-pointer items-center gap-1 rounded-full bg-white/15 px-2.5 text-xs font-medium text-white hover:bg-white/25 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {label}
        <ChevronDown className="size-3 opacity-80" />
      </button>
      {open ? (
        <div className="absolute left-0 top-full z-50 mt-1 min-w-[9rem] overflow-hidden rounded-xl border border-white/10 bg-neutral-900 py-1 shadow-lg">
          <div
            onClick={() => setOpen(false)}
            onKeyDown={() => setOpen(false)}
            role="none"
          >
            {children}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function ComposeFormatToolbar({
  disabled = false,
  state,
  onExec,
}: {
  disabled?: boolean;
  state: RichTextFormatState;
  onExec: (command: string, value?: string) => void;
}) {
  const fontLabel =
    FONTS.find(
      (f) =>
        f.value &&
        state.fontName.toLowerCase().includes(f.value.split(",")[0]!.trim().toLowerCase()),
    )?.label ?? "Font";
  const sizeLabel =
    SIZES.find((s) => s.value && state.fontSize === s.value)?.label ?? "Size";

  return (
    <div
      className="mb-2 inline-flex w-fit max-w-full flex-wrap items-center gap-0.5 rounded-full bg-neutral-900 px-1.5 py-1 shadow-[0_8px_24px_rgba(17,17,17,0.28)]"
      role="toolbar"
      aria-label="Text formatting"
    >
      <ToolButton
        label="Bold"
        active={state.bold}
        disabled={disabled}
        onClick={() => onExec("bold")}
      >
        <Bold className="size-3.5" strokeWidth={2.25} />
      </ToolButton>
      <ToolButton
        label="Italic"
        active={state.italic}
        disabled={disabled}
        onClick={() => onExec("italic")}
      >
        <Italic className="size-3.5" strokeWidth={2.25} />
      </ToolButton>
      <ToolButton
        label="Underline"
        active={state.underline}
        disabled={disabled}
        onClick={() => onExec("underline")}
      >
        <Underline className="size-3.5" strokeWidth={2.25} />
      </ToolButton>
      <ToolButton
        label="Strikethrough"
        active={state.strikeThrough}
        disabled={disabled}
        onClick={() => onExec("strikeThrough")}
      >
        <Strikethrough className="size-3.5" strokeWidth={2.25} />
      </ToolButton>

      <span className="mx-1 h-5 w-px bg-white/20" aria-hidden />

      <ToolButton
        label="Align left"
        active={state.justifyLeft}
        disabled={disabled}
        onClick={() => onExec("justifyLeft")}
      >
        <AlignLeft className="size-3.5" strokeWidth={2.25} />
      </ToolButton>
      <ToolButton
        label="Align center"
        active={state.justifyCenter}
        disabled={disabled}
        onClick={() => onExec("justifyCenter")}
      >
        <AlignCenter className="size-3.5" strokeWidth={2.25} />
      </ToolButton>
      <ToolButton
        label="Align right"
        active={state.justifyRight}
        disabled={disabled}
        onClick={() => onExec("justifyRight")}
      >
        <AlignRight className="size-3.5" strokeWidth={2.25} />
      </ToolButton>

      <span className="mx-1 h-5 w-px bg-white/20" aria-hidden />

      <Menu label={fontLabel} disabled={disabled}>
        {FONTS.filter((f) => f.value).map((font) => (
          <button
            key={font.value}
            type="button"
            className="block w-full cursor-pointer px-3 py-1.5 text-left text-xs text-white hover:bg-white/10"
            style={{ fontFamily: font.value }}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onExec("fontName", font.value)}
          >
            {font.label}
          </button>
        ))}
      </Menu>
      <Menu label={sizeLabel} disabled={disabled}>
        {SIZES.filter((s) => s.value).map((size) => (
          <button
            key={size.value}
            type="button"
            className="block w-full cursor-pointer px-3 py-1.5 text-left text-xs text-white hover:bg-white/10"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onExec("fontSizePx", size.value)}
          >
            {size.label}
          </button>
        ))}
      </Menu>
      <Menu
        label={
          <span className="inline-flex items-center gap-1">
            <span className="text-[11px] font-semibold leading-none">A</span>
            <span
              className="h-0.5 w-3 rounded-full"
              style={{ background: state.foreColor || "#ffffff" }}
            />
          </span>
        }
        disabled={disabled}
      >
        <div className="grid grid-cols-5 gap-1 px-2 py-1.5">
          {TEXT_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              title={color}
              className="size-6 cursor-pointer rounded-full border border-white/20"
              style={{ background: color }}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onExec("foreColor", color)}
            />
          ))}
        </div>
      </Menu>
      <Menu
        label={<Highlighter className="size-3.5" strokeWidth={2.25} />}
        disabled={disabled}
      >
        <div className="grid grid-cols-4 gap-1 px-2 py-1.5">
          {HIGHLIGHT_COLORS.map((color) => (
            <button
              key={color.value}
              type="button"
              title={color.label}
              className="size-6 cursor-pointer rounded-full border border-white/20"
              style={{
                background:
                  color.value === "transparent" ? "repeating-linear-gradient(45deg,#fff 0 2px,#ef4444 2px 4px)" : color.value,
              }}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onExec("hiliteColor", color.value)}
            />
          ))}
        </div>
      </Menu>

      <span className="mx-1 h-5 w-px bg-white/20" aria-hidden />

      <ToolButton
        label="Bulleted list"
        active={state.insertUnorderedList}
        disabled={disabled}
        onClick={() => onExec("insertUnorderedList")}
      >
        <List className="size-3.5" strokeWidth={2.25} />
      </ToolButton>
      <ToolButton
        label="Numbered list"
        active={state.insertOrderedList}
        disabled={disabled}
        onClick={() => onExec("insertOrderedList")}
      >
        <ListOrdered className="size-3.5" strokeWidth={2.25} />
      </ToolButton>
    </div>
  );
}
