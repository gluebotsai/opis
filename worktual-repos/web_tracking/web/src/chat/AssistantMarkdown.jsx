import { humanizeColumn, idCellClass } from './tableUtils';

/** Render assistant markdown: paragraphs, tables, ordered/unordered lists. */

function parseTableBlock(lines) {
  if (lines.length < 2) return null;
  const headerCells = lines[0].split('|').map((c) => c.trim()).filter(Boolean);
  const sep = lines[1];
  if (!/^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?$/.test(sep.replace(/\s/g, ''))) {
    return null;
  }
  const rows = lines.slice(2).map((line) =>
    line.split('|').map((c) => c.trim()).filter(Boolean),
  ).filter((row) => row.length > 0);
  return { headerCells, rows };
}

function renderInline(text) {
  const parts = String(text || '').split(/(\*\*.+?\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    return part;
  });
}

function MarkdownBlock({ block }) {
  if (block.type === 'paragraph') {
    return <p>{renderInline(block.text)}</p>;
  }

  if (block.type === 'table') {
    const { headerCells, rows } = block;
    return (
      <div className="chat-md-table-wrap chat-table-wrap">
        <table className="chat-md-table chat-data-table">
          <thead>
            <tr>{headerCells.map((c) => <th key={c}>{humanizeColumn(c)}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                {row.map((cell, j) => (
                  <td key={j} className={idCellClass(headerCells[j])}>
                    {renderInline(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (block.type === 'ol') {
    return (
      <ol className="chat-md-list chat-md-list-ordered">
        {block.items.map((item, i) => (
          <li key={i}>{renderInline(item)}</li>
        ))}
      </ol>
    );
  }

  if (block.type === 'ul') {
    return (
      <ul className="chat-md-list chat-md-list-unordered">
        {block.items.map((item, i) => (
          <li key={i}>{renderInline(item)}</li>
        ))}
      </ul>
    );
  }

  return null;
}

export function parseAssistantMarkdown(text) {
  if (!text) return [];

  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    if (trimmed.includes('|') && i + 1 < lines.length && lines[i + 1].includes('-')) {
      const tableLines = [];
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) {
        tableLines.push(lines[i].trim());
        i += 1;
      }
      const table = parseTableBlock(tableLines);
      if (table) {
        blocks.push({ type: 'table', ...table });
        continue;
      }
      i -= tableLines.length;
    }

    if (/^\d+\.\s/.test(trimmed)) {
      const items = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s*/, ''));
        i += 1;
      }
      blocks.push({ type: 'ol', items });
      continue;
    }

    if (/^[-*]\s/.test(trimmed)) {
      const items = [];
      while (i < lines.length && /^[-*]\s/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*]\s*/, ''));
        i += 1;
      }
      blocks.push({ type: 'ul', items });
      continue;
    }

    const paraLines = [];
    while (i < lines.length && lines[i].trim() && !lines[i].includes('|') && !/^\d+\.\s/.test(lines[i].trim()) && !/^[-*]\s/.test(lines[i].trim())) {
      paraLines.push(lines[i].trim());
      i += 1;
    }
    blocks.push({ type: 'paragraph', text: paraLines.join(' ') });
  }

  return blocks;
}

export default function AssistantMarkdown({ text }) {
  const blocks = parseAssistantMarkdown(text);
  if (!blocks.length) return null;

  return (
    <div className="chat-md">
      {blocks.map((block, i) => (
        <MarkdownBlock key={i} block={block} />
      ))}
    </div>
  );
}
