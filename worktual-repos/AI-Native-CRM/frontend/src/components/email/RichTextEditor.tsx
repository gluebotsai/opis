import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { htmlToPlainText } from "@/lib/email-body";
import {
  Bold,
  Italic,
  Underline,
  List,
  ListOrdered,
  Link2,
  Link2Off,
  RemoveFormatting,
} from "lucide-react";

type FormatCommand =
  | "bold"
  | "italic"
  | "underline"
  | "insertUnorderedList"
  | "insertOrderedList"
  | "unlink"
  | "removeFormat";

function ToolbarButton({
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
      className={`inline-flex size-8 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-subtle hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40 ${
        active ? "bg-subtle text-text-primary" : ""
      }`}
    >
      {children}
    </button>
  );
}

function normalizeHref(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed) || /^mailto:/i.test(trimmed)) {
    return trimmed;
  }
  if (/^[\w.-]+\.[\w.-]+/.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return null;
}

export type RichTextFormatState = {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikeThrough: boolean;
  justifyLeft: boolean;
  justifyCenter: boolean;
  justifyRight: boolean;
  insertUnorderedList: boolean;
  insertOrderedList: boolean;
  fontName: string;
  fontSize: string;
  foreColor: string;
  hiliteColor: string;
};

export const EMPTY_RICH_TEXT_FORMAT: RichTextFormatState = {
  bold: false,
  italic: false,
  underline: false,
  strikeThrough: false,
  justifyLeft: false,
  justifyCenter: false,
  justifyRight: false,
  insertUnorderedList: false,
  insertOrderedList: false,
  fontName: "",
  fontSize: "",
  foreColor: "",
  hiliteColor: "",
};

function alignmentFromSelection(): Pick<
  RichTextFormatState,
  "justifyLeft" | "justifyCenter" | "justifyRight"
> {
  const center = document.queryCommandState("justifyCenter");
  const right = document.queryCommandState("justifyRight");
  if (center) {
    return { justifyLeft: false, justifyCenter: true, justifyRight: false };
  }
  if (right) {
    return { justifyLeft: false, justifyCenter: false, justifyRight: true };
  }
  const node = window.getSelection()?.anchorNode ?? null;
  const el = node instanceof Element ? node : node?.parentElement ?? null;
  const block = el?.closest("div,p,li,h1,h2,h3,h4,h5,h6,blockquote") ?? el;
  const align = block ? getComputedStyle(block).textAlign : "";
  return {
    justifyLeft: align === "left",
    justifyCenter: align === "center",
    justifyRight: align === "right",
  };
}

function readFormatState(): RichTextFormatState {
  const fontName = (document.queryCommandValue("fontName") || "").replace(/['"]/g, "");
  return {
    bold: document.queryCommandState("bold"),
    italic: document.queryCommandState("italic"),
    underline: document.queryCommandState("underline"),
    strikeThrough: document.queryCommandState("strikeThrough"),
    ...alignmentFromSelection(),
    insertUnorderedList: document.queryCommandState("insertUnorderedList"),
    insertOrderedList: document.queryCommandState("insertOrderedList"),
    fontName,
    fontSize: document.queryCommandValue("fontSize") || "",
    foreColor: document.queryCommandValue("foreColor") || "",
    hiliteColor:
      document.queryCommandValue("hiliteColor") ||
      document.queryCommandValue("backColor") ||
      "",
  };
}

export type RichTextEditorHandle = {
  focus: () => void;
  insertText: (text: string) => void;
  exec: (command: string, value?: string) => void;
  getFormatState: () => RichTextFormatState;
};

export const RichTextEditor = forwardRef<
  RichTextEditorHandle,
  {
    valueHtml: string;
    onChange: (html: string) => void;
    placeholder?: string;
    disabled?: boolean;
    minHeightClass?: string;
    maxHeightClass?: string;
    showToolbar?: boolean;
    bare?: boolean;
  }
>(function RichTextEditor(
  {
    valueHtml,
    onChange,
    placeholder = "Write your message…",
    disabled = false,
    minHeightClass = "min-h-[180px]",
    maxHeightClass = "max-h-[40dvh]",
    showToolbar = true,
    bare = false,
  },
  ref,
) {
  const editorRef = useRef<HTMLDivElement>(null);
  const linkInputRef = useRef<HTMLInputElement>(null);
  const lastEmittedHtml = useRef(valueHtml);
  const editorId = useId();
  const [showLink, setShowLink] = useState(false);
  const [linkUrl, setLinkUrl] = useState("https://");
  const [linkError, setLinkError] = useState<string | null>(null);
  const [active, setActive] = useState<Record<string, boolean>>({});
  const [empty, setEmpty] = useState(!valueHtml.trim());

  const syncFromDom = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    const html = el.innerHTML;
    const text = el.innerText.replace(/\u00a0/g, " ").trim();
    setEmpty(!text);
    lastEmittedHtml.current = text ? html : "";
    onChange(lastEmittedHtml.current);
    setActive({
      bold: document.queryCommandState("bold"),
      italic: document.queryCommandState("italic"),
      underline: document.queryCommandState("underline"),
      insertUnorderedList: document.queryCommandState("insertUnorderedList"),
      insertOrderedList: document.queryCommandState("insertOrderedList"),
    });
  }, [onChange]);

  useLayoutEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    const domText = el.innerText.replace(/\u00a0/g, " ").trim();
    const wantText = htmlToPlainText(valueHtml).trim();
    // lastEmittedHtml starts as the prop, but the editable div starts empty.
    // A draft opened with its body already set must still be painted.
    if (valueHtml === lastEmittedHtml.current && domText === wantText) return;
    if (document.activeElement === el && wantText === domText) {
      lastEmittedHtml.current = valueHtml;
      return;
    }
    lastEmittedHtml.current = valueHtml;
    el.innerHTML = valueHtml || "";
    const text = el.innerText.replace(/\u00a0/g, " ").trim();
    setEmpty(!text);
  }, [valueHtml]);

  useEffect(() => {
    if (showLink) {
      linkInputRef.current?.focus();
      linkInputRef.current?.select();
    }
  }, [showLink]);

  useEffect(() => {
    if (!showToolbar) setShowLink(false);
  }, [showToolbar]);

  function run(command: FormatCommand) {
    if (disabled) return;
    editorRef.current?.focus();
    document.execCommand(command, false);
    syncFromDom();
  }

  function openLinkPopover() {
    if (disabled) return;
    editorRef.current?.focus();
    setLinkUrl("https://");
    setLinkError(null);
    setShowLink(true);
  }

  function applyLink() {
    const href = normalizeHref(linkUrl);
    if (!href) {
      setLinkError("Enter a valid URL (https://… or mailto:…).");
      return;
    }
    editorRef.current?.focus();
    document.execCommand("createLink", false, href);
    syncFromDom();
    setShowLink(false);
    setLinkError(null);
  }

  function onEditorKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
    e.stopPropagation();
  }

  useImperativeHandle(
    ref,
    () => ({
      focus() {
        editorRef.current?.focus();
      },
      insertText(text: string) {
        if (disabled || !text) return;
        editorRef.current?.focus();
        document.execCommand("insertText", false, text);
        syncFromDom();
      },
      exec(command: string, value?: string) {
        if (disabled) return;
        editorRef.current?.focus();
        if (command === "fontSizePx" && value) {
          document.execCommand("styleWithCSS", false, "true");
          document.execCommand("fontSize", false, "7");
          editorRef.current?.querySelectorAll('font[size="7"], span[style*="font-size: xxx-large"], span[style*="font-size:xx-large"]').forEach((node) => {
            const el = node as HTMLElement;
            el.removeAttribute("size");
            el.style.fontSize = value;
          });
          syncFromDom();
          return;
        }
        if (command === "foreColor" || command === "hiliteColor" || command === "backColor") {
          document.execCommand("styleWithCSS", false, "true");
        }
        document.execCommand(command, false, value);
        syncFromDom();
      },
      getFormatState() {
        return readFormatState();
      },
    }),
    [disabled, syncFromDom],
  );

  return (
    <div
      className={
        bare ? "" : "rounded-lg border border-border-default bg-surface"
      }
    >
      {showToolbar ? (
      <div className="flex flex-wrap items-center gap-0.5 border-b border-border-default px-2 py-1.5">
        <ToolbarButton
          label="Bold"
          active={active.bold}
          disabled={disabled}
          onClick={() => run("bold")}
        >
          <Bold className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          label="Italic"
          active={active.italic}
          disabled={disabled}
          onClick={() => run("italic")}
        >
          <Italic className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          label="Underline"
          active={active.underline}
          disabled={disabled}
          onClick={() => run("underline")}
        >
          <Underline className="size-4" />
        </ToolbarButton>
        <span className="mx-1 h-5 w-px bg-border-default" aria-hidden />
        <ToolbarButton
          label="Bulleted list"
          active={active.insertUnorderedList}
          disabled={disabled}
          onClick={() => run("insertUnorderedList")}
        >
          <List className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          label="Numbered list"
          active={active.insertOrderedList}
          disabled={disabled}
          onClick={() => run("insertOrderedList")}
        >
          <ListOrdered className="size-4" />
        </ToolbarButton>
        <span className="mx-1 h-5 w-px bg-border-default" aria-hidden />
        <ToolbarButton
          label="Insert link"
          disabled={disabled}
          onClick={openLinkPopover}
        >
          <Link2 className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          label="Remove link"
          disabled={disabled}
          onClick={() => run("unlink")}
        >
          <Link2Off className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          label="Clear formatting"
          disabled={disabled}
          onClick={() => run("removeFormat")}
        >
          <RemoveFormatting className="size-4" />
        </ToolbarButton>
      </div>
      ) : null}

      {showLink ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-border-default bg-subtle/60 px-3 py-2">
          <label className="sr-only" htmlFor={`${editorId}-link`}>
            Link URL
          </label>
          <input
            ref={linkInputRef}
            id={`${editorId}-link`}
            value={linkUrl}
            onChange={(e) => {
              setLinkUrl(e.target.value);
              setLinkError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                applyLink();
              }
              if (e.key === "Escape") {
                setShowLink(false);
              }
            }}
            placeholder="https://example.com"
            disabled={disabled}
            className="min-w-0 flex-1 rounded-md border border-border-default bg-surface px-2.5 py-1.5 text-sm text-text-primary outline-none focus:border-border-focus"
          />
          <button
            type="button"
            className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-text-on-dark disabled:opacity-40"
            disabled={disabled}
            onClick={applyLink}
          >
            Apply
          </button>
          <button
            type="button"
            className="rounded-md px-2 py-1.5 text-xs text-text-caption hover:text-text-primary"
            onClick={() => setShowLink(false)}
          >
            Cancel
          </button>
          {linkError ? (
            <p className="w-full text-xs text-text-danger">{linkError}</p>
          ) : null}
        </div>
      ) : null}

      <div className="relative">
        {empty ? (
          <p className="pointer-events-none absolute left-3 top-3 text-sm text-text-placeholder">
            {placeholder}
          </p>
        ) : null}
        <div
          ref={editorRef}
          id={editorId}
          role="textbox"
          aria-multiline="true"
          aria-label="Message"
          contentEditable={!disabled}
          suppressContentEditableWarning
          onInput={syncFromDom}
          onBlur={syncFromDom}
          onKeyDown={onEditorKeyDown}
          onKeyUp={syncFromDom}
          onMouseUp={syncFromDom}
          className={`${minHeightClass} ${maxHeightClass} w-full overflow-y-auto whitespace-pre-wrap break-words px-3 py-3 text-sm leading-6 text-text-primary outline-none [&_div]:block [&_p]:my-0 [&_p]:block [&_a]:text-text-link [&_a]:underline [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 ${
            disabled ? "cursor-not-allowed opacity-60" : ""
          }`}
        />
      </div>
    </div>
  );
});
