import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Search,
  BookOpen,
  Eye,
  Plus,
  X,
  Sparkles,
  FolderOpen,
  Star,
  Bookmark,
  ChevronLeft,
  CreditCard,
  Wrench,
  Users,
  Layers,
  Upload,
  Download,
  Paperclip,
  File,
  Trash2,
  UploadCloud,
  CheckCircle2,
  FilePenLine,
  Pencil,
  FileText,
} from 'lucide-react';
import { KBArticle } from '../types';
import { useSetPageTitle } from './layout/PageTitleContext';
import PageShell from './layout/PageShell';
import MenuSelect from './ui/menu-select';
import SegmentTabs from './ui/segment-tabs';
import CoworkerSplitWorkspace, {
  useCoworkerSplitExpandOptional,
} from './coworker/CoworkerSplitWorkspace';
import { useReportFocusedEntity } from './coworker/CoworkerSessionContext';
import { llmOnlyReply } from './coworker/llmGuidedReply';
import { mergeGuidedDraft, stepIndexFromAwaiting } from './coworker/guidedDraftMerge';

function fileLabel(url: string) {
  const base = String(url || '').split('/').pop() || url;
  return base.replace(/^\d+-/, '');
}

const KB_FILE_ACCEPT =
  '.txt,.md,.csv,.pdf,.doc,.docx,.rtf,.xls,.xlsx,.ppt,.pptx,.png,.jpg,.jpeg,.gif,.webp,.svg,.zip';

const KB_EXTRACT_ACCEPT =
  '.pdf,.docx,.txt,.md,.csv,.rtf,.png,.jpg,.jpeg,application/pdf,application/rtf,text/plain,text/markdown,text/csv,image/png,image/jpeg';

const KB_EXPORT_FORMATS = [
  { value: 'json', label: 'JSON', detail: 'Structured backup you can import later' },
  { value: 'csv', label: 'CSV', detail: 'Spreadsheet of titles, categories, and body' },
  { value: 'md', label: 'Markdown', detail: 'Readable document of every article' },
  { value: 'txt', label: 'Plain text', detail: 'Simple text file without markup' },
  { value: 'pdf', label: 'PDF', detail: 'Printable document for sharing or archive' },
  { value: 'doc', label: 'Word (.doc)', detail: 'Opens in Microsoft Word or Google Docs' },
] as const;

type KbExportFormat = (typeof KB_EXPORT_FORMATS)[number]['value'];

function normalizeKbExportFormat(format: string): KbExportFormat {
  const fmt = String(format || '').trim().toLowerCase();
  if (fmt === 'csv') return 'csv';
  if (fmt === 'md' || fmt === 'markdown') return 'md';
  if (fmt === 'txt' || fmt === 'text') return 'txt';
  if (fmt === 'pdf') return 'pdf';
  if (fmt === 'doc' || fmt === 'docx' || fmt === 'word' || fmt === 'msword') {
    return 'doc';
  }
  return 'json';
}

const DEFAULT_KB_CATEGORIES = [
  'General',
  'Billing',
  'Troubleshooting',
  'Accounts',
] as const;
const FEATURED_PAGE_SIZE = 6;

function normalizeCategoryLabel(raw: string | undefined | null): string {
  const s = String(raw || '').trim();
  return s || 'General';
}

/** Screen-only. Stored category / filter values stay as saved. */
function displayCategoryLabel(raw: string | undefined | null): string {
  const s = String(raw || '').trim();
  return s ? s.toUpperCase() : '';
}

function displayTitle(title: string | undefined) {
  const s = String(title || '').trim();
  return s || 'Untitled article';
}

function displayExcerpt(content: string | undefined, max = 110) {
  const s = normalizeKbPlainText(content)
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return 'No summary yet.';
  if (s.length <= max) return s;
  return `${s.slice(0, max).trim()}…`;
}

function protectKbInlineTokens(text: string): { text: string; tokens: string[] } {
  const tokens: string[] = [];
  const mark = (value: string) => {
    const token = `\u0000TK${tokens.length}\u0000`;
    tokens.push(value);
    return token;
  };
  let s = text;
  s = s.replace(/https?:\/\/[^\s<>"']+/gi, mark);
  s = s.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, mark);
  return { text: s, tokens };
}

function restoreKbInlineTokens(text: string, tokens: string[]): string {
  let s = text;
  for (let i = 0; i < tokens.length; i += 1) {
    s = s.replace(`\u0000TK${i}\u0000`, tokens[i]);
  }
  return s;
}

/** Soft-normalize plain KB text so mashed steps/sentences become readable. */
function normalizeKbPlainText(raw: string | undefined | null): string {
  let s = String(raw || '')
    .replace(/\r\n/g, '\n')
    .replace(/\u00a0/g, ' ')
    .trim();
  if (!s) return '';

  const inline = protectKbInlineTokens(s);
  s = inline.text;

  // Protect common abbreviations so "e.g." is never turned into "e. g." / split.
  const abs: string[] = [];
  s = s.replace(
    /\b(e\.g|i\.e|etc|vs|Mr|Mrs|Ms|Dr|Prof|Jr|Sr|U\.S|u\.s)\./gi,
    (m) => {
      const token = `\u0000AB${abs.length}\u0000`;
      abs.push(m);
      return token;
    }
  );

  // "inactivity.Log" → "inactivity. Log" (not abbreviation-protected dots)
  s = s.replace(/([.!?])([A-Za-z])/g, '$1 $2');
  // "FixesIncorrect Credentials:" → break before Title Case label
  s = s.replace(/([a-z0-9)&])([A-Z][A-Za-z0-9 /&'+-]{1,55}:)/g, '$1\n$2');
  // "locks. Browser Cache:" → start label on its own line
  s = s.replace(/([.!?])\s+(?=[A-Z][A-Za-z0-9 /&'+-]{1,55}:)/g, '$1\n');
  // "re-authenticate.2. Bypass" → break before next numbered step
  s = s.replace(/([.!?])\s*(\d{1,2})\.\s+/g, '$1\n$2. ');
  // Ensure "2. Title" starts on its own line when mid-string (capital after)
  s = s.replace(/(?<![.\n\d])\s+(\d{1,2})\.\s+(?=[A-Z])/g, '\n$1. ');
  s = s.replace(/^\s*(\d{1,2})\.\s+/gm, '$1. ');

  for (let i = 0; i < abs.length; i += 1) {
    s = s.replace(`\u0000AB${i}\u0000`, abs[i]);
  }

  s = restoreKbInlineTokens(s, inline.tokens);

  s = s
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
  return s.replace(/\n{3,}/g, '\n\n').trim();
}

function kbExportArticleFields(row: Record<string, unknown>) {
  return {
    title: String(row.title || 'Untitled').trim() || 'Untitled',
    category: String(row.category || '').trim(),
    status: String(row.status || '').trim(),
    author: String(row.author || '').trim(),
    content: normalizeKbPlainText(String(row.content || row.body || '')),
  };
}

function htmlEscapeKb(value: string): string {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildKbDocHtml(rows: Array<Record<string, unknown>>): string {
  const blocks = rows
    .map((row, i) => {
      const art = kbExportArticleFields(row);
      const meta = [
        art.category ? `Category: ${art.category}` : '',
        art.status ? `Status: ${art.status}` : '',
        art.author ? `Author: ${art.author}` : '',
      ]
        .filter(Boolean)
        .join(' · ');
      const body = htmlEscapeKb(art.content || 'No content yet.').replace(
        /\n/g,
        '<br/>'
      );
      const pageBreak = i > 0 ? 'page-break-before:always;' : '';
      return `<div style="${pageBreak}">
<h1 style="font-size:18pt;font-family:Calibri,Arial,sans-serif;">${htmlEscapeKb(art.title)}</h1>
${meta ? `<p style="color:#555555;font-size:10pt;">${htmlEscapeKb(meta)}</p>` : ''}
<p style="font-size:12pt;font-family:Calibri,Arial,sans-serif;white-space:pre-wrap;">${body}</p>
</div>`;
    })
    .join('\n');
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8"/>
<title>Worktual knowledge base</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View></w:WordDocument></xml><![endif]-->
</head>
<body>${blocks || '<p>No articles to export.</p>'}</body>
</html>`;
}

function pdfWinAnsi(text: string): string {
  let out = '';
  for (const ch of String(text || '')) {
    if (ch === '\\' || ch === '(' || ch === ')') {
      out += `\\${ch}`;
      continue;
    }
    const code = ch.charCodeAt(0);
    if (code === 10 || code === 13) {
      out += ' ';
      continue;
    }
    if (code >= 32 && code <= 126) {
      out += ch;
      continue;
    }
    const swap: Record<number, string> = {
      160: ' ',
      8211: '-',
      8212: '-',
      8216: "'",
      8217: "'",
      8220: '"',
      8221: '"',
      8226: '-',
      8230: '...',
    };
    if (swap[code]) {
      out += swap[code];
      continue;
    }
    if (code > 126 && code < 256) {
      out += `\\${code.toString(8).padStart(3, '0')}`;
      continue;
    }
    out += '?';
  }
  return out;
}

function wrapKbExportLines(text: string, maxChars: number): string[] {
  const lines: string[] = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const words = raw.split(/\s+/).filter(Boolean);
    if (!words.length) {
      lines.push('');
      continue;
    }
    let line = '';
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (next.length > maxChars && line) {
        lines.push(line);
        line = word;
      } else {
        line = next;
      }
    }
    if (line) lines.push(line);
  }
  return lines.length ? lines : [''];
}

function buildKbPdfBytes(rows: Array<Record<string, unknown>>): Uint8Array {
  const pageW = 612;
  const pageH = 792;
  const margin = 54;
  const leading = 14;
  const pages: string[][] = [];
  let cmds: string[] = [];
  let y = pageH - margin;

  const flushPage = () => {
    if (!cmds.length) {
      cmds.push('BT /F1 11 Tf 1 0 0 1 54 738 Tm ( ) Tj ET');
    }
    pages.push(cmds);
    cmds = [];
    y = pageH - margin;
  };

  const writeLine = (text: string, size: number, font: 'F1' | 'F2') => {
    if (y < margin + leading) flushPage();
    cmds.push(
      `BT /${font} ${size} Tf 1 0 0 1 ${margin} ${y} Tm (${pdfWinAnsi(text)}) Tj ET`
    );
    y -= leading;
  };

  const writeWrapped = (text: string, size: number, font: 'F1' | 'F2') => {
    const width = Math.max(40, Math.floor((pageW - margin * 2) / (size * 0.5)));
    for (const line of wrapKbExportLines(text, width)) {
      writeLine(line, size, font);
    }
  };

  const list = rows.length ? rows : [{ title: 'No articles to export.', content: '' }];
  list.forEach((row, i) => {
    if (i > 0) {
      y -= 8;
      if (y < margin + leading * 4) flushPage();
    }
    const art = kbExportArticleFields(row);
    writeWrapped(art.title, 14, 'F2');
    const meta = [art.category, art.status, art.author].filter(Boolean).join('  |  ');
    if (meta) writeWrapped(meta, 9, 'F1');
    y -= 4;
    writeWrapped(art.content || 'No content yet.', 11, 'F1');
  });
  flushPage();

  const objects = new Map<number, string>();
  objects.set(1, '<< /Type /Catalog /Pages 2 0 R >>');
  objects.set(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  objects.set(4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
  const pageIds: number[] = [];
  let nextId = 5;
  for (const page of pages) {
    const pageId = nextId;
    const contentId = nextId + 1;
    nextId += 2;
    pageIds.push(pageId);
    const stream = page.join('\n');
    objects.set(
      contentId,
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`
    );
    objects.set(
      pageId,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`
    );
  }
  objects.set(
    2,
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`
  );

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  const maxId = nextId - 1;
  for (let i = 1; i <= maxId; i += 1) {
    offsets[i] = pdf.length;
    pdf += `${i} 0 obj\n${objects.get(i) || '<< >>'}\nendobj\n`;
  }
  const xref = pdf.length;
  let table = `xref\n0 ${maxId + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= maxId; i += 1) {
    table += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `${table}trailer << /Size ${maxId + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}

type KbStepBlock = { n: string; title: string; lines: string[] };

const KB_ABBREV_END =
  /\b(e\.g|i\.e|etc|vs|mr|mrs|ms|dr|prof|jr|sr|u\.s)\.$/i;

function isEmailOrDomainPeriod(text: string, dotIndex: number): boolean {
  const before = text.slice(0, dotIndex);
  const at = before.lastIndexOf('@');
  if (at >= 0 && !/\s/.test(before.slice(at))) {
    const after = text.slice(dotIndex + 1);
    if (/^[A-Za-z0-9.-]/.test(after)) return true;
  }
  return false;
}

function splitSentences(chunk: string): string[] {
  const text = String(chunk || '').trim();
  if (!text) return [];
  const parts: string[] = [];
  let buf = '';
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    buf += ch;
    if (!/[.!?]/.test(ch)) continue;
    const next = text[i + 1];
    // Don't split inside abbreviations, decimals, or email/domain dots.
    if (
      KB_ABBREV_END.test(buf.trim()) ||
      /\d\.$/.test(buf) ||
      isEmailOrDomainPeriod(text, i)
    ) {
      continue;
    }
    if (next && /[A-Za-z0-9)]/.test(next)) continue;
    // Split only when punctuation is followed by space / end
    if (next === undefined || /\s/.test(next)) {
      const trimmed = buf.trim();
      if (trimmed) parts.push(trimmed);
      buf = '';
      while (i + 1 < text.length && /\s/.test(text[i + 1])) i += 1;
    }
  }
  const tail = buf.trim();
  if (tail) parts.push(tail);
  return parts.length ? parts : [text];
}

function parseKbSteps(text: string): KbStepBlock[] | null {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const joined = lines.join('\n');
  if (!/(^|\n)\d{1,2}\.\s+\S/.test(joined)) return null;

  const chunks = joined
    .split(/(?=^\d{1,2}\.\s+)/m)
    .map((c) => c.trim())
    .filter(Boolean);
  if (chunks.length < 2 && !/^\d{1,2}\.\s+/.test(chunks[0] || '')) {
    return null;
  }

  const steps: KbStepBlock[] = [];
  for (const chunk of chunks) {
    const m = chunk.match(/^(\d{1,2})\.\s+([\s\S]+)$/);
    if (!m) continue;
    const n = m[1];
    const rest = m[2].trim();
    const restLines = rest.split('\n').map((l) => l.trim()).filter(Boolean);

    // Prefer "Title: body" as heading + remaining prose (no bogus bullets).
    const head = restLines[0] || rest;
    const colon = head.match(/^([^:]{2,60}):\s+(.+)$/);
    let title: string;
    let bodyParts: string[];
    if (colon) {
      title = colon[1].trim();
      bodyParts = [colon[2].trim(), ...restLines.slice(1)].filter(Boolean);
    } else if (head.length <= 90 && !/[.!?]/.test(head.slice(0, -1))) {
      title = head.replace(/[.!?]+$/, '').trim();
      bodyParts = restLines.slice(1);
    } else {
      const sentences = splitSentences(head);
      if (sentences.length > 1 && sentences[0].length <= 90) {
        title = sentences[0].replace(/[.!?]+$/, '').trim();
        bodyParts = [...sentences.slice(1), ...restLines.slice(1)];
      } else {
        title = head.replace(/[.!?]+$/, '').trim();
        bodyParts = restLines.slice(1);
      }
    }

    const linesOut: string[] = [];
    for (const part of bodyParts) {
      // Keep a single prose block as one line; only bullet real multi-line notes.
      const trimmed = part.trim();
      if (!trimmed) continue;
      if (/^([•\-*]|\d+[.)])\s+/.test(trimmed)) {
        linesOut.push(trimmed.replace(/^([•\-*]|\d+[.)])\s+/, ''));
        continue;
      }
      linesOut.push(trimmed);
    }
    steps.push({
      n,
      title: title || `Step ${n}`,
      lines: linesOut,
    });
  }
  return steps.length ? steps : null;
}

/** "Incorrect Credentials: … Browser Cache: …" → point list (same idea as KB steps). */
function parseLabelPoints(
  text: string
): { intro: string; points: Array<{ title: string; body: string }> } | null {
  const s = String(text || '').trim();
  if (!s) return null;
  const re = /(^|\n)([^:\n]{2,60}):\s+/g;
  const matches = [...s.matchAll(re)];
  if (matches.length < 2) return null;

  const points: Array<{ title: string; body: string }> = [];
  for (let i = 0; i < matches.length; i += 1) {
    const m = matches[i];
    const title = String(m[2] || '').trim();
    const start = (m.index ?? 0) + m[0].length;
    const end = i + 1 < matches.length ? (matches[i + 1].index ?? s.length) : s.length;
    const body = s.slice(start, end).trim();
    if (!title || !body) continue;
    points.push({ title, body });
  }
  if (points.length < 2) return null;
  const firstIdx = matches[0].index ?? 0;
  const intro = s.slice(0, firstIdx).trim();
  return { intro, points };
}

export function KbArticleBody({
  content,
  compact = false,
}: {
  content: string;
  /** Tighter spacing for guided previews (macros / KB confirm). */
  compact?: boolean;
}): React.ReactElement {
  const normalized = normalizeKbPlainText(content);
  if (!normalized) {
    return (
      <p
        className={`${compact ? 'mt-0' : 'mt-6'} text-sm leading-relaxed text-neutral-500`}
      >
        No content yet.
      </p>
    );
  }

  const wrap = compact ? 'mt-0 space-y-3' : 'mt-6 space-y-6';
  const steps = parseKbSteps(normalized);
  if (steps) {
    return (
      <ol className={`list-none text-sm leading-relaxed text-neutral-800 ${wrap}`}>
        {steps.map((step) => (
          <li key={step.n} className="min-w-0">
            <div className="flex min-w-0 items-start gap-3">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-neutral-950 text-[11px] font-bold tabular-nums text-white">
                {step.n}
              </span>
              <div className="min-w-0 flex-1 space-y-1.5 text-left">
                <h3 className="text-[15px] font-semibold leading-snug text-neutral-950">
                  {step.title}
                </h3>
                {step.lines.length > 0 ? (
                  <p className="text-[13px] leading-relaxed text-neutral-700 whitespace-pre-wrap break-words">
                    {step.lines.join(' ')}
                  </p>
                ) : null}
              </div>
            </div>
          </li>
        ))}
      </ol>
    );
  }

  const labeled = parseLabelPoints(normalized);
  if (labeled) {
    return (
      <div className={`text-sm leading-relaxed text-neutral-800 ${compact ? 'mt-0 space-y-2.5' : 'mt-6 space-y-3'}`}>
        {labeled.intro ? (
          <p className="text-[13px] font-medium text-neutral-900 whitespace-pre-wrap break-words">
            {labeled.intro}
          </p>
        ) : null}
        <ul className="list-none space-y-3">
          {labeled.points.map((p, idx) => (
            <li key={`${p.title}-${idx}`} className="flex min-w-0 items-start gap-2.5">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-neutral-900" />
              <div className="min-w-0 flex-1 space-y-0.5">
                <p className="text-[13px] font-semibold leading-snug text-neutral-950">{p.title}</p>
                <p className="text-[12px] leading-relaxed text-neutral-700 whitespace-pre-wrap break-words">
                  {p.body}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const paragraphs = normalized.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  return (
    <div
      className={`${compact ? 'mt-0' : 'mt-6'} space-y-3 text-sm leading-relaxed text-neutral-800`}
    >
      {paragraphs.map((para, i) => {
        const lines = para.split('\n').map((l) => l.trim()).filter(Boolean);
        const looksLikeList =
          lines.length > 1 && lines.every((l) => /^([•\-*]|\d+[.)])\s+/.test(l));
        if (looksLikeList) {
          return (
            <ul key={i} className="list-disc space-y-1.5 pl-5 text-neutral-700">
              {lines.map((line, j) => (
                <li key={`${i}-${j}`} className="break-words">
                  {line.replace(/^([•\-*]|\d+[.)])\s+/, '')}
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={i} className="whitespace-pre-wrap break-words">
            {para}
          </p>
        );
      })}
    </div>
  );
}
function initials(name: string) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

type KbGuidedStepId = 'title' | 'category' | 'body' | 'confirm';

const KB_GUIDED_STEPS: Array<{ id: KbGuidedStepId; title: string; prompt: string }> = [
  { id: 'title', title: 'Title', prompt: 'what to name this article' },
  { id: 'category', title: 'Category', prompt: 'a category for this article' },
  { id: 'body', title: 'Body', prompt: 'the article content' },
  {
    id: 'confirm',
    title: 'Confirm',
    prompt: 'save as a staff-only draft or publish',
  },
];

function kbStepIndex(id: string): number {
  const raw = String(id || '')
    .trim()
    .toLowerCase();
  if (raw === 'publication_intent' || raw === 'publish' || raw === 'confirm') {
    return KB_GUIDED_STEPS.length - 1;
  }
  const mapped = raw === 'content' ? 'body' : raw;
  const idx = KB_GUIDED_STEPS.findIndex((s) => s.id === mapped);
  if (idx >= 0) return idx;
  return Math.min(stepIndexFromAwaiting('kb', raw), KB_GUIDED_STEPS.length - 1);
}

const PLACEHOLDER_KB_TITLES = new Set([
  'new article',
  'article',
  'untitled',
  'untitled article',
  'kb article',
  'knowledge base article',
  'new kb',
  'new kb article',
  'create article',
]);

function isPlaceholderKbTitle(title: string | undefined): boolean {
  const t = String(title || '')
    .trim()
    .replace(/[!?.]+$/, '')
    .toLowerCase();
  return !t || PLACEHOLDER_KB_TITLES.has(t);
}

function GuidedKbPreview({
  draft,
  stepIndex,
  publishing = false,
  action = null,
  onCancel,
  onUseForm,
  onSaveDraft,
  onConfirmCreate,
}: {
  draft: { title: string; category: string; body: string };
  stepIndex: number;
  publishing?: boolean;
  action?: 'draft' | 'publish' | null;
  onCancel: () => void;
  onUseForm?: () => void;
  onSaveDraft?: () => void;
  onConfirmCreate?: () => void;
}) {
  const total = KB_GUIDED_STEPS.length;
  const hasTitle = Boolean(draft.title.trim()) && !isPlaceholderKbTitle(draft.title);
  const hasCategory = Boolean(draft.category.trim());
  const hasBody = draft.body.trim().length >= 10;
  let displayStep = Math.min(Math.max(stepIndex, 0), total - 1);
  if (displayStep > 0 && !hasTitle) displayStep = 0;
  else if (displayStep > 1 && !hasCategory) displayStep = 1;
  else if (displayStep > 2 && !hasBody) displayStep = 2;
  const pct = Math.round((displayStep / total) * 100);
  const current = KB_GUIDED_STEPS[Math.min(displayStep, total - 1)];
  const completed = KB_GUIDED_STEPS.slice(0, displayStep).filter((s) => {
    if (s.id === 'title') return hasTitle;
    if (s.id === 'category') return hasCategory;
    if (s.id === 'body') return hasBody;
    return true;
  });
  const pending = KB_GUIDED_STEPS.slice(displayStep + 1);
  const label = hasTitle ? draft.title.trim() : 'New article';
  const canPublish = hasTitle && hasCategory && hasBody;

  return (
    <div className="h-full min-h-0 flex flex-col">
      <div className="px-4 py-4 border-b border-neutral-100 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-medium uppercase tracking-wide text-neutral-400">
              Creating with co-worker
            </p>
            <h3 className="text-base font-semibold text-neutral-900 truncate">{label}</h3>
            {draft.category ? (
              <p className="text-xs text-neutral-500 mt-0.5 truncate">
                {displayCategoryLabel(draft.category)}
              </p>
            ) : null}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {onUseForm && (
              <button
                type="button"
                onClick={onUseForm}
                className="text-xs font-semibold text-neutral-700 hover:text-black underline-offset-2 hover:underline"
              >
                Use form
              </button>
            )}
            <button
              type="button"
              onClick={onCancel}
              className="text-xs font-medium text-neutral-500 hover:text-neutral-900"
            >
              Cancel
            </button>
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between text-[11px] text-neutral-500 mb-1.5">
            <span>
              Step {Math.min(displayStep + 1, total)} of {total}
            </span>
            <span className="tabular-nums">{pct}%</span>
          </div>
          <div className="h-2 rounded-full bg-neutral-100 overflow-hidden">
            <div className="h-full bg-black transition-all duration-300" style={{ width: `${pct}%` }} />
          </div>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-5">
        <section className="space-y-2">
          <p className="text-[10px] font-medium uppercase tracking-wide text-neutral-400">Up next</p>
          <div className="rounded-xl border border-neutral-200 bg-neutral-50/80 p-4">
            <p className="text-sm font-semibold text-neutral-900">{current.title}</p>
            <p className="text-xs text-neutral-500 mt-1 leading-relaxed">
              Next in chat: {current.prompt}
            </p>
            {current.id === 'confirm' && (
              <div className="mt-3 space-y-3">
                <dl className="text-xs space-y-1.5 text-neutral-600">
                  <div className="flex gap-2">
                    <dt className="w-20 shrink-0 text-neutral-400">Title</dt>
                    <dd className="font-medium text-neutral-900">{draft.title || '—'}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-20 shrink-0 text-neutral-400">Category</dt>
                    <dd className="font-medium text-neutral-900">
                      {displayCategoryLabel(draft.category) || '—'}
                    </dd>
                  </div>
                  <div className="space-y-1.5">
                    <dt className="text-neutral-400">Body</dt>
                    <dd className="rounded-lg border border-neutral-200 bg-white px-2.5 py-2 max-h-48 overflow-y-auto">
                      {draft.body.trim() ? (
                        <KbArticleBody content={draft.body} compact />
                      ) : (
                        <span className="text-neutral-400">—</span>
                      )}
                    </dd>
                  </div>
                </dl>
                <div className="flex flex-wrap gap-2">
                  {onSaveDraft && (
                    <button
                      type="button"
                      disabled={publishing || !canPublish}
                      onClick={onSaveDraft}
                      className="h-9 px-3 rounded-xl border border-neutral-200 bg-white text-xs font-semibold text-neutral-800 hover:bg-neutral-50 disabled:opacity-50"
                    >
                      {action === 'draft' ? 'Saving…' : 'Draft article'}
                    </button>
                  )}
                  {onConfirmCreate && (
                    <button
                      type="button"
                      disabled={publishing || !canPublish}
                      onClick={onConfirmCreate}
                      className="h-9 px-3 rounded-xl bg-black text-white text-xs font-semibold hover:bg-neutral-800 disabled:opacity-50"
                    >
                      {action === 'publish' ? 'Publishing…' : 'Publish article'}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
          {pending.length > 0 && (
            <ul className="space-y-1.5 pt-1">
              {pending.map((s) => (
                <li
                  key={s.id}
                  className="text-xs text-neutral-400 px-3 py-2 rounded-lg border border-dashed border-neutral-200"
                >
                  {s.title}
                </li>
              ))}
            </ul>
          )}
        </section>
        {completed.length > 0 && (
          <section className="space-y-2">
            <p className="text-[10px] font-medium uppercase tracking-wide text-neutral-400">
              Completed
            </p>
            <ul className="space-y-2">
              {completed.map((s) => (
                <li
                  key={s.id}
                  className="flex items-start gap-2 rounded-lg border border-neutral-100 bg-white px-3 py-2"
                >
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-neutral-900" />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-neutral-800">{s.title}</p>
                    {s.id === 'title' ? (
                      <p className="text-[11px] text-neutral-500 truncate">{draft.title}</p>
                    ) : s.id === 'category' ? (
                      <p className="text-[11px] text-neutral-500 truncate">
                        {displayCategoryLabel(draft.category)}
                      </p>
                    ) : s.id === 'body' ? (
                      <div className="mt-1 max-h-28 overflow-y-auto rounded-md border border-neutral-100 bg-neutral-50/80 px-2 py-1.5">
                        <KbArticleBody content={draft.body} compact />
                      </div>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
function categoryStyle(category: string) {
  switch (category) {
    case 'Troubleshooting':
      return {
        pill: 'bg-neutral-100 text-neutral-700 border-neutral-200',
        iconBg: 'bg-neutral-100 text-neutral-700',
        art: 'from-neutral-100 via-neutral-50 to-white',
        blob: 'bg-neutral-300/40',
        Icon: Wrench,
      };
    case 'Billing':
      return {
        pill: 'bg-neutral-100 text-neutral-700 border-neutral-200',
        iconBg: 'bg-neutral-100 text-neutral-700',
        art: 'from-neutral-100 via-neutral-50 to-white',
        blob: 'bg-neutral-300/40',
        Icon: CreditCard,
      };
    case 'Accounts':
      return {
        pill: 'bg-neutral-100 text-neutral-700 border-neutral-200',
        iconBg: 'bg-neutral-100 text-neutral-700',
        art: 'from-neutral-100 via-neutral-50 to-white',
        blob: 'bg-neutral-300/40',
        Icon: Users,
      };
    default:
      return {
        pill: 'bg-neutral-100 text-neutral-700 border-neutral-200',
        iconBg: 'bg-neutral-100 text-neutral-700',
        art: 'from-neutral-100 via-neutral-50 to-white',
        blob: 'bg-neutral-300/35',
        Icon: Layers,
      };
  }
}

export default function KnowledgeBaseView({
  canMutate = true,
  externalSearchQuery,
  embedded = false,
  currentUserName,
  startCreateIntent = false,
  startCreateSeed = null,
  openArticleSeed = null,
  onConsumeCreateIntent,
  onConsumeOpenSeed,
  listRefreshToken = 0,
  moduleResetKey = 0,
  onCoworkerMessage,
  onCoworkerChatActions,
  onAgentRoute,
}: {
  canMutate?: boolean;
  externalSearchQuery?: string;
  embedded?: boolean;
  currentUserName?: string;
  startCreateIntent?: boolean;
  startCreateSeed?: {
    step?: string;
    title?: string;
    category?: string;
    body?: string;
  } | null;
  openArticleSeed?: {
    id?: string;
    title?: string;
    content?: string;
    category?: string;
    status?: string;
  } | null;
  onConsumeCreateIntent?: () => void;
  onConsumeOpenSeed?: () => void;
  listRefreshToken?: number;
  moduleResetKey?: number;
  onCoworkerMessage?: (text: string) => string | null | Promise<string | null>;
  onCoworkerChatActions?: (
    actions: Record<string, unknown>[],
    meta: { reply: string; agent: string; userText: string }
  ) => void | Promise<void>;
  onAgentRoute?: (agent: string, userText?: string) => void;
}) {
  useSetPageTitle('Knowledge Base');
  const split = useCoworkerSplitExpandOptional();
  const [articles, setArticles] = useState<KBArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState('All');
  const [sortBy, setSortBy] = useState<
    'latest' | 'views' | 'published' | 'draft'
  >('latest');
  /** Featured shelf shows 6 cards until View all expands to every article. */
  const [showAllGuides, setShowAllGuides] = useState(false);
  const featuredSectionRef = useRef<HTMLElement | null>(null);
  const kbScrollRef = useRef<HTMLDivElement | null>(null);

  const scrollToEl = useCallback((el: HTMLElement | null) => {
    if (!el) return;
    const scroller = kbScrollRef.current;
    window.setTimeout(() => {
      if (scroller) {
        const scrollerRect = scroller.getBoundingClientRect();
        const elRect = el.getBoundingClientRect();
        const nextTop =
          scroller.scrollTop + (elRect.top - scrollerRect.top) - 12;
        scroller.scrollTo({ top: Math.max(0, nextTop), behavior: 'smooth' });
        return;
      }
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
  }, []);

  const viewAllArticles = useCallback(() => {
    const next = !showAllGuides;
    setShowAllGuides(next);
    window.setTimeout(() => {
      scrollToEl(featuredSectionRef.current);
    }, 0);
  }, [scrollToEl, showAllGuides]);

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [guidedKb, setGuidedKb] = useState(false);
  const [guidedStepIndex, setGuidedStepIndex] = useState(0);
  const [publishing, setPublishing] = useState(false);
  const [createAction, setCreateAction] = useState<'draft' | 'publish' | null>(
    null
  );
  const [publishError, setPublishError] = useState<string | null>(null);
  const [editingArticle, setEditingArticle] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [editCategory, setEditCategory] = useState('General');
  const [editError, setEditError] = useState<string | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [pendingDeleteTitle, setPendingDeleteTitle] = useState('');
  const [deletingArticle, setDeletingArticle] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [guidedCategory, setGuidedCategory] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');
  const [newCategory, setNewCategory] = useState('General');
  const [extraCategories, setExtraCategories] = useState<string[]>([]);
  const [showManageCategories, setShowManageCategories] = useState(false);
  const [manageCategoryInput, setManageCategoryInput] = useState('');
  const [categorySelectMode, setCategorySelectMode] = useState<'list' | 'custom'>(
    'list'
  );
  const [customCategoryInput, setCustomCategoryInput] = useState('');
  const [showExportForm, setShowExportForm] = useState(false);
  const [exportFormat, setExportFormat] = useState<KbExportFormat | ''>('');
  const [newAuthor, setNewAuthor] = useState(currentUserName || '');
  const [createError, setCreateError] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [extractingPdf, setExtractingPdf] = useState(false);
  const [sourceMode, setSourceMode] = useState<'write' | 'upload'>('write');
  const [dragActive, setDragActive] = useState(false);
  const [selectedArticleId, setSelectedArticleId] = useState<string | null>(null);
  const pendingOpenArticleRef = useRef<{ id?: string; title?: string } | null>(null);
  const manageCategoriesRef = useRef<HTMLDivElement | null>(null);
  const articlesRef = useRef<KBArticle[]>([]);
  articlesRef.current = articles;
  const selectedArticle = articles.find((a) => a.id === selectedArticleId) || null;
  useReportFocusedEntity(
    selectedArticle
      ? { type: 'article', id: selectedArticle.id, name: selectedArticle.title }
      : null
  );

  useEffect(() => {
    split?.focusContent();
  }, [split]);

  useEffect(() => {
    setEditingArticle(false);
    setEditError(null);
    setSavingEdit(false);
    setPendingDeleteId(null);
    setPendingDeleteTitle('');
    setDeleteError(null);
  }, [selectedArticleId]);

  useEffect(() => {
    if (!pendingDeleteId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancelDeleteArticle();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pendingDeleteId, deletingArticle]);

  useEffect(() => {
    if (currentUserName) setNewAuthor(currentUserName);
  }, [currentUserName]);

  useEffect(() => {
    if (externalSearchQuery !== undefined) setSearchQuery(externalSearchQuery);
  }, [externalSearchQuery]);

  useEffect(() => {
    if (!showManageCategories) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (manageCategoriesRef.current?.contains(t)) return;
      setShowManageCategories(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [showManageCategories]);

  const fetchArticles = async () => {
    try {
      const res = await fetch('/api/kb', { credentials: 'include' });
      const data = await res.json();
      const rows = Array.isArray(data) ? data : [];
      setArticles(rows);
      const pending = pendingOpenArticleRef.current;
      if (pending) {
        pendingOpenArticleRef.current = null;
        const wantedId = String(pending.id || '').trim().toLowerCase();
        const wantedTitle = String(pending.title || '').trim().toLowerCase();
        const byId = wantedId
          ? rows.find((a) => String(a.id || '').trim().toLowerCase() === wantedId)
          : undefined;
        const byTitle = wantedTitle
          ? rows.find(
              (a) => String(a.title || '').trim().toLowerCase() === wantedTitle
            )
          : undefined;
        const hit = byId || byTitle;
        if (hit?.id) setSelectedArticleId(hit.id);
        else if (pending.title) setSearchQuery(pending.title);
      }
    } catch (err) {
      console.error('Failed to fetch KB articles', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchArticles();
  }, []);

  useEffect(() => {
    if (!listRefreshToken) return;
    void fetchArticles();
  }, [listRefreshToken]);

  const handledModuleResetKey = useRef(0);
  useEffect(() => {
    if (moduleResetKey <= handledModuleResetKey.current) return;
    handledModuleResetKey.current = moduleResetKey;
    setSelectedArticleId(null);
    setShowCreateForm(false);
    setGuidedKb(false);
    setGuidedStepIndex(0);
    setEditingArticle(false);
    setShowManageCategories(false);
    setShowAllGuides(false);
    setCreateAction(null);
    split?.clearContentFocus?.();
  }, [moduleResetKey, split?.clearContentFocus]);

  const extractFileAsBody = async (
    file: File,
    apply: (text: string) => void
  ) => {
    setExtractingPdf(true);
    setCreateError(null);
    setEditError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/kb/extract-file', {
        method: 'POST',
        credentials: 'include',
        body: form,
      });
      const data = (await res.json().catch(() => null)) as {
        content?: string;
        error?: string;
      } | null;
      if (!res.ok) {
        const message = data?.error || 'Could not extract file text.';
        setCreateError(message);
        setEditError(message);
        return false;
      }
      const content = String(data?.content || '').trim();
      if (content.length < 10) {
        const message = 'File had no extractable text.';
        setCreateError(message);
        setEditError(message);
        return false;
      }
      apply(content);
      return true;
    } catch {
      setCreateError('Could not extract file text.');
      setEditError('Could not extract file text.');
      return false;
    } finally {
      setExtractingPdf(false);
    }
  };

  const uploadFiles = async (fileList: FileList | null) => {
    if (!fileList?.length) return;
    setUploading(true);
    setCreateError(null);
    const form = new FormData();
    Array.from(fileList).forEach((f) => form.append('files', f));
    try {
      const res = await fetch('/api/uploads', {
        method: 'POST',
        credentials: 'include',
        body: form,
      });
      if (!res.ok) {
        setCreateError('Could not upload one or more files.');
        return;
      }
      const data = await res.json();
      const urls = Array.isArray(data?.urls) ? data.urls.map(String) : [];
      setAttachments((prev) => [...prev, ...urls]);
    } catch {
      setCreateError('Could not upload files.');
    } finally {
      setUploading(false);
    }
  };

  const resetCreateForm = useCallback(() => {
    setNewTitle('');
    setNewContent('');
    setNewCategory('General');
    setGuidedCategory('');
    setCategorySelectMode('list');
    setCustomCategoryInput('');
    setNewAuthor(currentUserName || '');
    setAttachments([]);
    setShowCreateForm(false);
    setGuidedKb(false);
    setGuidedStepIndex(0);
    setSourceMode('write');
    setExtractingPdf(false);
  }, [currentUserName]);

  const handleCreateArticle = async (
    e?: React.FormEvent,
    mode: 'draft' | 'publish' = 'publish'
  ) => {
    e?.preventDefault();
    setCreateError(null);
    const title = newTitle.trim();
    const content = newContent.trim();
    if (title.length < 2) {
      setCreateError('Title needs at least 2 characters.');
      return;
    }
    if (content.length < 10) {
      setCreateError(
        sourceMode === 'upload'
          ? 'Upload a file so we can extract the article text.'
          : 'Body needs at least 10 characters.'
      );
      return;
    }

    setCreateAction(mode);
    setPublishing(true);
    try {
      const res = await fetch('/api/kb', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          title,
          content,
          category: rememberCategory(guidedCategory || newCategory),
          author: newAuthor.trim() || currentUserName || 'Staff',
          attachments,
          ...(mode === 'draft' ? { status: 'draft' } : {}),
        }),
      });
      if (res.ok) {
        const created = (await res.json().catch(() => null)) as KBArticle | null;
        resetCreateForm();
        void fetchArticles();
        if (created?.id && mode === 'draft') {
          setSelectedArticleId(created.id);
        }
      } else {
        const body = await res.json().catch(() => null);
        setCreateError(
          body?.error ||
            (mode === 'draft'
              ? 'Could not save draft.'
              : 'Could not publish article.')
        );
      }
    } catch (err) {
      console.error('Failed to create article', err);
      setCreateError(
        mode === 'draft' ? 'Could not save draft.' : 'Could not publish article.'
      );
    } finally {
      setPublishing(false);
      setCreateAction(null);
    }
  };

  const startEditArticle = () => {
    if (!selectedArticle) return;
    setEditTitle(selectedArticle.title || '');
    setEditContent(String(selectedArticle.content || ''));
    setEditCategory(selectedArticle.category || 'General');
    setEditError(null);
    setEditingArticle(true);
  };

  const cancelEditArticle = () => {
    setEditingArticle(false);
    setEditError(null);
    setSavingEdit(false);
  };

  const handleSaveEditedArticle = async () => {
    if (!selectedArticle) return;
    const title = editTitle.trim();
    const content = editContent.trim();
    const category = rememberCategory(editCategory);
    if (title.length < 2) {
      setEditError('Title needs at least 2 characters.');
      return;
    }
    if (content.length < 10) {
      setEditError('Body needs at least 10 characters.');
      return;
    }
    setEditError(null);
    setSavingEdit(true);
    try {
      const res = await fetch(
        `/api/kb/${encodeURIComponent(selectedArticle.id)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            title,
            content,
            category,
          }),
        }
      );
      if (res.ok) {
        setEditingArticle(false);
        void fetchArticles();
      } else {
        const body = await res.json().catch(() => null);
        setEditError(body?.error || 'Could not save article.');
      }
    } catch (err) {
      console.error('Failed to save article', err);
      setEditError('Could not save article.');
    } finally {
      setSavingEdit(false);
    }
  };

  const deleteArticleById = async (articleId: string) => {
    const id = String(articleId || '').trim();
    if (!id || deletingArticle) return;
    const snapshot = articlesRef.current;
    setDeleteError(null);
    setDeletingArticle(true);
    setArticles((prev) => prev.filter((a) => a.id !== id));
    if (selectedArticleId === id) setSelectedArticleId(null);
    try {
      const res = await fetch(`/api/kb/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const contentType = String(res.headers.get('content-type') || '');
      const body = contentType.includes('application/json')
        ? ((await res.json().catch(() => null)) as { ok?: boolean; id?: string; error?: string } | null)
        : null;
      const deleted =
        res.status === 204 ||
        (res.ok && Boolean(body?.ok || body?.id) && !body?.error);
      if (deleted) {
        setPendingDeleteId(null);
        void fetchArticles();
        return;
      }
      setArticles(snapshot);
      setDeleteError(body?.error || 'Could not delete article.');
    } catch (err) {
      console.error('Failed to delete article', err);
      setArticles(snapshot);
      setDeleteError('Could not delete article.');
    } finally {
      setDeletingArticle(false);
    }
  };

  const askDeleteArticle = (article: { id: string; title: string }) => {
    setDeleteError(null);
    setPendingDeleteId(article.id);
    setPendingDeleteTitle(article.title || 'this article');
  };

  const cancelDeleteArticle = () => {
    if (deletingArticle) return;
    setPendingDeleteId(null);
    setPendingDeleteTitle('');
  };

  const handlePublishDraft = async () => {
    if (!selectedArticle || selectedArticle.status !== 'Draft') return;
    setPublishError(null);
    setPublishing(true);
    try {
      const res = await fetch(
        `/api/kb/${encodeURIComponent(selectedArticle.id)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ status: 'published' }),
        }
      );
      if (res.ok) {
        void fetchArticles();
      } else {
        const body = await res.json().catch(() => null);
        setPublishError(body?.error || 'Could not publish article.');
      }
    } catch (err) {
      console.error('Failed to publish draft', err);
      setPublishError('Could not publish article.');
    } finally {
      setPublishing(false);
    }
  };

  const availableCategories = useMemo(() => {
    const names = new Set<string>([
      ...DEFAULT_KB_CATEGORIES,
      ...extraCategories.map(normalizeCategoryLabel),
    ]);
    for (const a of articles) {
      names.add(normalizeCategoryLabel(a.category));
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [articles, extraCategories]);

  const filterTabs = useMemo(
    () => ['All', ...availableCategories],
    [availableCategories]
  );

  const rememberCategory = useCallback((raw: string) => {
    const name = normalizeCategoryLabel(raw);
    setExtraCategories((prev) => {
      if (
        prev.some((c) => c.toLowerCase() === name.toLowerCase()) ||
        (DEFAULT_KB_CATEGORIES as readonly string[]).some(
          (c) => c.toLowerCase() === name.toLowerCase()
        )
      ) {
        return prev;
      }
      return [...prev, name];
    });
    return name;
  }, []);

  const stats = useMemo(() => {
    const published = articles.filter((a) => a.status !== 'Draft').length;
    const drafts = articles.filter((a) => a.status === 'Draft').length;
    const views = articles.reduce((n, a) => n + (a.views || 0), 0);
    return {
      total: articles.length,
      published,
      drafts,
      views,
    };
  }, [articles]);

  const filteredArticles = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const tab = normalizeCategoryLabel(activeTab === 'All' ? '' : activeTab);
    let list = articles.filter((art) => {
      const artCat = normalizeCategoryLabel(art.category);
      const matchesTab =
        activeTab === 'All' || artCat.toLowerCase() === tab.toLowerCase();
      const matchesSearch =
        !q ||
        art.title.toLowerCase().includes(q) ||
        art.content.toLowerCase().includes(q) ||
        art.author.toLowerCase().includes(q) ||
        artCat.toLowerCase().includes(q);
      return matchesTab && matchesSearch;
    });
    if (sortBy === 'published') {
      list = list.filter((art) => art.status !== 'Draft');
    } else if (sortBy === 'draft') {
      list = list.filter((art) => art.status === 'Draft');
    }
    if (sortBy === 'views') {
      list = [...list].sort((a, b) => (b.views || 0) - (a.views || 0));
    }
    return list;
  }, [articles, activeTab, searchQuery, sortBy]);

  const featuredArticles = useMemo(() => {
    return showAllGuides
      ? filteredArticles
      : filteredArticles.slice(0, FEATURED_PAGE_SIZE);
  }, [filteredArticles, showAllGuides]);

  const openCreate = () => {
    setCreateError(null);
    setAttachments([]);
    setGuidedKb(false);
    setSourceMode('write');
    setShowExportForm(false);
    setExportFormat('');
    setShowCreateForm(true);
  };

  const cancelGuidedKb = () => {
    setGuidedKb(false);
    setGuidedStepIndex(0);
    setGuidedCategory('');
    setShowCreateForm(false);
  };

  useEffect(() => {
    if (!startCreateIntent) return;
    onConsumeCreateIntent?.();
    if (canMutate) {
      const step = String(startCreateSeed?.step || 'title').trim().toLowerCase();
      const seedTitle = String(startCreateSeed?.title || '').trim();
      const seedCategory = String(startCreateSeed?.category || '').trim();
      const seedBody = String(startCreateSeed?.body || '').trim();
      setCreateError(null);
      setShowCreateForm(false);
      setGuidedKb(true);
      setGuidedStepIndex(kbStepIndex(step || 'title'));
      if (seedTitle && !isPlaceholderKbTitle(seedTitle)) setNewTitle(seedTitle);
      if (seedCategory) {
        const remembered = rememberCategory(normalizeCategoryLabel(seedCategory));
        setGuidedCategory(remembered);
        setNewCategory(remembered);
      }
      if (seedBody) setNewContent(seedBody);
    }
  }, [startCreateIntent, startCreateSeed, onConsumeCreateIntent, canMutate, rememberCategory]);

  useEffect(() => {
    if (!openArticleSeed || (!openArticleSeed.id && !openArticleSeed.title)) return;
    const aid = String(openArticleSeed.id || '').trim();
    const title = String(openArticleSeed.title || '').trim();
    const statusRaw = String(openArticleSeed.status || '').trim();
    const status: KBArticle['status'] =
      statusRaw.toLowerCase() === 'draft' ? 'Draft' : 'Published';
    pendingOpenArticleRef.current = aid
      ? { id: aid, title: title || undefined }
      : { title };
    setGuidedKb(false);
    setShowCreateForm(false);
    setActiveTab('All');
    setSelectedArticleId(aid || null);
    if (aid || title) {
      setArticles((prev) => {
        const wantedId = aid.toLowerCase();
        const wantedTitle = title.toLowerCase();
        const existing = prev.find(
          (a) =>
            (wantedId && String(a.id).toLowerCase() === wantedId) ||
            (wantedTitle && String(a.title).toLowerCase() === wantedTitle)
        );
        if (existing) return prev;
        if (!aid && !title) return prev;
        return [
          {
            id: aid || title,
            title: title || aid,
            content: String(openArticleSeed.content || ''),
            category: (openArticleSeed.category || 'General') as KBArticle['category'],
            author: currentUserName || '',
            status,
            views: 0,
            updatedAt: 'just now',
          },
          ...prev,
        ];
      });
    }
    onConsumeOpenSeed?.();
  }, [openArticleSeed, onConsumeOpenSeed, currentUserName]);

  const kbExportRows = useCallback(
    () =>
      articles.map((a) => ({
        id: a.id,
        title: a.title,
        content: a.content,
        category: a.category,
        status: a.status,
        author: a.author,
        views: a.views || 0,
      })),
    [articles]
  );

  const downloadKbExport = useCallback(
    (
      format: string,
      filename: string,
      rows: Array<Record<string, unknown>>
    ) => {
      const fmt = normalizeKbExportFormat(format);
      let body: BlobPart = '';
      let mime = 'application/json;charset=utf-8';
      if (fmt === 'pdf') {
        body = buildKbPdfBytes(rows);
        mime = 'application/pdf';
      } else if (fmt === 'doc') {
        body = buildKbDocHtml(rows);
        mime = 'application/msword';
      } else if (fmt === 'csv') {
        const header = ['id', 'title', 'category', 'status', 'author', 'views', 'content'];
        const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
        body = [
          header.join(','),
          ...rows.map((r) => header.map((h) => esc(r[h])).join(',')),
        ].join('\n');
        mime = 'text/csv;charset=utf-8';
      } else if (fmt === 'md') {
        body = rows
          .map((r) => {
            const title = String(r.title || 'Untitled').trim() || 'Untitled';
            const category = String(r.category || '').trim();
            const status = String(r.status || '').trim();
            const author = String(r.author || '').trim();
            const content = String(r.content || '').trim();
            const meta = [
              category ? `Category: ${category}` : '',
              status ? `Status: ${status}` : '',
              author ? `Author: ${author}` : '',
            ]
              .filter(Boolean)
              .join('\n');
            return [`# ${title}`, meta, content].filter(Boolean).join('\n\n');
          })
          .join('\n\n---\n\n');
        mime = 'text/markdown;charset=utf-8';
      } else if (fmt === 'txt') {
        body = rows
          .map((r) => {
            const title = String(r.title || 'Untitled').trim() || 'Untitled';
            const category = String(r.category || '').trim();
            const status = String(r.status || '').trim();
            const author = String(r.author || '').trim();
            const content = String(r.content || '').trim();
            const meta = [
              category ? `Category: ${category}` : '',
              status ? `Status: ${status}` : '',
              author ? `Author: ${author}` : '',
            ]
              .filter(Boolean)
              .join('\n');
            return [title, meta, content].filter(Boolean).join('\n\n');
          })
          .join('\n\n----\n\n');
        mime = 'text/plain;charset=utf-8';
      } else {
        body = JSON.stringify(rows, null, 2);
      }
      const blob = new Blob([body], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename || `worktual-kb.${fmt}`;
      a.click();
      URL.revokeObjectURL(url);
    },
    []
  );

  const runKbExport = useCallback(
    (format: string) => {
      const fmt = normalizeKbExportFormat(format);
      downloadKbExport(fmt, `worktual-kb.${fmt}`, kbExportRows());
      setShowExportForm(false);
      setExportFormat('');
    },
    [downloadKbExport, kbExportRows]
  );

  const handleChatActions = useCallback(
    async (
      actions: Record<string, unknown>[],
      meta: { reply: string; agent: string; userText: string }
    ) => {
      await onCoworkerChatActions?.(actions, meta);
      let reload = false;
      for (const raw of actions) {
        const type = String(raw.type || '').toLowerCase();
        if (type === 'add_kb_category') {
          const rawCat = String(raw.category || raw.name || '').trim();
          const promptOnly = Boolean(raw.prompt) && !rawCat;
          if (rawCat) {
            setActiveTab(rememberCategory(rawCat));
            // Category tab filter only — never treat the name as article search.
            setSearchQuery('');
          }
          setShowManageCategories(true);
          if (!promptOnly) {
            setGuidedKb(false);
            setShowCreateForm(false);
          }
          continue;
        }
        if (type === 'export_kb') {
          const fmt = normalizeKbExportFormat(String(raw.format || 'json'));
          const filename = String(raw.filename || `worktual-kb.${fmt}`);
          const fromAction = Array.isArray(raw.articles)
            ? (raw.articles as Array<Record<string, unknown>>)
            : null;
          const rows =
            fromAction && fromAction.length ? fromAction : kbExportRows();
          downloadKbExport(fmt, filename, rows);
          continue;
        }
        if (type === 'refresh_kb') {
          reload = true;
          continue;
        }
        if (type === 'open_kb') {
          const keepingCreate = actions.some((a) => {
            const t = String(a.type || '').toLowerCase();
            return t === 'create_kb' && !a.done && !a.save && !a.refresh;
          });
          const titleOpen = String(raw.title || raw.query || '').trim();
          const aid = String(raw.id || '').trim();
          if (!keepingCreate) {
            pendingOpenArticleRef.current = aid
              ? { id: aid, title: titleOpen || undefined }
              : titleOpen
                ? { title: titleOpen }
                : null;
            setActiveTab('All');
            setGuidedKb(false);
            setShowCreateForm(false);
            reload = true;
          }
          continue;
        }
        if (type === 'set_filter' && String(raw.module || '').toLowerCase() === 'kb') {
          const q = String(raw.query || raw.title || '').trim();
          setSearchQuery(q);
          const cat = String(raw.category || '').trim();
          if (cat) {
            setActiveTab(rememberCategory(cat));
          } else if (!guidedKb) {
            setActiveTab('All');
          }
          continue;
        }
        if (type !== 'create_kb') continue;
        // Only explicit done/save ends guided create — never `refresh` alone.
        const done = Boolean(raw.done || raw.save);
        const title = String(raw.title || '').trim();
        const category = String(raw.category || '').trim();
        const body = String(raw.body || raw.content || '').trim();
        const step = String(raw.step || raw.awaiting || '')
          .trim()
          .toLowerCase();
        const titleUsable = Boolean(title) && !isPlaceholderKbTitle(title);
        const merged = mergeGuidedDraft(
          'kb',
          {
            title: newTitle,
            category: guidedCategory || newCategory,
            body: newContent,
          },
          raw
        );
        const isStart =
          !done &&
          (!step || step === 'title') &&
          !titleUsable &&
          !body &&
          !category &&
          !String(newTitle || '').trim() &&
          !String(guidedCategory || '').trim() &&
          !String(newContent || '').trim();
        if (isStart) {
          setNewTitle('');
          setGuidedCategory('');
          setNewContent('');
          setNewCategory('General');
        } else {
          const nextTitle = String(merged.fields.title || '').trim();
          const nextCategory = String(merged.fields.category || '').trim();
          const nextBody = String(merged.fields.body || merged.fields.content || '').trim();
          if (nextTitle && !isPlaceholderKbTitle(nextTitle)) setNewTitle(nextTitle);
          if (nextCategory) {
            const remembered = rememberCategory(nextCategory);
            setGuidedCategory(remembered);
            setNewCategory(remembered);
          }
          if (nextBody) setNewContent(nextBody);
        }
        if (done) {
          setGuidedKb(false);
          setGuidedStepIndex(0);
          setShowCreateForm(false);
          const aid = String(raw.id || '').trim();
          const titleDone = String(raw.title || '').trim();
          pendingOpenArticleRef.current = aid
            ? { id: aid, title: titleDone || undefined }
            : titleDone
              ? { title: titleDone }
              : null;
          reload = true;
          continue;
        }
        setShowCreateForm(false);
        setGuidedKb(true);
        setGuidedStepIndex(
          kbStepIndex(
            !titleUsable && isStart ? 'title' : step || merged.awaiting || 'title'
          )
        );
      }
      if (reload) void fetchArticles();
    },
    [
      onCoworkerChatActions,
      rememberCategory,
      kbExportRows,
      downloadKbExport,
      guidedKb,
      newTitle,
      guidedCategory,
      newCategory,
      newContent,
    ]
  );

  const handleChatMessage = useCallback(
    async (raw: string): Promise<string | null> => {
      const text = raw.trim();
      if (onCoworkerMessage) return onCoworkerMessage(text);
      return llmOnlyReply(
        {
          module: 'kb',
          kind: 'unavailable',
          userText: text,
          pageLabel: 'Knowledge Base',
          context: { chatUnavailable: true },
        },
        'Chat is temporarily unavailable. Use New Article on the right, or try again shortly.',
        { message: text, page: 'Knowledge Base', allowAgentsFallback: false }
      );
    },
    [onCoworkerMessage]
  );

  const getChatContext = useCallback(() => {
    if (selectedArticle) {
      return {
        module: 'kb',
        surface: 'detail',
        draft: null,
        entityId: selectedArticle.id,
        focusedEntity: {
          type: 'article' as const,
          id: selectedArticle.id,
          name: selectedArticle.title,
          status: selectedArticle.status,
        },
      };
    }
    if (!guidedKb) {
      if (showCreateForm) {
        return {
          module: 'kb',
          surface: 'create',
          draft: {
            awaiting: isPlaceholderKbTitle(newTitle) ? 'title' : 'body',
            title: isPlaceholderKbTitle(newTitle) ? undefined : newTitle || undefined,
            category: (guidedCategory || newCategory || '').trim() || undefined,
            body: newContent || undefined,
          },
        };
      }
      return {
        module: 'kb',
        surface: 'list',
        draft: null,
      };
    }
    const step = KB_GUIDED_STEPS[guidedStepIndex] || KB_GUIDED_STEPS[0];
    return {
      module: 'kb',
      surface: 'create',
      draft: {
        awaiting: isPlaceholderKbTitle(newTitle) ? 'title' : step.id,
        title: isPlaceholderKbTitle(newTitle) ? undefined : newTitle || undefined,
        category: guidedCategory.trim() || undefined,
        body: newContent || undefined,
      },
    };
  }, [
    guidedKb,
    guidedStepIndex,
    newTitle,
    guidedCategory,
    newCategory,
    newContent,
    showCreateForm,
    selectedArticle,
  ]);

  const deleteConfirmDialog = pendingDeleteId ? (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="kb-delete-title"
      onClick={cancelDeleteArticle}
    >
      <div
        className="w-full max-w-md rounded-2xl border-[0.6px] border-[#bfbfbf] bg-white p-5 shadow-none"
        onClick={(e) => e.stopPropagation()}
      >
        <h3
          id="kb-delete-title"
          className="text-base font-semibold text-neutral-950"
        >
          Delete this article?
        </h3>
        <p className="mt-2 text-sm leading-relaxed text-neutral-600">
          {displayTitle(pendingDeleteTitle)} will be removed from the staff
          knowledge base and the support portal.
        </p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            disabled={deletingArticle}
            onClick={cancelDeleteArticle}
            className="inline-flex h-[38px] items-center rounded-xl border border-neutral-200 bg-white px-4 text-xs font-semibold text-neutral-800 hover:bg-neutral-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={deletingArticle}
            onClick={() => void deleteArticleById(pendingDeleteId)}
            className="inline-flex h-[38px] items-center rounded-xl bg-neutral-950 px-4 text-xs font-semibold text-white hover:bg-neutral-800 disabled:opacity-50"
          >
            {deletingArticle ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  ) : null;

  const listPanel = selectedArticle ? (
    <PageShell id="kb-view-container" embedded={embedded}>
      <div className="@container flex min-w-0 w-full flex-col gap-4 pb-1">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              cancelEditArticle();
              setSelectedArticleId(null);
            }}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-neutral-200 bg-white px-3 text-xs font-semibold text-neutral-800 hover:bg-neutral-50"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Back to articles
          </button>
        </div>
        <article className="w-full min-w-0 rounded-2xl border-[0.6px] border-[#bfbfbf] bg-white p-5 shadow-none sm:p-6">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                featuredTheme(selectedArticle.category).pill
              }`}
            >
              {displayCategoryLabel(selectedArticle.category)}
            </span>
            <KbStatusBadge status={selectedArticle.status} />
            <span className="text-[11px] tabular-nums text-neutral-400">
              {selectedArticle.updatedAt || '—'}
            </span>
            {canMutate && !editingArticle ? (
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={startEditArticle}
                  className="inline-flex h-[38px] items-center gap-1.5 rounded-xl border border-neutral-200 bg-white px-3 text-xs font-semibold text-neutral-800 hover:bg-neutral-50"
                >
                  <Pencil className="h-[18px] w-[18px]" />
                  Edit
                </button>
                <button
                  type="button"
                  disabled={deletingArticle}
                  onClick={() => askDeleteArticle(selectedArticle)}
                  className="inline-flex h-[38px] items-center gap-1.5 rounded-xl border border-neutral-200 bg-white px-3 text-xs font-semibold text-neutral-800 hover:bg-neutral-50 disabled:opacity-50"
                >
                  <Trash2 className="h-[18px] w-[18px]" />
                  Delete
                </button>
              </div>
            ) : null}
          </div>
          {deleteError ? (
            <p className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
              {deleteError}
            </p>
          ) : null}
          {editingArticle ? (
            <div className="mt-4 space-y-3">
              {editError ? (
                <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                  {editError}
                </p>
              ) : null}
              <label className="block">
                <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-neutral-500">
                  Title
                </span>
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="h-[38px] w-full rounded-xl border border-neutral-200 px-3 text-sm text-neutral-950 focus:border-neutral-400 focus:outline-none"
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-neutral-500">
                  Category
                </span>
                <MenuSelect
                  label="Category"
                  value={editCategory}
                  options={[
                    ...(!availableCategories.includes(editCategory) &&
                    editCategory
                      ? [{ value: editCategory, label: displayCategoryLabel(editCategory) }]
                      : []),
                    ...availableCategories.map((name) => ({
                      value: name,
                      label: displayCategoryLabel(name),
                    })),
                  ]}
                  onChange={setEditCategory}
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-neutral-500">
                  Body
                </span>
                <textarea
                  rows={12}
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  className="w-full rounded-xl border border-neutral-200 p-3 text-sm leading-relaxed text-neutral-950 focus:border-neutral-400 focus:outline-none"
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-neutral-500">
                    Replace body from file
                </span>
                <input
                  type="file"
                  accept={KB_EXTRACT_ACCEPT}
                  disabled={extractingPdf || savingEdit}
                  className="block w-full text-xs text-neutral-600 file:mr-3 file:inline-flex file:h-[38px] file:rounded-xl file:border file:border-neutral-200 file:bg-white file:px-3 file:text-xs file:font-semibold file:text-neutral-800"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (!file) return;
                    await extractFileAsBody(file, setEditContent);
                  }}
                />
              </label>
              <div className="flex flex-wrap justify-end gap-2 border-t border-neutral-100 pt-4">
                <button
                  type="button"
                  disabled={savingEdit}
                  onClick={cancelEditArticle}
                  className="inline-flex h-[38px] items-center rounded-xl border border-neutral-200 bg-white px-4 text-xs font-semibold text-neutral-800 hover:bg-neutral-50 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={savingEdit}
                  onClick={() => void handleSaveEditedArticle()}
                  className="inline-flex h-[38px] items-center rounded-xl bg-neutral-950 px-4 text-xs font-semibold text-white hover:bg-neutral-800 disabled:opacity-50"
                >
                  {savingEdit ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          ) : (
            <>
          <h2 className="mt-3 break-words text-xl font-bold tracking-tight text-neutral-950 sm:text-2xl">
            {displayTitle(selectedArticle.title)}
          </h2>
          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-neutral-500">
            <span className="inline-flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-neutral-100 text-[10px] font-bold text-neutral-800">
                {initials(selectedArticle.author)}
              </span>
              <span className="font-medium text-neutral-700">
                {selectedArticle.author || 'Unknown'}
              </span>
            </span>
            <span className="inline-flex items-center gap-1 tabular-nums">
              <Eye className="h-3.5 w-3.5" />
              {(selectedArticle.views || 0).toLocaleString()} views
            </span>
          </div>
          <KbArticleBody content={String(selectedArticle.content || '')} />
          {(selectedArticle.attachments?.length || 0) > 0 && (
            <div className="mt-6 border-t border-neutral-100 pt-4">
              <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-neutral-500">
                Attachments
              </h3>
              <ul className="space-y-1.5">
                {selectedArticle.attachments!.map((url, i) => (
                  <li key={`${url}-${i}`}>
                    <a
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-neutral-800 hover:underline"
                    >
                      <Paperclip className="h-3.5 w-3.5 text-neutral-400" />
                      {fileLabel(url)}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {publishError ? (
            <p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
              {publishError}
            </p>
          ) : null}
          {canMutate && selectedArticle.status === 'Draft' ? (
            <div className="mt-6 flex justify-end border-t border-neutral-100 pt-4">
              <button
                type="button"
                disabled={publishing}
                onClick={() => void handlePublishDraft()}
                className="inline-flex h-[38px] items-center rounded-xl bg-neutral-950 px-4 text-xs font-semibold text-white hover:bg-neutral-800 disabled:opacity-50"
              >
                {publishing ? 'Publishing…' : 'Publish Article'}
              </button>
            </div>
          ) : null}
            </>
          )}
        </article>
      </div>
    </PageShell>
  ) : (
    <PageShell id="kb-view-container" embedded={embedded} fillHeight>
      <div
        ref={kbScrollRef}
        className="@container flex h-full min-h-0 min-w-0 flex-col gap-4 overflow-y-auto overflow-x-hidden pb-1"
      >
        {/* Header */}
        <div className="flex flex-col gap-3 @[480px]:flex-row @[480px]:items-start @[480px]:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <div className="mt-0.5 flex size-[38px] shrink-0 items-center justify-center rounded-xl bg-neutral-950 text-white shadow-none">
              <BookOpen className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-bold tracking-tight text-neutral-950 @[520px]:text-xl">
                Articles
              </h2>
              <p className="mt-0.5 text-xs leading-relaxed text-neutral-500 @[520px]:text-sm">
                Internal guides, refund workflows, and troubleshooting runs
              </p>
            </div>
          </div>
          <div className="flex w-full shrink-0 flex-wrap items-center justify-end gap-1.5 @[480px]:w-auto">
            <button
              type="button"
              onClick={() => {
                setShowExportForm((open) => !open);
                setExportFormat('');
                setShowCreateForm(false);
                setGuidedKb(false);
              }}
              className="inline-flex h-[38px] items-center gap-1.5 rounded-lg border-[0.6px] border-[#bfbfbf] bg-white px-3 text-sm font-medium text-neutral-600 shadow-none hover:text-neutral-900"
            >
              <Download className="size-[18px] stroke-[2.25]" />
              Export
            </button>
            {canMutate ? (
            <button
              id="kb-new-article-btn"
              type="button"
              onClick={openCreate}
                className="inline-flex h-[38px] items-center justify-center gap-1.5 rounded-lg bg-black px-4 text-sm font-semibold text-white shadow-none transition-colors hover:bg-neutral-800"
            >
                <Plus className="size-[18px] stroke-[2.25]" />
              New Article
            </button>
            ) : null}
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-2.5 @[640px]:grid-cols-4">
          <StatCard
            label="Total Articles"
            value={stats.total}
            icon={<BookOpen className="h-4 w-4" />}
            tone="neutral"
          />
          <StatCard
            label="Published"
            value={stats.published}
            icon={<Bookmark className="h-4 w-4" />}
            tone="emerald"
          />
          <StatCard
            label="Drafts"
            value={stats.drafts}
            icon={<FolderOpen className="h-4 w-4" />}
            tone="amber"
          />
          <StatCard
            label="Total Views"
            value={stats.views}
            icon={<Eye className="h-4 w-4" />}
            tone="sky"
          />
        </div>

        <div className="flex flex-wrap items-center gap-1.5 rounded-2xl border-[0.6px] border-[#bfbfbf] bg-neutral-50/80 p-3">
          <label htmlFor="kb-category-filter" className="sr-only">
            Filter by category
          </label>
          <MenuSelect
            id="kb-category-filter"
            label="Filter articles"
            value={activeTab}
            className="w-[11.5rem] shrink-0"
            options={filterTabs.map((tab) => ({
              value: tab,
              label: tab === 'All' ? 'All Articles' : displayCategoryLabel(tab),
            }))}
            onChange={setActiveTab}
          />
          <div
            ref={manageCategoriesRef}
            className="relative flex min-w-0 flex-1 items-center gap-1.5"
          >
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-[18px] -translate-y-1/2 text-neutral-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search title, body, author, or category…"
                aria-label="Search knowledge base"
                className="h-[38px] w-full rounded-lg border-[0.6px] border-[#bfbfbf] bg-white pl-10 pr-10 text-sm text-neutral-900 placeholder:text-neutral-400 shadow-none focus:border-neutral-400 focus:outline-none"
              />
              {searchQuery ? (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  title="Clear search"
                  className="absolute right-2 top-1/2 inline-flex size-[28px] -translate-y-1/2 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-100 hover:text-neutral-800"
                >
                  <X className="size-[16px] stroke-[2.25]" />
                </button>
              ) : null}
          </div>
            <button
              type="button"
              onClick={() => setShowManageCategories((open) => !open)}
              className={`inline-flex h-[38px] shrink-0 items-center gap-1.5 rounded-lg border-[0.6px] px-3 text-sm font-medium shadow-none ${
                showManageCategories
                  ? 'border-[#171717] bg-[#171717] text-white'
                  : 'border-[#bfbfbf] bg-white text-neutral-600 hover:text-neutral-900'
              }`}
            >
              <Layers className="size-[18px] stroke-[2.25]" />
              <span className="hidden @[480px]:inline">Manage Categories</span>
              <span className="@[480px]:hidden">Categories</span>
            </button>
            {showManageCategories ? (
              <div className="absolute right-0 top-full z-20 mt-1.5 w-[min(100%,18rem)] space-y-2 rounded-xl border-[0.6px] border-[#bfbfbf] bg-white p-3 shadow-none">
                <p className="text-sm text-neutral-500">
                  Add a category. It appears in filters once saved; articles keep the label in the database.
                </p>
                <div className="flex items-center gap-1.5">
              <input
                    type="text"
                    value={manageCategoryInput}
                    onChange={(e) => setManageCategoryInput(e.target.value)}
                    placeholder="Category name"
                    className="h-[38px] min-w-0 flex-1 rounded-lg border-[0.6px] border-[#bfbfbf] bg-white px-3 text-sm focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const name = rememberCategory(manageCategoryInput);
                      setManageCategoryInput('');
                      setActiveTab(name);
                      setShowManageCategories(false);
                    }}
                    className="inline-flex h-[38px] shrink-0 items-center rounded-lg bg-[#111111] px-3 text-sm font-semibold text-white hover:bg-neutral-800"
                  >
                    Add
                  </button>
            </div>
            <button
              type="button"
                  onClick={() => {
                    setShowManageCategories(false);
                    setManageCategoryInput('');
                  }}
                  className="text-sm font-medium text-neutral-500 hover:text-neutral-800"
                >
                  Done
            </button>
              </div>
            ) : null}
          </div>
        </div>

        {/* Create */}
        {showCreateForm && (
          <div className="space-y-4 rounded-2xl border-[0.6px] border-[#bfbfbf] bg-white p-5 shadow-none">
            <div className="flex items-center justify-between border-b border-neutral-100 pb-3">
              <h3 className="inline-flex items-center gap-2 text-sm font-semibold text-neutral-950">
                <Sparkles className="h-4 w-4 text-neutral-900" />
                Draft new guide
              </h3>
              <button
                type="button"
                onClick={() => setShowCreateForm(false)}
                className="rounded-lg p-1 text-neutral-400 hover:bg-neutral-50 hover:text-neutral-900"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form
              onSubmit={(e) => void handleCreateArticle(e, 'publish')}
              className="space-y-4 text-xs"
            >
              {createError && (
                <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-rose-700">
                  {createError}
                </p>
              )}
              <SegmentTabs
                ariaLabel="Article source"
                value={sourceMode}
                onChange={setSourceMode}
                options={[
                  { id: 'write', label: 'Write', icon: <FileText /> },
                  { id: 'upload', label: 'Upload', icon: <Upload /> },
                ]}
              />
              <div className="grid grid-cols-1 gap-3 @[520px]:grid-cols-2">
                <div className="@[520px]:col-span-2">
                  <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-neutral-500">
                    Title
                  </label>
                  <input
                    type="text"
                    required
                    minLength={3}
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    placeholder="Clear, searchable title"
                    className="w-full rounded-xl border border-neutral-200 px-3 py-2.5 text-sm focus:border-neutral-400 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-neutral-500">
                    Category
                  </label>
                  {categorySelectMode === 'list' ? (
                  <MenuSelect
                    label="Category"
                    value={
                      availableCategories.includes(newCategory)
                        ? newCategory
                        : '__custom__'
                    }
                    options={[
                      ...availableCategories.map((name) => ({
                        value: name,
                        label: displayCategoryLabel(name),
                      })),
                      { value: '__custom__', label: '+ Add new category…' },
                    ]}
                    onChange={(v) => {
                      if (v === '__custom__') {
                        setCategorySelectMode('custom');
                        setCustomCategoryInput('');
                        return;
                      }
                      setNewCategory(v);
                      setGuidedCategory(v);
                    }}
                  />
                  ) : (
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={customCategoryInput}
                        onChange={(e) => setCustomCategoryInput(e.target.value)}
                        placeholder="New category name"
                        className="min-w-0 flex-1 rounded-xl border border-neutral-200 px-3 py-2.5 text-sm focus:border-neutral-400 focus:outline-none"
                        autoFocus
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const name = rememberCategory(customCategoryInput);
                          setNewCategory(name);
                          setGuidedCategory(name);
                          setCustomCategoryInput('');
                          setCategorySelectMode('list');
                        }}
                        className="shrink-0 rounded-xl bg-neutral-950 px-3 text-xs font-semibold text-white hover:bg-neutral-800"
                      >
                        Add
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setCategorySelectMode('list');
                          setCustomCategoryInput('');
                        }}
                        className="shrink-0 rounded-xl border border-neutral-200 px-2 text-neutral-500 hover:bg-neutral-50"
                        aria-label="Cancel new category"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </div>
                <div>
                  <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-neutral-500">
                    Author
                  </label>
                  <input
                    type="text"
                    required
                    value={newAuthor}
                    onChange={(e) => setNewAuthor(e.target.value)}
                    className="w-full rounded-xl border border-neutral-200 px-3 py-2.5 text-sm focus:outline-none"
                  />
                </div>
                <div className="@[520px]:col-span-2 space-y-2">
                  <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-neutral-500">
                    Body
                  </label>
                  {sourceMode === 'upload' ? (
                    <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-neutral-200 px-4 py-5 hover:border-neutral-400 hover:bg-neutral-50/60">
                      <UploadCloud className="h-5 w-5 text-neutral-400" />
                      <span className="text-xs text-neutral-500">
                        {extractingPdf
                          ? 'Extracting text…'
                          : 'Drop a PDF, DOCX, or text file to extract the article'}
                      </span>
                      <input
                        type="file"
                        accept={KB_EXTRACT_ACCEPT}
                        className="hidden"
                        disabled={extractingPdf || uploading}
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          e.target.value = '';
                          if (!file) return;
                          const ok = await extractFileAsBody(file, setNewContent);
                          if (ok) {
                            const list = new DataTransfer();
                            list.items.add(file);
                            await uploadFiles(list.files);
                          }
                        }}
                      />
                    </label>
                  ) : null}
                  <textarea
                    required={sourceMode === 'write'}
                    minLength={10}
                    rows={5}
                    value={newContent}
                    onChange={(e) => setNewContent(e.target.value)}
                    placeholder={
                      sourceMode === 'upload'
                        ? 'Extracted file text appears here. You can edit it before saving.'
                        : 'Steps, notes, and resolution details…'
                    }
                    className="w-full rounded-xl border border-neutral-200 p-3 text-sm leading-relaxed focus:outline-none"
                  />
                </div>
                <div className="@[520px]:col-span-2 space-y-2">
                  <label className="mb-0.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-neutral-500">
                    <Paperclip className="h-3 w-3" />
                    Attachments
                  </label>
                  <p className="text-[11px] text-neutral-400">
                    Add docs, text, images, or spreadsheets (max 15MB each).
                  </p>
                  <label
                    onDragEnter={(e) => {
                      e.preventDefault();
                      setDragActive(true);
                    }}
                    onDragLeave={(e) => {
                      e.preventDefault();
                      setDragActive(false);
                    }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={async (e) => {
                      e.preventDefault();
                      setDragActive(false);
                      await uploadFiles(e.dataTransfer.files);
                    }}
                    className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-5 transition-colors ${
                      dragActive
                        ? 'border-neutral-900 bg-neutral-50'
                        : 'border-neutral-200 hover:border-neutral-400 hover:bg-neutral-50/60'
                    }`}
                  >
                    <UploadCloud className="h-5 w-5 text-neutral-400" />
                    <span className="text-xs text-neutral-500">
                      {uploading
                        ? 'Uploading…'
                        : 'Drop files here or click to browse'}
                    </span>
                    <span className="text-[10px] text-neutral-400">
                      TXT, MD, PDF, DOC, DOCX, images, XLS, CSV…
                    </span>
                    <input
                      type="file"
                      multiple
                      accept={KB_FILE_ACCEPT}
                      className="hidden"
                      disabled={uploading}
                      onChange={async (e) => {
                        await uploadFiles(e.target.files);
                        e.target.value = '';
                      }}
                    />
                  </label>
                  {attachments.length > 0 && (
                    <ul className="space-y-1.5">
                      {attachments.map((url, i) => (
                        <li
                          key={`${url}-${i}`}
                          className="flex items-center justify-between gap-2 rounded-lg border border-neutral-100 bg-neutral-50/80 px-2.5 py-1.5 text-xs"
                        >
                          <a
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                            className="flex min-w-0 items-center gap-1.5 text-neutral-700 hover:text-neutral-950"
                          >
                            <File className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
                            <span className="truncate">{fileLabel(url)}</span>
                          </a>
                          <button
                            type="button"
                            onClick={() =>
                              setAttachments((prev) =>
                                prev.filter((_, idx) => idx !== i)
                              )
                            }
                            className="shrink-0 text-neutral-400 hover:text-rose-600"
                            aria-label="Remove file"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowCreateForm(false)}
                  className="inline-flex h-[38px] items-center rounded-xl border border-neutral-200 bg-white px-4 text-xs font-semibold text-neutral-700 hover:bg-neutral-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={publishing}
                  onClick={() => void handleCreateArticle(undefined, 'draft')}
                  className="inline-flex h-[38px] items-center rounded-xl border border-neutral-200 bg-white px-4 text-xs font-semibold text-neutral-800 hover:bg-neutral-50 disabled:opacity-50"
                >
                  {createAction === 'draft' ? 'Saving…' : 'Draft Article'}
                </button>
                <button
                  type="submit"
                  disabled={publishing}
                  className="inline-flex h-[38px] items-center rounded-xl bg-neutral-950 px-4 text-xs font-semibold text-white hover:bg-neutral-800 disabled:opacity-50"
                >
                  {createAction === 'publish' ? 'Publishing…' : 'Publish Article'}
                </button>
              </div>
            </form>
          </div>
        )}

        {showExportForm && (
          <div className="space-y-3 rounded-2xl border-[0.6px] border-[#bfbfbf] bg-white p-5 shadow-none">
            <div className="flex items-center justify-between border-b border-neutral-100 pb-3">
              <h3 className="inline-flex items-center gap-2 text-sm font-semibold text-neutral-950">
                <Download className="h-4 w-4 text-neutral-900" />
                Export articles
              </h3>
              <button
                type="button"
                onClick={() => {
                  setShowExportForm(false);
                  setExportFormat('');
                }}
                className="rounded-lg p-1 text-neutral-400 hover:bg-neutral-50 hover:text-neutral-900"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="text-xs text-neutral-500">
              Choose a file format, then download{' '}
              {articles.length === 1
                ? '1 article'
                : `${articles.length} articles`}
              . Nothing is downloaded until you pick a format and confirm.
            </p>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {KB_EXPORT_FORMATS.map((opt) => {
                const selected = exportFormat === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setExportFormat(opt.value)}
                    className={`flex min-h-[38px] flex-col items-start rounded-xl border-[0.6px] px-3 py-2 text-left shadow-none ${
                      selected
                        ? 'border-neutral-950 bg-neutral-950 text-white'
                        : 'border-[#bfbfbf] bg-white text-neutral-800 hover:bg-neutral-50'
                    }`}
                  >
                    <span className="text-sm font-semibold">{opt.label}</span>
                    <span
                      className={`text-[11px] leading-snug ${
                        selected ? 'text-white/70' : 'text-neutral-500'
                      }`}
                    >
                      {opt.detail}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowExportForm(false);
                  setExportFormat('');
                }}
                className="h-[38px] rounded-xl border-[0.6px] border-[#bfbfbf] bg-white px-4 text-xs font-semibold text-neutral-700"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!exportFormat || articles.length === 0}
                onClick={() => {
                  if (!exportFormat) return;
                  runKbExport(exportFormat);
                }}
                className="inline-flex h-[38px] items-center gap-1.5 rounded-xl bg-neutral-950 px-4 text-xs font-semibold text-white hover:bg-neutral-800 disabled:opacity-50"
              >
                <Download className="size-[18px] stroke-[2.25]" />
                Download
              </button>
            </div>
          </div>
        )}

        <div className="relative z-10 flex min-h-0 min-w-0 flex-1 flex-col gap-4">
            {/* Featured */}
            <section
              ref={featuredSectionRef}
              className="relative z-10 min-w-0"
            >
              <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="inline-flex items-center gap-1.5 text-sm font-semibold text-neutral-900">
                    <Star className="h-3.5 w-3.5 text-amber-500 fill-amber-500" />
                    {showAllGuides ? 'All Guides' : 'Featured Guides'}
                  </h3>
                  <p className="mt-0.5 text-sm text-neutral-500">
                    {showAllGuides
                      ? `${filteredArticles.length} guide${filteredArticles.length === 1 ? '' : 's'} in your knowledge base`
                      : 'Top guides your team opens most'}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                  <label className="inline-flex h-[38px] items-center gap-1.5 text-sm text-neutral-500">
                    Show:
                  <MenuSelect
                    label="Sort articles"
                    value={sortBy}
                    className="min-w-[10rem]"
                    options={[
                      { value: 'latest', label: 'Latest' },
                      { value: 'views', label: 'Most viewed' },
                      { value: 'published', label: 'Published' },
                      { value: 'draft', label: 'Draft' },
                    ]}
                    onChange={(v) =>
                      setSortBy(
                        v as 'latest' | 'views' | 'published' | 'draft'
                      )
                    }
                  />
                </label>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      viewAllArticles();
                    }}
                    className="relative z-20 inline-flex h-[38px] shrink-0 cursor-pointer items-center rounded-lg px-3 text-sm font-semibold text-neutral-900 hover:bg-neutral-100 hover:text-neutral-950"
                  >
                    {showAllGuides ? 'Show featured' : 'View all →'}
                  </button>
                </div>
              </div>

              {deleteError && !selectedArticle ? (
                <p className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                  {deleteError}
                </p>
              ) : null}
              {loading ? (
                <div className="grid grid-cols-1 gap-3 @[520px]:grid-cols-2 @[720px]:grid-cols-3">
                  {[0, 1, 2, 3, 4, 5].map((i) => (
                    <div
                      key={i}
                      className="h-52 animate-pulse rounded-2xl border border-neutral-200 bg-neutral-50"
                    />
                  ))}
                </div>
              ) : featuredArticles.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-neutral-200 bg-neutral-50/60 px-4 py-10 text-center text-sm text-neutral-500">
                  No featured guides yet. Publish an article to populate this shelf.
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3 @[520px]:grid-cols-2 @[720px]:grid-cols-3">
                  {featuredArticles.map((art) => (
                    <div key={art.id} className="min-w-0 h-full">
                      <FeaturedCard
                        article={art}
                        layout="tile"
                        onOpen={() => setSelectedArticleId(art.id)}
                      />
                              </div>
                                  ))}
                                </div>
                              )}
            </section>
                            </div>
                          </div>
    </PageShell>
  );

  if (onCoworkerMessage || onCoworkerChatActions) {
                          return (
      <CoworkerSplitWorkspace
        pageLabel="Knowledge Base"
        contentTitle={guidedKb ? 'Next steps' : 'Articles'}
        placeholder="e.g. create article, search billing guides"
        suggestionChips={
          guidedKb
            ? guidedStepIndex >= KB_GUIDED_STEPS.length - 1
              ? ['confirm', 'cancel']
              : ['cancel']
            : canMutate
              ? [
                  'create article',
                  'add category',
                  'export articles',
                  'list articles',
                ]
              : ['list articles', 'export articles', 'search KB']
        }
        getChatContext={getChatContext}
        onUserMessage={handleChatMessage}
        onChatActions={handleChatActions}
        onAgentRoute={onAgentRoute}
        module="kb"
        surface={
          guidedKb || showCreateForm
            ? 'create'
            : selectedArticle
              ? 'detail'
              : 'list'
        }
        onDraftPatch={(patch) => {
          void handleChatActions(
            [{ type: 'create_kb', ...patch }],
            { reply: '', agent: 'kb', userText: '' }
          );
        }}
        contentHeaderActions={
          guidedKb ? (
                      <button
                        type="button"
              onClick={openCreate}
              className="inline-flex items-center h-8 px-2.5 rounded-lg border border-neutral-200 bg-white text-xs font-semibold text-neutral-800 hover:bg-neutral-50"
                      >
              Use form
                      </button>
          ) : null
        }
      >
        {guidedKb ? (
          <GuidedKbPreview
            draft={{
              title: newTitle,
              category: guidedCategory || newCategory,
              body: newContent,
            }}
            stepIndex={guidedStepIndex}
            publishing={publishing}
            action={createAction}
            onCancel={cancelGuidedKb}
            onUseForm={openCreate}
            onSaveDraft={() => {
              void handleCreateArticle(undefined, 'draft');
            }}
            onConfirmCreate={() => {
              void handleCreateArticle(undefined, 'publish');
            }}
          />
        ) : (
          listPanel
        )}
        {deleteConfirmDialog}
      </CoworkerSplitWorkspace>
    );
  }

  return (
    <>
      {listPanel}
      {deleteConfirmDialog}
    </>
  );
}

function StatCard({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  tone: 'neutral' | 'emerald' | 'amber' | 'sky';
}) {
  const tones = {
    neutral: 'bg-neutral-100 text-neutral-700',
    emerald: 'bg-neutral-100 text-neutral-700',
    amber: 'bg-neutral-100 text-neutral-700',
    sky: 'bg-neutral-100 text-neutral-700',
  };
  return (
    <div className="rounded-2xl border-[0.6px] border-[#bfbfbf] bg-white p-3.5 shadow-none">
      <div className="flex items-start justify-between gap-2">
        <div
          className={`flex h-8 w-8 items-center justify-center rounded-lg ${tones[tone]}`}
        >
          {icon}
        </div>
      </div>
      <div className="mt-3 text-2xl font-bold tabular-nums tracking-tight text-neutral-950">
        {value.toLocaleString()}
      </div>
      <div className="mt-0.5 text-[11px] font-medium text-neutral-500">{label}</div>
    </div>
  );
}

function featuredTheme(category: string) {
  switch (category) {
    case 'Troubleshooting':
      return {
        wash: 'from-sky-100 via-sky-50 to-white',
        pill: 'bg-sky-50 text-sky-700 border-sky-200/70',
        accent: '#38bdf8',
        soft: '#e0f2fe',
        ink: '#0369a1',
      };
    case 'Accounts':
      return {
        wash: 'from-emerald-100 via-emerald-50 to-white',
        pill: 'bg-emerald-50 text-emerald-700 border-emerald-200/70',
        accent: '#34d399',
        soft: '#d1fae5',
        ink: '#047857',
      };
    case 'Billing':
      return {
        wash: 'from-indigo-100 via-indigo-50 to-white',
        pill: 'bg-indigo-50 text-indigo-700 border-indigo-200/70',
        accent: '#818cf8',
        soft: '#e0e7ff',
        ink: '#4338ca',
      };
    default:
      return {
        wash: 'from-violet-100 via-violet-50 to-white',
        pill: 'bg-violet-50 text-violet-700 border-violet-200/70',
        accent: '#a78bfa',
        soft: '#ede9fe',
        ink: '#6d28d9',
      };
  }
}

function FeatureIllustration({ category }: { category: string }) {
  const t = featuredTheme(category);
  if (category === 'Troubleshooting') {
    return (
      <svg viewBox="0 0 160 100" className="h-full w-full" aria-hidden>
        <rect x="28" y="18" width="104" height="64" rx="10" fill="#fff" stroke={t.accent} strokeWidth="2" />
        <rect x="36" y="28" width="88" height="40" rx="4" fill={t.soft} />
        <circle cx="80" cy="48" r="12" fill="#fdba74" />
        <path d="M80 42v8M80 54.5v1" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" />
        <rect x="58" y="82" width="44" height="6" rx="3" fill={t.accent} opacity="0.35" />
      </svg>
    );
  }
  if (category === 'Accounts') {
    return (
      <svg viewBox="0 0 160 100" className="h-full w-full" aria-hidden>
        <rect x="36" y="16" width="88" height="68" rx="12" fill="#fff" stroke={t.accent} strokeWidth="2" />
        <circle cx="80" cy="40" r="14" fill={t.soft} stroke={t.accent} strokeWidth="2" />
        <circle cx="80" cy="36" r="6" fill={t.accent} />
        <path d="M68 48c0-6.6 5.4-10 12-10s12 3.4 12 10" fill={t.accent} />
        <rect x="52" y="62" width="56" height="8" rx="4" fill={t.soft} />
        <rect x="60" y="74" width="40" height="5" rx="2.5" fill={t.accent} opacity="0.4" />
      </svg>
    );
  }
  // General / Billing — document / checklist card
  return (
    <svg viewBox="0 0 160 100" className="h-full w-full" aria-hidden>
      <rect x="40" y="12" width="80" height="76" rx="10" fill="#fff" stroke={t.accent} strokeWidth="2" />
      <rect x="52" y="26" width="40" height="6" rx="3" fill={t.soft} />
      <rect x="52" y="38" width="56" height="5" rx="2.5" fill={t.accent} opacity="0.35" />
      <rect x="52" y="48" width="48" height="5" rx="2.5" fill={t.accent} opacity="0.25" />
      <rect x="52" y="58" width="52" height="5" rx="2.5" fill={t.accent} opacity="0.2" />
      <circle cx="108" cy="72" r="14" fill={t.soft} stroke={t.accent} strokeWidth="2" />
      <path
        d="M102 72l4 4 8-9"
        fill="none"
        stroke={t.ink}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

type FeaturedCardProps = {
  article: KBArticle;
  layout?: 'tile' | 'spotlight';
  onOpen?: () => void;
};

function KbStatusBadge({ status }: { status: KBArticle['status'] }) {
  const isDraft = status === 'Draft';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
        isDraft
          ? 'border-amber-200/80 bg-amber-50 text-amber-800'
          : 'border-emerald-200/80 bg-emerald-50 text-emerald-800'
      }`}
    >
      {isDraft ? (
        <>
          <FilePenLine className="h-3 w-3 shrink-0" aria-hidden />
          Draft
        </>
      ) : (
        <>
          <CheckCircle2 className="h-3 w-3 shrink-0" aria-hidden />
          Published
        </>
      )}
    </span>
  );
}

function FeaturedCard({
  article,
  layout = 'tile',
  onOpen,
}: FeaturedCardProps): React.ReactElement {
  const theme = featuredTheme(article.category);
  const spotlight = layout === 'spotlight';

  return (
    <article
      role={onOpen ? 'button' : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (!onOpen) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      className={`group min-w-0 overflow-hidden rounded-2xl border-[0.6px] border-[#bfbfbf] bg-white shadow-none transition-all hover:border-neutral-400 h-full ${
        onOpen ? 'cursor-pointer' : ''
      } ${
        spotlight
          ? 'flex flex-col @[480px]:flex-row @[480px]:min-h-[168px]'
          : 'flex flex-col'
      }`}
    >
      <div
        className={`relative overflow-hidden bg-gradient-to-br ${theme.wash} ${
          spotlight
            ? 'h-[120px] w-full shrink-0 @[480px]:h-auto @[480px]:w-[42%] @[480px]:max-w-[240px]'
            : 'h-[120px] shrink-0'
        }`}
      >
        <div
          className={`absolute inset-0 ${
            spotlight
              ? 'inset-x-3 top-2 bottom-2 @[480px]:inset-4'
              : 'inset-x-4 bottom-0 top-3'
          }`}
        >
          <FeatureIllustration category={article.category} />
        </div>
      </div>

      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col gap-1.5 px-4 pb-4 pt-3.5">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${theme.pill}`}
          >
            {displayCategoryLabel(article.category)}
          </span>
          <KbStatusBadge status={article.status} />
          <span className="text-[10px] font-medium tabular-nums text-neutral-400">
            {article.updatedAt || '—'}
          </span>
        </div>

        <h4
          className={`pr-6 font-bold leading-snug text-neutral-950 line-clamp-2 ${
            spotlight ? 'text-base @[480px]:text-lg' : 'text-[15px]'
          }`}
        >
          {displayTitle(article.title)}
        </h4>
        <p
          className={`text-[12px] leading-relaxed text-neutral-500 ${
            spotlight ? 'line-clamp-3 max-w-xl' : 'line-clamp-2'
          }`}
        >
          {displayExcerpt(article.content, spotlight ? 160 : 100)}
        </p>

        <div className="mt-auto flex items-center justify-between gap-2 border-t border-neutral-100 pt-3 text-[11px]">
          <span className="inline-flex min-w-0 items-center gap-2">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-[10px] font-bold text-neutral-800">
              {initials(article.author)}
            </span>
            <span className="truncate font-medium text-neutral-600">
              {article.author || 'Unknown'}
            </span>
          </span>
          <span className="inline-flex shrink-0 items-center gap-2 tabular-nums text-neutral-400">
            {(article.attachments?.length || 0) > 0 && (
              <span className="inline-flex items-center gap-0.5">
                <Paperclip className="h-3.5 w-3.5" />
                {article.attachments!.length}
              </span>
            )}
            <span className="inline-flex items-center gap-1">
              <Eye className="h-3.5 w-3.5" />
              {(article.views || 0).toLocaleString()} views
            </span>
          </span>
        </div>
      </div>
    </article>
  );
}
