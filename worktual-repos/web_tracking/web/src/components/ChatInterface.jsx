import { useCallback, useEffect, useImperativeHandle, useRef, useState, forwardRef } from 'react';
import { useAuth } from '../AuthContext';
import { resetChatSession, sendChatMessage } from '../api';
import ChatMessage from '../chat/ChatMessage';
import {
  EMBEDDED_WELCOME_MESSAGE,
  WELCOME_MESSAGE,
  POLITE_TRY_AGAIN,
  POLITE_SESSION_EXPIRED,
  POLITE_NO_DOMAIN,
  assistantMessage,
} from '../chat/constants';
import { getAnalyticsPeriod } from '../chat/analyticsPeriod';
import {
  getOrCreateChatSessionId,
  loadStoredMessages,
  rotateChatSessionId,
  saveStoredMessages,
} from '../chat/session';

const ChatInterface = forwardRef(function ChatInterface(
  {
    mode = 'fullPage',
    showSuggestions = true,
    suppressWelcome = false,
    embeddedPlaceholder,
    onRefresh,
  },
  ref,
) {
  const isEmbedded = mode === 'embedded' || mode === 'overlay';
  const isFullPage = mode === 'fullPage' || mode === 'overlay';
  const isInteractive = isEmbedded || isFullPage;
  const showSuggestionChips = showSuggestions && !isEmbedded;

  const { user } = useAuth();
  const defaultWelcome = isEmbedded ? EMBEDDED_WELCOME_MESSAGE : WELCOME_MESSAGE;

  function initialMessages() {
    const stored = loadStoredMessages();
    if (stored?.length) {
      return stored.map((m) => ({
        ...m,
        suggestions: isEmbedded ? [] : showSuggestions ? m.suggestions : [],
      }));
    }
    if (suppressWelcome) return [];
    return [isEmbedded ? EMBEDDED_WELCOME_MESSAGE : defaultWelcome];
  }

  const [chatSessionId, setChatSessionId] = useState(() => getOrCreateChatSessionId());
  const [messages, setMessages] = useState(initialMessages);
  const [input, setInput] = useState('');
  const [waiting, setWaiting] = useState(false);
  const inputRef = useRef(null);
  const messagesEndRef = useRef(null);
  const messagesScrollRef = useRef(null);

  useEffect(() => {
    saveStoredMessages(messages);
  }, [messages]);

  const focusInput = useCallback(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const appendMessage = useCallback((msg) => {
    setMessages((prev) => [...prev, { id: `${Date.now()}-${prev.length}`, ...msg }]);
  }, []);

  const setTyping = useCallback((on) => {
    setMessages((prev) => {
      const base = prev.filter((m) => m.role !== 'typing');
      return on ? [...base, { id: 'typing', role: 'typing' }] : base;
    });
  }, []);

  const resetSession = useCallback(() => {
    resetChatSession(chatSessionId).catch(() => {});
    const newId = rotateChatSessionId();
    setChatSessionId(newId);
    setWaiting(false);
    setMessages(suppressWelcome ? [] : [isEmbedded ? EMBEDDED_WELCOME_MESSAGE : defaultWelcome]);
    focusInput();
  }, [chatSessionId, defaultWelcome, focusInput, isEmbedded, suppressWelcome]);

  useImperativeHandle(ref, () => ({
    resetSession,
    clearConversation: resetSession,
    focusInput,
  }));

  useEffect(() => {
    if (isInteractive) focusInput();
  }, [isInteractive, focusInput]);

  useEffect(() => {
    const container = messagesScrollRef.current;
    if (!container || !messagesEndRef.current) return;

    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    const nearBottom = distanceFromBottom < 80;

    messagesEndRef.current.scrollIntoView({
      behavior: nearBottom ? 'smooth' : 'auto',
      block: 'end',
    });
  }, [messages]);

  const sendMessage = useCallback(
    async (rawText) => {
      const query = (rawText ?? input).trim();
      if (!query || waiting) return;

      appendMessage({ role: 'user', text: query });
      setInput('');
      focusInput();

      if (!user?.website_id) {
        appendMessage(assistantMessage(POLITE_NO_DOMAIN));
        return;
      }

      setWaiting(true);
      setTyping(true);

      try {
        const data = await sendChatMessage(query, chatSessionId, getAnalyticsPeriod());
        appendMessage({
          role: 'assistant',
          text: data.answer || 'Done.',
          widgets: data.dashboard?.widgets || [],
          suggestions: showSuggestionChips ? data.suggested_questions || [] : [],
        });
        focusInput();
      } catch (err) {
        const status = err?.response?.status;
        appendMessage(
          assistantMessage(
            status === 401 ? POLITE_SESSION_EXPIRED : POLITE_TRY_AGAIN,
            [],
          ),
        );
      } finally {
        setWaiting(false);
        setTyping(false);
      }
    },
    [
      appendMessage,
      chatSessionId,
      focusInput,
      input,
      setTyping,
      showSuggestionChips,
      user?.website_id,
      waiting,
    ],
  );

  const handleRefresh = () => {
    resetSession();
    onRefresh?.();
  };

  const shellClass =
    mode === 'overlay'
      ? 'chat-embedded-shell chat-embedded-shell-overlay'
      : isEmbedded
        ? 'chat-embedded-shell'
        : 'chat-page-shell';

  const panelClass =
    mode === 'overlay'
      ? 'chat-embedded-panel chat-embedded-panel-overlay'
      : isEmbedded
        ? 'chat-embedded-panel'
        : 'chat-page-panel';

  return (
    <div className={shellClass}>
      <div className={panelClass}>
        {isInteractive && (
          <div className="chat-messages-area chat-messages-area-embedded">
            <div ref={messagesScrollRef} className="chat-messages chat-messages-full chat-messages-embedded">
              {messages.map((m) => (
                <ChatMessage
                  key={m.id}
                  message={m}
                  onSuggestionClick={sendMessage}
                  showSuggestions={showSuggestionChips}
                  embedded={isEmbedded}
                />
              ))}
              <div ref={messagesEndRef} />
            </div>
          </div>
        )}

        <div className={`chat-input-row ${isInteractive ? 'chat-input-row-full chat-input-row-embedded' : ''}`}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
              }
            }}
            placeholder={
              waiting
                ? 'Type your next question while I work…'
                : embeddedPlaceholder
                  || (isEmbedded
                    ? 'Ask about visitors, traffic, sessions, or reports…'
                    : 'Ask about visitors, sessions, traffic sources, page views...')
            }
            rows={isEmbedded ? 1 : 2}
          />
          <button
            type="button"
            className="btn btn-black chat-send-btn chat-send-btn-icon"
            onClick={() => sendMessage()}
            disabled={waiting || !input.trim()}
            aria-label={waiting ? 'Working' : 'Send'}
          >
            {waiting ? (
              '…'
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M12 19V5M5 12l7-7 7 7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </button>
        </div>

        {isEmbedded && (
          <button
            type="button"
            className="chat-embedded-refresh sr-only-action"
            onClick={handleRefresh}
            aria-hidden="true"
            tabIndex={-1}
          />
        )}
      </div>
    </div>
  );
});

export default ChatInterface;
