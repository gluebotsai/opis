/**
 * WebSocket chat hook — simple protocol:
 *
 *   Browser → Server:  { type: "message", message: "..." }
 *   Browser → Server:  { type: "ping" }
 *   Browser → Server:  { type: "reset_session" }
 *   Server → Browser:  { type: "connected", payload: { session_id, history } }
 *   Server → Browser:  { type: "session_reset" }
 *   Server → Browser:  { type: "thinking" }
 *   Server → Browser:  { type: "answer", message, payload: { answer, dashboard, suggested_questions } }
 *   Server → Browser:  { type: "error", message }
 *   Server → Browser:  { type: "pong" }
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { getStoredToken, isTokenExpired } from '../authStorage';

function chatPort() {
  return String(import.meta.env.VITE_AI_CHAT_PORT || import.meta.env.AI_CHAT_PORT || '7863').trim();
}

function getChatWsBase() {
  const configured = (import.meta.env.VITE_AI_CHAT_WS_URL || '').trim();
  if (configured) return configured;

  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';

  // Local dev: connect on the same host as the dashboard (localhost or LAN IP).
  if (import.meta.env.DEV) {
    return `${proto}//${window.location.hostname}:${chatPort()}/ws/chat`;
  }

  // Production: same-origin path proxied by nginx → AI Chat.
  return `${proto}//${window.location.host}/chat/ws/chat`;
}

function buildWsUrl(token, sessionId) {
  const base = getChatWsBase();
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}token=${encodeURIComponent(token)}&session_id=${encodeURIComponent(sessionId)}`;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function useChatSocket({ enabled = true, sessionId, onEvent }) {
  const [connected, setConnected] = useState(false);
  const wsRef = useRef(null);
  const pingRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const reconnectAttemptRef = useRef(0);
  const connectRef = useRef(null);
  const cancelledRef = useRef(false);
  const onEventRef = useRef(onEvent);
  const authFailureEmittedRef = useRef(false);

  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  const emit = useCallback((event) => {
    onEventRef.current?.(event);
  }, []);

  useEffect(() => {
    authFailureEmittedRef.current = false;
  }, [sessionId]);

  useEffect(() => {
    if (!enabled || import.meta.env.VITE_SOCKET_ENABLED === 'false' || !sessionId) {
      setConnected(false);
      return undefined;
    }

    const token = getStoredToken();
    if (!token || isTokenExpired(token)) {
      setConnected(false);
      return undefined;
    }

    cancelledRef.current = false;
    reconnectAttemptRef.current = 0;

    const clearReconnectTimer = () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };

    const emitAuthFailure = (reason) => {
      if (authFailureEmittedRef.current) return;
      authFailureEmittedRef.current = true;
      if (isTokenExpired(getStoredToken() || '')) {
        emit({ type: 'session_expired' });
      } else {
        emit({ type: 'chat_auth_failed', reason: reason || '' });
      }
    };

    const scheduleReconnect = () => {
      if (cancelledRef.current) return;
      reconnectAttemptRef.current += 1;
      const delay = Math.min(750 * reconnectAttemptRef.current, 5000);
      clearReconnectTimer();
      reconnectTimerRef.current = setTimeout(() => connectRef.current?.(), delay);
    };

    const connect = () => {
      if (cancelledRef.current) return;

      const currentToken = getStoredToken();
      if (!currentToken || isTokenExpired(currentToken)) {
        setConnected(false);
        emitAuthFailure('token_expired');
        return;
      }

      if (wsRef.current) {
        wsRef.current.onopen = null;
        wsRef.current.onclose = null;
        wsRef.current.onerror = null;
        wsRef.current.onmessage = null;
        if (wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.close();
        }
        wsRef.current = null;
      }

      const ws = new WebSocket(buildWsUrl(currentToken, sessionId));
      wsRef.current = ws;

      ws.onopen = () => {
        if (cancelledRef.current) return;
        reconnectAttemptRef.current = 0;
        clearReconnectTimer();
        setConnected(true);
        pingRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }));
          }
        }, 25000);
      };

      ws.onclose = (event) => {
        if (cancelledRef.current) return;
        setConnected(false);
        if (pingRef.current) {
          clearInterval(pingRef.current);
          pingRef.current = null;
        }

        if (event.code === 4401) {
          emit({ type: 'disconnected', code: event.code });
          emitAuthFailure(event.reason || 'unauthorized');
          return;
        }

        emit({ type: 'disconnected', code: event.code });

        if (isTokenExpired(getStoredToken() || '')) {
          emitAuthFailure('token_expired');
          return;
        }

        scheduleReconnect();
      };

      ws.onerror = () => {
        if (!cancelledRef.current) setConnected(false);
      };

      ws.onmessage = (event) => {
        if (cancelledRef.current) return;
        try {
          emit(JSON.parse(event.data));
        } catch {
          /* ignore bad frames */
        }
      };
    };

    connectRef.current = connect;
    connect();

    return () => {
      cancelledRef.current = true;
      clearReconnectTimer();
      if (pingRef.current) {
        clearInterval(pingRef.current);
        pingRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.onopen = null;
        wsRef.current.onclose = null;
        wsRef.current.onerror = null;
        wsRef.current.onmessage = null;
        if (wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.close();
        }
        wsRef.current = null;
      }
      setConnected(false);
    };
  }, [enabled, sessionId, emit]);

  const trySend = useCallback((message) => {
    const text = (message || '').trim();
    if (!text) return false;
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return false;
    }
    ws.send(JSON.stringify({ type: 'message', message: text }));
    return true;
  }, []);

  const sendMessage = useCallback(async (message, { waitMs = 5000 } = {}) => {
    const text = (message || '').trim();
    if (!text) return false;

    if (trySend(text)) return true;

    connectRef.current?.();

    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
      await sleep(100);
      if (trySend(text)) return true;
    }

    connectRef.current?.();
    return false;
  }, [trySend]);

  const resetServerSession = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return false;
    }
    ws.send(JSON.stringify({ type: 'reset_session' }));
    return true;
  }, []);

  return { connected, sendMessage, resetServerSession };
}
