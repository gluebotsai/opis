// @ts-nocheck
import { useCallback, useEffect, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import TextAlign from "@tiptap/extension-text-align";
import { Color } from "@tiptap/extension-color";
import { TextStyle } from "@tiptap/extension-text-style";
import Highlight from "@tiptap/extension-highlight";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import { TableKit } from "@tiptap/extension-table";
import FontFamily from "@tiptap/extension-font-family";
import HorizontalRule from "@tiptap/extension-horizontal-rule";
import Placeholder from "@tiptap/extension-placeholder";
import { Extension, Node, mergeAttributes } from "@tiptap/core";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  ChevronDown,
  Eraser,
  Highlighter,
  Image as ImageIcon,
  IndentDecrease,
  IndentIncrease,
  Italic,
  Link2,
  List,
  ListOrdered,
  Minus,
  Paperclip,
  PenLine,
  Redo2,
  Strikethrough,
  Table as TableIcon,
  Type,
  Underline as UnderlineIcon,
  Undo2,
  Users,
  AlertCircle,
  Lock,
  Sigma,
} from "lucide-react";

import { looksLikeHtmlSource, normalizePastedHtml } from "../lib/mailHtmlPaste.js";

const FONT_FAMILIES = [
  { label: "Arial", value: "Arial, Helvetica, sans-serif" },
  { label: "Calibri", value: "Calibri, sans-serif" },
  { label: "Georgia", value: "Georgia, serif" },
  { label: "Times New Roman", value: "Times New Roman, serif" },
  { label: "Verdana", value: "Verdana, sans-serif" },
  { label: "Courier New", value: "Courier New, monospace" },
];

const FONT_SIZES = ["10", "11", "12", "14", "16", "18", "20", "24", "28", "32"];

const TEXT_COLORS = [
  "#000000",
  "#434343",
  "#666666",
  "#980000",
  "#ff0000",
  "#ff9900",
  "#ffff00",
  "#00ff00",
  "#00ffff",
  "#4a86e8",
  "#0000ff",
  "#9900ff",
];

const HIGHLIGHT_COLORS = ["#ffff00", "#00ff00", "#00ffff", "#ff99cc", "#fce5cd", "#d9ead3", "#cfe2f3"];

const SPECIAL_CHARS = [
  "©",
  "®",
  "™",
  "€",
  "£",
  "¥",
  "₹",
  "§",
  "¶",
  "•",
  "…",
  "–",
  "—",
  "°",
  "±",
  "×",
  "÷",
  "½",
  "¼",
  "¾",
  "←",
  "→",
  "↑",
  "↓",
  "✓",
  "✗",
  "★",
  "☆",
  "♥",
  "♦",
  "♣",
  "♠",
];

const FontSize = Extension.create({
  name: "fontSize",
  addOptions() {
    return { types: ["textStyle"] };
  },
  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          fontSize: {
            default: null,
            parseHTML: (element) => element.style.fontSize?.replace(/['"]+/g, ""),
            renderHTML: (attributes) => {
              if (!attributes.fontSize) {
                return {};
              }
              return { style: `font-size: ${attributes.fontSize}` };
            },
          },
        },
      },
    ];
  },
  addCommands() {
    return {
      setFontSize:
        (fontSize) =>
        ({ chain }) =>
          chain().setMark("textStyle", { fontSize }).run(),
      unsetFontSize:
        () =>
        ({ chain }) =>
          chain().setMark("textStyle", { fontSize: null }).removeEmptyTextStyle().run(),
    };
  },
});

/** Keep inline styles on common mail/signature elements (tables, cells, paragraphs). */
const PreserveStyle = Extension.create({
  name: "preserveStyle",
  addGlobalAttributes() {
    return [
      {
        types: [
          "paragraph",
          "heading",
          "blockquote",
          "bulletList",
          "orderedList",
          "listItem",
          "table",
          "tableRow",
          "tableCell",
          "tableHeader",
          "image",
          "horizontalRule",
          "div",
        ],
        attributes: {
          style: {
            default: null,
            parseHTML: (element) => element.getAttribute("style"),
            renderHTML: (attributes) => {
              if (!attributes.style) {
                return {};
              }
              return { style: attributes.style };
            },
          },
        },
      },
    ];
  },
});

/** Signature HTML often uses styled <div> wrappers — keep them as block nodes. */
const DivNode = Node.create({
  name: "div",
  group: "block",
  content: "block*",
  defining: true,
  parseHTML() {
    return [{ tag: "div" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes), 0];
  },
});

function ToolbarButton({ active, disabled, onClick, title, children }) {
  return (
    <button
      aria-label={title}
      aria-pressed={active || undefined}
      className={`mail-editor-toolbar__btn ${active ? "is-active" : ""}`}
      disabled={disabled}
      onClick={onClick}
      title={title}
      type="button"
    >
      {children}
    </button>
  );
}

function ToolbarDivider() {
  return <span aria-hidden="true" className="mail-editor-toolbar__divider" />;
}

function ColorPicker({ colors, onSelect, title }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mail-editor-toolbar__dropdown">
      <button
        className="mail-editor-toolbar__btn"
        onClick={() => setOpen((current) => !current)}
        title={title}
        type="button"
      >
        <Type size={15} />
        <ChevronDown size={12} />
      </button>
      {open ? (
        <div className="mail-editor-toolbar__palette">
          {colors.map((color) => (
            <button
              key={color}
              aria-label={`Color ${color}`}
              className="mail-editor-toolbar__swatch"
              onClick={() => {
                onSelect(color);
                setOpen(false);
              }}
              style={{ backgroundColor: color }}
              type="button"
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

export function MailRichEditor({
  value = "",
  onChange,
  placeholder = "Write your message...",
  className = "",
  minHeight = 220,
  onAttachFiles,
  onInsertSignature,
  onCheckNames,
  importance = "normal",
  onImportanceChange,
  sensitivity = "normal",
  onSensitivityChange,
  showExtendedToolbar = true,
  /** Renders between the formatting toolbar and editor body (e.g. To / Subject). */
  beforeContent = null,
}) {
  const imageInputRef = useRef(null);
  const editorRef = useRef(null);
  const [showSpecialChars, setShowSpecialChars] = useState(false);
  const [showAddressBook, setShowAddressBook] = useState(false);
  const [addressQuery, setAddressQuery] = useState("");
  const [addressContacts, setAddressContacts] = useState([]);
  const [addressLoading, setAddressLoading] = useState(false);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ horizontalRule: false }),
      Underline,
      TextStyle,
      Color,
      FontSize,
      FontFamily,
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Link.configure({ openOnClick: false }),
      Image.configure({ inline: true, allowBase64: true }),
      TableKit.configure({ table: { resizable: true } }),
      HorizontalRule,
      DivNode,
      PreserveStyle,
      Placeholder.configure({ placeholder }),
    ],
    content: value || "",
    onCreate: ({ editor: currentEditor }) => {
      editorRef.current = currentEditor;
    },
    onUpdate: ({ editor: currentEditor }) => {
      onChange?.(currentEditor.getHTML());
    },
    editorProps: {
      attributes: {
        class: "mail-rich-editor__content",
      },
      transformPastedHTML: (html) => normalizePastedHtml(html),
      handlePaste: (_view, event) => {
        const clipboard = event.clipboardData;
        if (!clipboard) {
          return false;
        }

        const htmlData = clipboard.getData("text/html");
        const textData = clipboard.getData("text/plain");
        const payload = htmlData?.trim()
          ? normalizePastedHtml(htmlData)
          : looksLikeHtmlSource(textData)
            ? normalizePastedHtml(textData)
            : "";

        if (!payload) {
          return false;
        }

        const currentEditor = editorRef.current;
        if (!currentEditor) {
          return false;
        }

        event.preventDefault();
        currentEditor
          .chain()
          .focus()
          .insertContent(payload, {
            parseOptions: { preserveWhitespace: "full" },
          })
          .run();
        return true;
      },
    },
  });

  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);
  useEffect(() => {
    if (!editor) {
      return;
    }

    const current = editor.getHTML();
    const next = value || "";
    if (current !== next) {
      editor.commands.setContent(next, {
        emitUpdate: false,
        parseOptions: { preserveWhitespace: "full" },
      });
    }
  }, [editor, value]);

  const setLink = useCallback(() => {
    if (!editor) {
      return;
    }

    const previousUrl = editor.getAttributes("link").href || "";
    const url = window.prompt("Enter link URL", previousUrl);
    if (url === null) {
      return;
    }

    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }

    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  }, [editor]);

  async function handleImageSelected(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !editor) {
      return;
    }

    try {
      const dataUrl = await readFileAsDataUrl(file);
      editor.chain().focus().setImage({ src: dataUrl, alt: file.name }).run();
    } catch (error) {
      console.error(error);
    }
  }

  async function loadAddressBook() {
    setAddressLoading(true);
    try {
      const { fetchJson } = await import("../lib/http.js");
      const { getAuthToken } = await import("../lib/auth.js");
      const token = getAuthToken();
      const data = await fetchJson("/api/leads?limit=100", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const contacts = (data.leads || [])
        .flatMap((lead) => {
          const entries = [];
          if (lead.workEmail) {
            entries.push({
              name: lead.contactName || lead.companyName || lead.workEmail,
              email: lead.workEmail,
              company: lead.companyName || "",
            });
          }
          if (lead.adminEmail && lead.adminEmail !== lead.workEmail) {
            entries.push({
              name: lead.contactName || lead.companyName || lead.adminEmail,
              email: lead.adminEmail,
              company: lead.companyName || "",
            });
          }
          return entries;
        })
        .filter((entry, index, list) => list.findIndex((item) => item.email === entry.email) === index);
      setAddressContacts(contacts);
    } catch (error) {
      console.error("Could not load address book:", error);
      setAddressContacts([]);
    } finally {
      setAddressLoading(false);
    }
  }

  function openAddressBook() {
    setShowAddressBook(true);
    void loadAddressBook();
  }

  const filteredContacts = addressContacts.filter((contact) => {
    const query = addressQuery.trim().toLowerCase();
    if (!query) {
      return true;
    }
    return (
      contact.name.toLowerCase().includes(query) ||
      contact.email.toLowerCase().includes(query) ||
      contact.company.toLowerCase().includes(query)
    );
  });

  if (!editor) {
    return null;
  }

  return (
    <div className={`mail-rich-editor ${className}`.trim()}>
      <div className="mail-editor-toolbar" role="toolbar" aria-label="Formatting">
        <div className="mail-editor-toolbar__scroll">
        <ToolbarButton
          disabled={!editor.can().chain().focus().undo().run()}
          onClick={() => editor.chain().focus().undo().run()}
          title="Undo"
        >
          <Undo2 size={15} />
        </ToolbarButton>
        <ToolbarButton
          disabled={!editor.can().chain().focus().redo().run()}
          onClick={() => editor.chain().focus().redo().run()}
          title="Redo"
        >
          <Redo2 size={15} />
        </ToolbarButton>

        <ToolbarDivider />

        <select
          aria-label="Font family"
          className="mail-editor-toolbar__select"
          onChange={(event) =>
            editor.chain().focus().setFontFamily(event.target.value).run()
          }
          value={editor.getAttributes("textStyle").fontFamily || FONT_FAMILIES[0].value}
        >
          {FONT_FAMILIES.map((font) => (
            <option key={font.value} value={font.value}>
              {font.label}
            </option>
          ))}
        </select>

        <select
          aria-label="Font size"
          className="mail-editor-toolbar__select mail-editor-toolbar__select--size"
          onChange={(event) => editor.chain().focus().setFontSize(`${event.target.value}px`).run()}
          value={
            editor.getAttributes("textStyle").fontSize?.replace("px", "") || FONT_SIZES[2]
          }
        >
          {FONT_SIZES.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>

        <ToolbarDivider />

        <ToolbarButton
          active={editor.isActive("bold")}
          onClick={() => editor.chain().focus().toggleBold().run()}
          title="Bold"
        >
          <Bold size={15} />
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive("italic")}
          onClick={() => editor.chain().focus().toggleItalic().run()}
          title="Italic"
        >
          <Italic size={15} />
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive("underline")}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          title="Underline"
        >
          <UnderlineIcon size={15} />
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive("strike")}
          onClick={() => editor.chain().focus().toggleStrike().run()}
          title="Strikethrough"
        >
          <Strikethrough size={15} />
        </ToolbarButton>

        <ColorPicker
          colors={TEXT_COLORS}
          onSelect={(color) => editor.chain().focus().setColor(color).run()}
          title="Text color"
        />

        <div className="mail-editor-toolbar__dropdown">
          <button
            className="mail-editor-toolbar__btn"
            onClick={() => editor.chain().focus().toggleHighlight({ color: HIGHLIGHT_COLORS[0] }).run()}
            title="Highlight"
            type="button"
          >
            <Highlighter size={15} />
          </button>
          <div className="mail-editor-toolbar__palette mail-editor-toolbar__palette--inline">
            {HIGHLIGHT_COLORS.map((color) => (
              <button
                key={color}
                aria-label={`Highlight ${color}`}
                className="mail-editor-toolbar__swatch"
                onClick={() => editor.chain().focus().toggleHighlight({ color }).run()}
                style={{ backgroundColor: color }}
                type="button"
              />
            ))}
          </div>
        </div>

        <ToolbarButton
          onClick={() => editor.chain().focus().clearNodes().unsetAllMarks().run()}
          title="Clear formatting"
        >
          <Eraser size={15} />
        </ToolbarButton>

        <ToolbarDivider />

        <ToolbarButton
          active={editor.isActive({ textAlign: "left" })}
          onClick={() => editor.chain().focus().setTextAlign("left").run()}
          title="Align left"
        >
          <AlignLeft size={15} />
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive({ textAlign: "center" })}
          onClick={() => editor.chain().focus().setTextAlign("center").run()}
          title="Align center"
        >
          <AlignCenter size={15} />
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive({ textAlign: "right" })}
          onClick={() => editor.chain().focus().setTextAlign("right").run()}
          title="Align right"
        >
          <AlignRight size={15} />
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive({ textAlign: "justify" })}
          onClick={() => editor.chain().focus().setTextAlign("justify").run()}
          title="Justify"
        >
          <AlignJustify size={15} />
        </ToolbarButton>

        <ToolbarDivider />

        <ToolbarButton
          active={editor.isActive("bulletList")}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          title="Bulleted list"
        >
          <List size={15} />
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive("orderedList")}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          title="Numbered list"
        >
          <ListOrdered size={15} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().liftListItem("listItem").run()}
          title="Decrease indent"
        >
          <IndentDecrease size={15} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().sinkListItem("listItem").run()}
          title="Increase indent"
        >
          <IndentIncrease size={15} />
        </ToolbarButton>

        <ToolbarDivider />

        <ToolbarButton
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
          title="Horizontal line"
        >
          <Minus size={15} />
        </ToolbarButton>
        <ToolbarButton onClick={setLink} title="Insert link">
          <Link2 size={15} />
        </ToolbarButton>
        <ToolbarButton onClick={() => imageInputRef.current?.click()} title="Insert image">
          <ImageIcon size={15} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() =>
            editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
          }
          title="Insert table"
        >
          <TableIcon size={15} />
        </ToolbarButton>

        <div className="mail-editor-toolbar__dropdown">
          <ToolbarButton
            active={showSpecialChars}
            onClick={() => setShowSpecialChars((current) => !current)}
            title="Special characters"
          >
            <Sigma size={15} />
          </ToolbarButton>
          {showSpecialChars ? (
            <div className="mail-editor-toolbar__special-chars">
              {SPECIAL_CHARS.map((character) => (
                <button
                  key={character}
                  className="mail-editor-toolbar__char"
                  onClick={() => {
                    editor.chain().focus().insertContent(character).run();
                    setShowSpecialChars(false);
                  }}
                  type="button"
                >
                  {character}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {showExtendedToolbar ? (
          <>
            <ToolbarDivider />
            {onAttachFiles ? (
              <ToolbarButton onClick={onAttachFiles} title="Attach files">
                <Paperclip size={15} />
              </ToolbarButton>
            ) : null}
            <ToolbarButton onClick={openAddressBook} title="Address book">
              <Users size={15} />
            </ToolbarButton>
            {onCheckNames ? (
              <button
                className="mail-editor-toolbar__text-btn"
                onClick={onCheckNames}
                type="button"
              >
                Check names
              </button>
            ) : null}
            {onInsertSignature ? (
              <ToolbarButton onClick={onInsertSignature} title="Insert signature">
                <PenLine size={15} />
              </ToolbarButton>
            ) : null}
            <select
              aria-label="Importance"
              className="mail-editor-toolbar__select mail-editor-toolbar__select--importance"
              onChange={(event) => onImportanceChange?.(event.target.value)}
              title="Importance"
              value={importance}
            >
              <option value="low">Low importance</option>
              <option value="normal">Normal importance</option>
              <option value="high">High importance</option>
            </select>
            <select
              aria-label="Sensitivity"
              className="mail-editor-toolbar__select mail-editor-toolbar__select--sensitivity"
              onChange={(event) => onSensitivityChange?.(event.target.value)}
              title="Sensitivity"
              value={sensitivity}
            >
              <option value="normal">Normal</option>
              <option value="personal">Personal</option>
              <option value="private">Private</option>
              <option value="confidential">Confidential</option>
            </select>
            <ToolbarButton title="Sensitivity label" type="button">
              <Lock size={15} />
            </ToolbarButton>
            <ToolbarButton title="High importance flag" type="button">
              <AlertCircle size={15} />
            </ToolbarButton>
          </>
        ) : null}
        </div>
      </div>

      {beforeContent}

      <EditorContent editor={editor} style={{ minHeight }} />

      <input
        accept="image/*"
        className="sr-only"
        onChange={handleImageSelected}
        ref={imageInputRef}
        type="file"
      />

      {showAddressBook ? (
        <div className="mail-address-book" role="dialog" aria-modal="true">
          <div className="mail-address-book__backdrop" onClick={() => setShowAddressBook(false)} />
          <div className="mail-address-book__panel">
            <header className="mail-address-book__header">
              <strong>Address book</strong>
              <button onClick={() => setShowAddressBook(false)} type="button">
                Close
              </button>
            </header>
            <input
              className="mail-address-book__search"
              onChange={(event) => setAddressQuery(event.target.value)}
              placeholder="Search contacts..."
              type="search"
              value={addressQuery}
            />
            {addressLoading ? <p>Loading contacts...</p> : null}
            <ul className="mail-address-book__list">
              {filteredContacts.map((contact) => (
                <li key={contact.email}>
                  <button
                    onClick={() => {
                      onChange?.(
                        `${editor.getHTML()}<p>${contact.name} &lt;${contact.email}&gt;</p>`,
                      );
                      editor.commands.setContent(
                        `${editor.getHTML()}<p>${contact.name} &lt;${contact.email}&gt;</p>`,
                      );
                      setShowAddressBook(false);
                    }}
                    type="button"
                  >
                    <strong>{contact.name}</strong>
                    <span>{contact.email}</span>
                    {contact.company ? <small>{contact.company}</small> : null}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </div>
  );
}
