import AssistantMarkdown from './AssistantMarkdown';
import { humanizeColumn, idCellClass, formatDisplayValue } from './tableUtils';
import { filterChatWidgets } from './widgetFilters';

function formatCell(column, value) {
  const display = formatDisplayValue(column, value);
  if (display != null) return display;
  if (value == null || value === '') return '—';
  const col = String(column || '').toLowerCase();
  if (typeof value === 'number' && col.includes('minute')) {
    return Number(value.toFixed(1));
  }
  const text = String(value);
  const isDateCol = /seen|date|time|_at$/.test(col);
  const looksIso = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(text);
  if (isDateCol || looksIso) {
    const d = new Date(text);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    }
  }
  return text;
}

function ChartWidget({ widget }) {
  if (!widget) return null;

  if (widget.type === 'metric') {
    return (
      <div className="chat-widget chat-widget-metric">
        <div className="chat-widget-title">{widget.title}</div>
        <div className="chat-widget-value">{widget.value}</div>
      </div>
    );
  }

  if (widget.type === 'table') {
    const showTitle = widget.title && widget.title !== 'Results';
    return (
      <div className="chat-widget chat-widget-table chat-widget-table--compact">
        {showTitle ? <div className="chat-widget-title">{widget.title}</div> : null}
        <div className="table-wrap chat-table-wrap">
          <table className="chat-data-table">
            <thead>
              <tr>{widget.columns?.map((c) => <th key={c}>{humanizeColumn(c)}</th>)}</tr>
            </thead>
            <tbody>
              {widget.rows?.slice(0, 20).map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <td key={j} className={idCellClass(widget.columns?.[j])}>
                      {formatCell(widget.columns?.[j], cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (['bar_chart', 'line_chart', 'pie_chart'].includes(widget.type)) {
    const labels = widget.x || widget.labels || [];
    const values = widget.y || widget.values || [];
    const max = Math.max(...values.map((v) => Number(v) || 0), 1);
    return (
      <div className="chat-widget chat-widget-chart">
        <div className="chat-widget-title">{widget.title}</div>
        <ul className="chat-bar-chart">
          {labels.slice(0, 12).map((label, i) => (
            <li key={i}>
              <span className="chat-bar-label">{String(label)}</span>
              <div className="chat-bar-track">
                <div className="chat-bar-fill" style={{ width: `${((Number(values[i]) || 0) / max) * 100}%` }} />
              </div>
              <strong>{String(values[i] ?? '—')}</strong>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return null;
}

export default function ChatMessage({ message, onSuggestionClick, showSuggestions = true, embedded = false }) {
  if (message.role === 'typing') {
    return (
      <div className={`chat-bubble-row chat-bubble-row-assistant${embedded ? ' chat-bubble-row-embedded' : ''}`}>
        {!embedded && <div className="chat-avatar chat-avatar-ai">AI</div>}
        <div className="chat-bubble chat-bubble-assistant chat-bubble-typing">
          <span className="chat-typing-dot" />
          <span className="chat-typing-dot" />
          <span className="chat-typing-dot" />
          <span className="chat-typing-label">Thinking...</span>
        </div>
      </div>
    );
  }

  const isUser = message.role === 'user';
  const widgets = filterChatWidgets(message.widgets, {
    embedded,
    messageText: message.text,
  });

  return (
    <div className={`chat-bubble-row ${isUser ? 'chat-bubble-row-user' : 'chat-bubble-row-assistant'}${embedded ? ' chat-bubble-row-embedded' : ''}`}>
      {!isUser && !embedded && <div className="chat-avatar chat-avatar-ai">AI</div>}
      <div className={`chat-bubble ${isUser ? 'chat-bubble-user' : 'chat-bubble-assistant'}`}>
        {message.text && (
          isUser
            ? <p>{message.text}</p>
            : <AssistantMarkdown text={message.text} />
        )}
        {widgets.length > 0 && (
          <div className="chat-widgets">
            {widgets.map((w, i) => <ChartWidget key={i} widget={w} />)}
          </div>
        )}
        {showSuggestions && message.suggestions?.length > 0 && (
          <div className="chat-suggestions">
            {message.suggestions.map((s) => (
              <button key={s} type="button" className="chat-suggestion-chip" onClick={() => onSuggestionClick(s)}>
                {s}
              </button>
            ))}
          </div>
        )}
      </div>
      {isUser && !embedded && <div className="chat-avatar chat-avatar-user">You</div>}
    </div>
  );
}
