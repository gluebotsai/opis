import { useEffect, useRef, useState, type CSSProperties, type DragEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Copy, GripVertical, Trash2 } from "lucide-react";
import type { EmailBlock, EmailBlockStyle } from "@/lib/email-template-blocks";
import {
  EMAIL_CANVAS_ID,
  fillToCss,
  isEmailCellImage,
  parseColumnCells,
} from "@/lib/email-template-blocks";
import { TemplateImagePicker } from "@/components/campaigns/TemplateImagePicker";
import { absolutizeMediaUrl } from "@/services/media.api";

type Props = {
  blocks: EmailBlock[];
  selectedId: string | null;
  device?: "desktop" | "mobile";
  canvasFill?: {
    backgroundColor?: string;
    gradientFrom?: string;
    gradientTo?: string;
  };
  onSelect: (id: string | null) => void;
  onChangeBlock: (id: string, patch: Partial<EmailBlock>) => void;
  onRemoveBlock: (id: string) => void;
  onDuplicateBlock?: (id: string) => void;
  onMoveBlock?: (fromId: string, toId: string) => void;
  activeCell?: "a" | "b";
  onActiveCell?: (cell: "a" | "b") => void;
};

function styleToCss(style?: EmailBlockStyle): CSSProperties {
  const listed = style?.listStyle && style.listStyle !== "none";
  return {
    fontFamily: style?.fontFamily || "Georgia, serif",
    fontSize: style?.fontSize ? `${style.fontSize}px` : "15px",
    fontWeight: style?.fontWeight || "normal",
    fontStyle: style?.fontStyle || "normal",
    textDecoration: style?.textDecoration || "none",
    color: style?.color || "#374151",
    textAlign: style?.textAlign || "left",
    backgroundColor: style?.highlightColor || undefined,
    lineHeight: style?.lineHeight ? String(style.lineHeight) : undefined,
    paddingLeft: style?.paddingLeft
      ? `${style.paddingLeft}px`
      : listed
        ? "1.25em"
        : undefined,
    display: listed ? "list-item" : undefined,
    listStyleType: listed ? style.listStyle : undefined,
    listStylePosition: listed ? "inside" : undefined,
  };
}

export function EditableEmailCanvas({
  blocks,
  selectedId,
  device = "desktop",
  canvasFill,
  onSelect,
  onChangeBlock,
  onRemoveBlock,
  onDuplicateBlock,
  onMoveBlock,
  activeCell = "a",
  onActiveCell,
}: Props) {
  const subject = blocks.find((b) => b.type === "subject");
  const banner = blocks.find((b) => b.type === "banner");
  const body = blocks.filter((b) => b.type !== "subject" && b.type !== "banner");
  const canvasSelected = selectedId === EMAIL_CANVAS_ID;

  return (
    <div
      className={`w-full ${device === "mobile" ? "max-w-[360px]" : "max-w-xl"}`}
      onClick={() => onSelect(null)}
      role="presentation"
    >
      {subject ? (
        <BlockFrame
          selected={selectedId === subject.id}
          onSelect={() => onSelect(subject.id)}
          label="Subject"
        >
          <input
            value={subject.content}
            spellCheck
            autoCorrect="on"
            data-email-edit="text"
            data-block-id={subject.id}
            onChange={(e) =>
              onChangeBlock(subject.id, { content: e.target.value })
            }
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            className="w-full border-0 bg-transparent text-sm outline-none"
            style={styleToCss(subject.style)}
            placeholder="Subject line"
          />
        </BlockFrame>
      ) : null}

      <div
        className={`mt-3 overflow-hidden rounded-2xl border shadow-sm ${
          canvasSelected
            ? "border-neutral-900 ring-2 ring-neutral-900/15"
            : "border-neutral-200"
        }`}
        style={{ backgroundColor: "#ffffff", ...fillToCss(canvasFill) }}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(EMAIL_CANVAS_ID);
        }}
      >
        {banner ? (
          <div
            className={`flex items-center justify-center gap-2 border-b border-neutral-100 px-6 py-5 ${
              selectedId === banner.id ? "ring-2 ring-inset ring-neutral-900/20" : ""
            }`}
            style={fillToCss(banner.style)}
            onClick={(e) => {
              e.stopPropagation();
              onSelect(banner.id);
            }}
          >
            <span
              className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-[10px] text-white"
              aria-hidden
            >
              {(banner.content || "W").trim().charAt(0).toUpperCase() || "W"}
            </span>
            <input
              value={banner.content}
              data-email-edit="text"
              data-block-id={banner.id}
              onChange={(e) =>
                onChangeBlock(banner.id, { content: e.target.value })
              }
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
              className="min-w-0 flex-1 border-0 bg-transparent text-center text-base font-semibold tracking-tight outline-none"
              style={{
                ...styleToCss(banner.style),
                background: "transparent",
              }}
              aria-label="Banner title"
            />
          </div>
        ) : null}

        <div className="space-y-2 px-4 py-4 sm:px-6" data-email-body>
          {body.length === 0 ? (
            <p className="py-8 text-center text-sm text-neutral-400">
              Add Image, Text, or a cell from the left
            </p>
          ) : (
            body.map((block) => (
              <EditableBlock
                key={block.id}
                block={block}
                selected={selectedId === block.id}
                onSelect={() => onSelect(block.id)}
                onChange={(patch) => {
                  if (block.locked) return;
                  onChangeBlock(block.id, patch);
                }}
                onRemove={() => {
                  if (block.locked) return;
                  onRemoveBlock(block.id);
                }}
                onDuplicate={() => onDuplicateBlock?.(block.id)}
                onDropOn={(fromId) => onMoveBlock?.(fromId, block.id)}
                activeCell={activeCell}
                onActiveCell={onActiveCell}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function WidthBox({
  width,
  align,
  selected,
  onWidth,
  children,
}: {
  width?: number;
  align: "left" | "center" | "right";
  selected: boolean;
  onWidth: (width: number) => void;
  children: ReactNode;
}) {
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const shown = dragWidth ?? width;
  const sized = shown != null && shown > 0 && shown < 100;
  const justify =
    align === "left"
      ? "justify-start"
      : align === "right"
        ? "justify-end"
        : "justify-center";

  const startResize = (e: ReactPointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const box = e.currentTarget.parentElement;
    const body = e.currentTarget.closest("[data-email-body]");
    const bodyW = body?.getBoundingClientRect().width || 1;
    const startX = e.clientX;
    const startPct =
      shown != null && shown > 0 && shown <= 100
        ? shown
        : Math.round(((box?.getBoundingClientRect().width || bodyW) / bodyW) * 100);
    const nextWidth = (clientX: number) =>
      Math.min(100, Math.max(24, Math.round(startPct + ((clientX - startX) / bodyW) * 100)));
    const move = (ev: PointerEvent) => setDragWidth(nextWidth(ev.clientX));
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDragWidth(null);
      onWidth(nextWidth(ev.clientX));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div className={`relative flex w-full ${justify}`}>
      <div
        className="relative max-w-full"
        style={sized ? { width: `${Math.round(shown)}%` } : shown === 100 ? { width: "100%" } : undefined}
      >
        {children}
        {selected ? (
          <button
            type="button"
            aria-label="Resize block"
            title="Drag to resize"
            className="absolute top-1/2 -right-1.5 z-10 size-3 -translate-y-1/2 cursor-ew-resize rounded-full border border-neutral-900 bg-white shadow-sm"
            onPointerDown={startResize}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
          />
        ) : null}
      </div>
    </div>
  );
}

function CanvasImage({
  url,
  selected,
  radius,
  width,
  align,
  onUrlChange,
  onWidth,
}: {
  url: string;
  selected: boolean;
  radius?: number;
  width?: number;
  align: "left" | "center" | "right";
  onUrlChange: (url: string) => void;
  onWidth: (width: number) => void;
}) {
  const [broken, setBroken] = useState(false);
  const trimmed = url.trim();

  useEffect(() => {
    setBroken(false);
  }, [url]);

  const picture = trimmed ? (
    broken ? (
      <p className="rounded-lg bg-neutral-50 px-3 py-6 text-center text-[11px] text-neutral-500">
        This link did not load as an image. Use Upload, or a public URL that
        returns a picture (a file extension is optional). Google “share”
        pages are not images.
      </p>
    ) : (
      <img
        src={trimmed}
        alt=""
        className="block h-auto w-full"
        style={{
          borderRadius: `${Math.min(80, Math.max(0, radius ?? 8))}px`,
        }}
        onError={() => setBroken(true)}
        onLoad={() => setBroken(false)}
      />
    )
  ) : (
    <p className="py-6 text-center text-sm text-neutral-400">
      Upload from your computer, or paste a public image URL
    </p>
  );

  return (
    <div>
      <WidthBox
        width={width ?? 100}
        align={align}
        selected={selected}
        onWidth={onWidth}
      >
        {picture}
      </WidthBox>
      {selected ? (
        <div className="mt-2">
          <TemplateImagePicker
            url={url}
            onUrlChange={onUrlChange}
            compact
            showPreview={false}
          />
        </div>
      ) : null}
    </div>
  );
}

function BlockFrame({
  selected,
  onSelect,
  onRemove,
  onDuplicate,
  draggable,
  onDragStart,
  onDragOver,
  onDrop,
  label,
  fillStyle,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  onRemove?: () => void;
  onDuplicate?: () => void;
  draggable?: boolean;
  onDragStart?: (e: DragEvent) => void;
  onDragOver?: (e: DragEvent) => void;
  onDrop?: (e: DragEvent) => void;
  label?: string;
  fillStyle?: EmailBlockStyle;
  children: ReactNode;
}) {
  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      onDragOver={onDragOver}
      onDrop={onDrop}
      style={{
        ...fillToCss(fillStyle),
        borderRadius:
          fillStyle?.borderRadius != null
            ? `${Math.min(80, Math.max(0, fillStyle.borderRadius))}px`
            : undefined,
      }}
      className={`group relative rounded-xl border px-3 py-2 transition-colors ${
        selected
          ? "border-neutral-900 ring-2 ring-neutral-900/15"
          : "border-transparent hover:border-neutral-200"
      }`}
    >
      {draggable ? (
        <button
          type="button"
          draggable
          onDragStart={onDragStart}
          onClick={(e) => e.stopPropagation()}
          className="absolute top-2 left-0 hidden cursor-grab text-neutral-400 group-hover:inline-flex"
          aria-label="Drag to reorder"
        >
          <GripVertical className="size-4" strokeWidth={1.75} />
        </button>
      ) : null}
      {label ? (
        <p className="mb-1 text-[10px] font-semibold tracking-wide text-neutral-400 uppercase">
          {label}
        </p>
      ) : null}
      {children}
      {selected && (onRemove || onDuplicate) ? (
        <div className="absolute -top-2 -right-2 flex gap-1">
          {onDuplicate ? (
            <button
              type="button"
              className="inline-flex size-7 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-600 shadow-sm hover:bg-neutral-50"
              onClick={(e) => {
                e.stopPropagation();
                onDuplicate();
              }}
              aria-label="Duplicate"
            >
              <Copy className="size-3.5" strokeWidth={1.75} />
            </button>
          ) : null}
          {onRemove ? (
            <button
              type="button"
              className="inline-flex size-7 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-600 shadow-sm hover:bg-neutral-50"
              onClick={(e) => {
                e.stopPropagation();
                onRemove();
              }}
              aria-label="Remove block"
            >
              <Trash2 className="size-3.5" strokeWidth={1.75} />
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function EditableBlock({
  block,
  selected,
  onSelect,
  onChange,
  onRemove,
  onDuplicate,
  onDropOn,
  activeCell = "a",
  onActiveCell,
}: {
  block: EmailBlock;
  selected: boolean;
  onSelect: () => void;
  onChange: (patch: Partial<EmailBlock>) => void;
  onRemove: () => void;
  onDuplicate?: () => void;
  onDropOn?: (fromId: string) => void;
  activeCell?: "a" | "b";
  onActiveCell?: (cell: "a" | "b") => void;
}) {
  const textRef = useRef<HTMLDivElement>(null);
  const canDrag = !block.locked;
  const dragProps = {
    draggable: canDrag,
    onDragStart: (e: DragEvent) => {
      e.dataTransfer.setData("text/block-id", block.id);
      e.dataTransfer.effectAllowed = "move";
    },
    onDragOver: (e: DragEvent) => {
      if (!onDropOn) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const fromId = e.dataTransfer.getData("text/block-id");
      if (fromId) onDropOn(fromId);
    },
  };

  if (block.type === "spacer") {
    const h = Math.min(80, Math.max(8, Number(block.content) || 24));
    return (
      <BlockFrame
        selected={selected}
        onSelect={onSelect}
        onRemove={block.locked ? undefined : onRemove}
        onDuplicate={block.locked ? undefined : onDuplicate}
        fillStyle={block.style}
        {...dragProps}
      >
        <div className="rounded-md border border-dashed border-neutral-200" style={{ height: h }} />
      </BlockFrame>
    );
  }

  if (block.type === "divider") {
    return (
      <BlockFrame
        selected={selected}
        onSelect={onSelect}
        onRemove={block.locked ? undefined : onRemove}
        onDuplicate={block.locked ? undefined : onDuplicate}
        fillStyle={block.style}
        {...dragProps}
      >
        <hr className="border-neutral-200" />
      </BlockFrame>
    );
  }

  if (block.type === "columns") {
    const cells = parseColumnCells(block.content);
    const setCell = (key: "a" | "b", value: string) => {
      onChange({ content: JSON.stringify({ ...cells, [key]: value }) });
    };
    return (
      <BlockFrame
        selected={selected}
        onSelect={onSelect}
        onRemove={block.locked ? undefined : onRemove}
        onDuplicate={block.locked ? undefined : onDuplicate}
        fillStyle={block.style}
        {...dragProps}
      >
        <div className="grid grid-cols-2 gap-3">
          {(["a", "b"] as const).map((key) => {
            const value = cells[key];
            const asImage = isEmailCellImage(value);
            const cellOn = selected && activeCell === key;
            return (
              <div
                key={key}
                className={`min-h-[3rem] rounded-lg border px-2 py-2 ${
                  cellOn
                    ? "border-neutral-900"
                    : "border-neutral-100"
                }`}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect();
                  onActiveCell?.(key);
                }}
              >
                {asImage ? (
                  <img
                    src={absolutizeMediaUrl(value)}
                    alt=""
                    className="mx-auto block h-auto w-full rounded-md"
                  />
                ) : (
                  <div
                    contentEditable={!block.locked}
                    suppressContentEditableWarning
                    spellCheck
                    role="textbox"
                    data-email-edit="text"
                    data-block-id={block.id}
                    data-cell={key}
                    className="min-h-[2.5rem] text-sm whitespace-pre-wrap outline-none"
                    style={styleToCss(block.style)}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                    onFocus={() => {
                      onSelect();
                      onActiveCell?.(key);
                    }}
                    onInput={(e) => {
                      if (block.locked) return;
                      setCell(key, e.currentTarget.innerText);
                    }}
                    onBlur={(e) => {
                      if (block.locked) return;
                      setCell(key, e.currentTarget.innerText);
                    }}
                    ref={(el) => {
                      if (
                        el &&
                        document.activeElement !== el &&
                        el.innerText !== value
                      ) {
                        el.innerText = value;
                      }
                    }}
                  />
                )}
                {cellOn && !block.locked ? (
                  <div className="mt-2" onClick={(e) => e.stopPropagation()}>
                    <TemplateImagePicker
                      url={asImage ? value : ""}
                      onUrlChange={(url) => setCell(key, url)}
                      compact
                      showPreview={false}
                    />
                    {asImage ? (
                      <button
                        type="button"
                        className="mt-1 text-[11px] font-medium text-text-secondary underline"
                        onClick={() => setCell(key, "")}
                      >
                        Remove image
                      </button>
                    ) : (
                      <p className="mt-1 text-[10px] text-neutral-400">
                        Upload a picture into this cell, or keep typing text.
                      </p>
                    )}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </BlockFrame>
    );
  }

  if (block.type === "image") {
    return (
      <BlockFrame
        selected={selected}
        onSelect={onSelect}
        onRemove={block.locked ? undefined : onRemove}
        onDuplicate={block.locked ? undefined : onDuplicate}
        fillStyle={block.style}
        {...dragProps}
      >
        <CanvasImage
          url={block.content}
          selected={selected && !block.locked}
          radius={block.style?.borderRadius}
          width={block.style?.width}
          align={block.style?.textAlign || "center"}
          onUrlChange={(url) => onChange({ content: url })}
          onWidth={(width) =>
            onChange({ style: { ...(block.style || {}), width } })
          }
        />
      </BlockFrame>
    );
  }

  if (block.type === "button") {
    return (
      <BlockFrame
        selected={selected}
        onSelect={onSelect}
        onRemove={block.locked ? undefined : onRemove}
        onDuplicate={block.locked ? undefined : onDuplicate}
        fillStyle={block.style}
        {...dragProps}
      >
        <WidthBox
          width={block.style?.width}
          align={block.style?.textAlign || "center"}
          selected={selected && !block.locked}
          onWidth={(width) =>
            onChange({ style: { ...(block.style || {}), width } })
          }
        >
          <button
            type="button"
            className={`inline-flex items-center justify-center rounded-md bg-[#2563eb] px-5 py-2.5 text-sm font-semibold text-white ${
              block.style?.width && block.style.width < 100
                ? "w-full min-w-0"
                : "min-w-[8rem]"
            }`}
            style={{
              ...styleToCss(block.style),
              color: block.style?.color || "#ffffff",
              backgroundColor: block.style?.backgroundColor || "#2563eb",
            }}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onSelect();
            }}
          >
            <span
              contentEditable={!block.locked}
              suppressContentEditableWarning
              spellCheck
              data-email-edit="text"
              data-block-id={block.id}
              className="outline-none"
              onKeyDown={(e) => e.stopPropagation()}
              onBlur={(e) => {
                if (block.locked) return;
                onChange({ content: e.currentTarget.innerText || "" });
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {block.content || "Button"}
            </span>
          </button>
        </WidthBox>
        {selected ? (
          <input
            value={block.href || ""}
            onChange={(e) => onChange({ href: e.target.value })}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            placeholder="https://…"
            aria-label="Button link"
            className="mt-2 w-full rounded-lg border border-neutral-200 px-2 py-1.5 text-xs outline-none focus:border-neutral-900"
          />
        ) : null}
      </BlockFrame>
    );
  }

  return (
    <BlockFrame
      selected={selected}
      onSelect={onSelect}
      onRemove={block.locked ? undefined : onRemove}
      onDuplicate={block.locked ? undefined : onDuplicate}
      fillStyle={block.style}
      {...dragProps}
    >
      {block.locked ? (
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
          Static · cannot edit
        </p>
      ) : null}
      <div
        ref={(el) => {
          textRef.current = el;
          if (
            el &&
            document.activeElement !== el &&
            el.innerText !== block.content
          ) {
            el.innerText = block.content;
          }
        }}
        contentEditable={!block.locked}
        suppressContentEditableWarning
        spellCheck
        autoCorrect="on"
        role="textbox"
        aria-multiline
        aria-readonly={block.locked || undefined}
        data-email-edit="text"
        data-block-id={block.id}
        className="min-h-[1.5rem] whitespace-pre-wrap outline-none"
        style={styleToCss(block.style)}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        onFocus={onSelect}
        onBlur={(e) => {
          if (block.locked) return;
          onChange({ content: e.currentTarget.innerText || "" });
        }}
      />
    </BlockFrame>
  );
}
