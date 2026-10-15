/** Co-worker embedded chat: avoid redundant KPI boxes; prefer prose + markdown tables. */

export function hasMarkdownTable(text) {
  return /\n\|[^\n]+\|\n\|[-| :]+\|/.test(String(text || ''));
}

export function filterChatWidgets(widgets, { embedded = false, messageText = '' } = {}) {
  if (!widgets?.length) return [];

  return widgets.filter((w) => {
    if (!w) return false;
    if (w.type === 'metric') return false;

    if (embedded) {
      if (w.type === 'table') {
        const rowCount = w.rows?.length ?? 0;
        if (rowCount <= 1) return false;
        if (hasMarkdownTable(messageText)) return false;
      }
      if (['bar_chart', 'line_chart', 'pie_chart'].includes(w.type)) {
        return (w.x?.length ?? w.labels?.length ?? 0) > 3;
      }
    }

    return true;
  });
}
