import { useCallback, useEffect, useMemo, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { softphone, SipState, isSecureContextOk } from './softphone';

type CallStatus = 'RINGING' | 'BRIDGING' | 'CONNECTED' | 'ON_HOLD';

interface ActiveCall {
  channelId: string;
  callId?: string;
  from: string;
  to: string;
  status: CallStatus;
  direction: 'INBOUND' | 'OUTBOUND';
  startTime: number;
  muted?: boolean;
  held?: boolean;
}

interface LogItem {
  id: string;
  tag: string;
  msg: string;
  at: string;
}

const API_KEY = import.meta.env.VITE_API_KEY || 'demo-tenant-api-key-12345';
const AGENT_EXT = import.meta.env.VITE_AGENT_EXTENSION || 'w1001';

/** On HTTPS, use same-origin Vite proxies (/api, /socket.io) to avoid mixed content. */
function apiOrigin(): string {
  if (typeof window !== 'undefined' && window.location.protocol === 'https:') {
    return '';
  }
  return (
    import.meta.env.VITE_API_BASE ||
    `http://${typeof window !== 'undefined' ? window.location.hostname : 'localhost'}:3000`
  );
}

function apiBase() {
  return `${apiOrigin()}/api/v1/calls`;
}

function formatDuration(start: number) {
  const s = Math.max(0, Math.floor((Date.now() - start) / 1000));
  const m = String(Math.floor(s / 60)).padStart(2, '0');
  const sec = String(s % 60).padStart(2, '0');
  return `${m}:${sec}`;
}

/** Normalize India-style dial strings for the SIP trunk (E.164-ish). */
function normalizeDialNumber(raw: string): string {
  let n = raw.trim().replace(/[\s()-]/g, '');
  if (n.startsWith('00')) n = `+${n.slice(2)}`;
  if (n.startsWith('+')) return n;
  // 10-digit Indian mobile
  if (/^[6-9]\d{9}$/.test(n)) return `+91${n}`;
  // 91XXXXXXXXXX
  if (/^91\d{10}$/.test(n)) return `+${n}`;
  return n;
}

export default function App() {
  const [sipState, setSipState] = useState<SipState>('UNREGISTERED');
  const [wsOk, setWsOk] = useState(false);
  const [presence, setPresence] = useState<'AVAILABLE' | 'BUSY' | 'OFFLINE'>('AVAILABLE');
  const [call, setCall] = useState<ActiveCall | null>(null);
  const [dial, setDial] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [tick, setTick] = useState(0);

  const [botActive, setBotActive] = useState(false);
  const [transcripts, setTranscripts] = useState<Array<{ id: string; role: 'user' | 'bot'; text: string; at: string }>>([]);
  const [handoffRequested, setHandoffRequested] = useState(false);

  const pushLog = useCallback((tag: string, msg: string) => {
    setLogs((prev) => [
      {
        id: `${Date.now()}_${Math.random()}`,
        tag,
        msg: msg.slice(0, 220),
        at: new Date().toLocaleTimeString(),
      },
      ...prev.slice(0, 80),
    ]);
  }, []);

  // Duration ticker
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // Softphone registration — keep alive; do not unregister on React remount/HMR
  useEffect(() => {
    softphone.onStateChange((s) => {
      setSipState(s);
      if (s === 'REGISTERED') setError((prev) => (prev?.includes('SIP') ? null : prev));
    });
    softphone.setAutoAnswer(true);
    softphone.onMediaError((msg) => {
      // AbortError / interrupted play is a benign race — log only
      if (/interrupted|AbortError/i.test(msg)) {
        pushLog('MEDIA', msg);
        return;
      }
      setError(msg);
      pushLog('MEDIA_ERR', msg);
    });

    const sync = async () => {
      if (presence === 'OFFLINE') {
        await softphone.unregister();
        pushLog('SIP', 'Unregistered (offline)');
        return;
      }
      if (softphone.getState() === 'REGISTERED') return;
      try {
        await softphone.register({ extension: AGENT_EXT });
        pushLog('SIP', `Registered ${AGENT_EXT}`);
        setError(null);
      } catch (err: any) {
        setError(`SIP register failed: ${err?.message || err}`);
        pushLog('ERROR', String(err?.message || err));
      }
    };
    sync();
  }, [presence, pushLog]);

  useEffect(() => {
    const onUnload = () => {
      softphone.unregister().catch(() => {});
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, []);

  // Socket.IO events
  useEffect(() => {
    const origin = apiOrigin();
    const socket: Socket = io(origin ? `${origin}/events` : '/events', {
      query: { tenantId: API_KEY },
      transports: ['websocket', 'polling'],
    });

    socket.on('connect', () => {
      setWsOk(true);
      pushLog('WS', 'Connected');
    });
    socket.on('disconnect', () => {
      setWsOk(false);
      pushLog('WS', 'Disconnected');
    });

    const onStarted = (data: any) => {
      const p = data.data || data;
      if (p.direction === 'OUTBOUND') return;
      if (p.role === 'agent' || p.role === 'pstn') return;
      if (p.exten === 'h') return;

      pushLog('IN', `Incoming ${p.callerNumber} → ${p.did || p.exten}`);
      setCall({
        channelId: p.channelId,
        callId: p.callId,
        from: p.callerNumber || 'Unknown',
        to: p.did || p.exten || '+914440004407',
        status: 'RINGING',
        direction: 'INBOUND',
        startTime: Date.now(),
      });
      setPresence('BUSY');
      setError(null);
    };

    const onBridged = (data: any) => {
      const p = data.data || data;
      pushLog('MEDIA', `Bridged call ${p.callId || ''}`);
      setCall((prev) =>
        prev
          ? {
              ...prev,
              status: 'CONNECTED',
              callId: p.callId || prev.callId,
              channelId: p.callerChannelId || p.channelId || prev.channelId,
              startTime: Date.now(),
            }
          : {
              channelId: p.callerChannelId || p.channelId,
              callId: p.callId,
              from: p.fromNumber || AGENT_EXT,
              to: p.toNumber || 'PSTN',
              status: 'CONNECTED',
              direction: p.direction || 'OUTBOUND',
              startTime: Date.now(),
            },
      );
      setPresence('BUSY');
      setError(null);
    };

    const onInitiated = (data: any) => {
      const p = data.data || data;
      pushLog('OUT', `Dialing ${p.to}`);
      setCall((prev) =>
        prev
          ? { ...prev, channelId: p.channelId || prev.channelId, callId: p.callId || prev.callId, status: 'BRIDGING' }
          : {
              channelId: p.channelId || `pending_${Date.now()}`,
              callId: p.callId,
              from: p.from || AGENT_EXT,
              to: p.to || '',
              status: 'BRIDGING',
              direction: 'OUTBOUND',
              startTime: Date.now(),
            },
      );
    };

    const onAnswered = (data: any) => {
      const p = data.data || data;
      pushLog('ANS', `Agent leg ringing ${p.agentExtension || ''}`);
      setCall((prev) => (prev ? { ...prev, status: 'BRIDGING', callId: p.callId || prev.callId } : prev));
    };

    const onFailed = (data: any) => {
      const p = data.data || data;
      const reason = p.reason || 'Answer failed';
      pushLog('FAIL', reason);
      setError(reason);
      // Keep ringing UI so agent can retry — PSTN caller should still be on MOH
      setCall((prev) =>
        prev
          ? {
              ...prev,
              status: 'RINGING',
              channelId: p.channelId || prev.channelId,
              callId: p.callId || prev.callId,
            }
          : prev,
      );
      setPresence('BUSY');
    };

    const onEnded = (data: any) => {
      const p = data.data || data;
      pushLog('END', `${p.reason || ''} ${JSON.stringify(p).slice(0, 100)}`);
      softphone.hangup().catch(() => {});
      setCall(null);
      setPresence('AVAILABLE');
      setBotActive(false);
      setTranscripts([]);
      setHandoffRequested(false);
    };

    const onVoicebotStarted = () => {
      pushLog('BOT', 'Voicebot started');
      setBotActive(true);
    };

    const onVoicebotStopped = () => {
      pushLog('BOT', 'Voicebot stopped');
      setBotActive(false);
    };

    const onVoicebotTranscript = (data: any) => {
      const p = data.data || data;
      pushLog('TRANSCRIPT', `[${p.role?.toUpperCase()}] ${p.text}`);
      setTranscripts((prev) => [
        ...prev,
        {
          id: `${Date.now()}_${Math.random()}`,
          role: p.role || 'bot',
          text: p.text || '',
          at: new Date().toLocaleTimeString(),
        },
      ]);
    };

    const onVoicebotHandoff = () => {
      pushLog('HANDOFF', 'Voicebot requested live agent handoff!');
      setHandoffRequested(true);
    };

    socket.on('call.started', onStarted);
    socket.on('call.initiated', onInitiated);
    socket.on('call.answered', onAnswered);
    socket.on('call.bridged', onBridged);
    socket.on('call.answer_failed', onFailed);
    socket.on('call.ended', onEnded);
    socket.on('voicebot.started', onVoicebotStarted);
    socket.on('voicebot.stopped', onVoicebotStopped);
    socket.on('voicebot.transcript', onVoicebotTranscript);
    socket.on('voicebot.handoff_requested', onVoicebotHandoff);

    return () => {
      socket.disconnect();
      // Keep SIP registration alive across socket reconnects
    };
  }, [pushLog]);

  const accept = async () => {
    if (!call) return;
    softphone.setAutoAnswer(true);
    setError(null);
    try {
      await softphone.ensureRegistered({ extension: AGENT_EXT });
      await softphone.ensureMicrophone();
    } catch (err: any) {
      setError(err?.message || String(err));
      pushLog('ERROR', err?.message || String(err));
      return;
    }
    pushLog('API', `POST answer → ${AGENT_EXT}`);
    try {
      const res = await fetch(`${apiBase()}/${call.channelId}/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
        body: JSON.stringify({ agentExtension: AGENT_EXT, callId: call.callId }),
      });
      if (!res.ok) {
        throw new Error(`Answer failed HTTP ${res.status}`);
      }
      setCall((prev) => (prev ? { ...prev, status: 'BRIDGING' } : prev));
    } catch (err: any) {
      setError(err?.message || String(err));
      pushLog('ERROR', err?.message || String(err));
    }
  };

  const hangup = async () => {
    if (!call) return;
    await softphone.hangup();
    await fetch(`${apiBase()}/${call.channelId}/hangup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
      body: JSON.stringify({ callId: call.callId }),
    });
    setCall(null);
    setPresence('AVAILABLE');
  };

  const toggleHold = async () => {
    if (!call) return;
    const action = call.held ? 'resume' : 'hold';
    await fetch(`${apiBase()}/${call.channelId}/${action}`, {
      method: 'POST',
      headers: { 'x-api-key': API_KEY },
    });
    setCall((prev) =>
      prev
        ? { ...prev, held: !prev.held, status: !prev.held ? 'ON_HOLD' : 'CONNECTED' }
        : prev,
    );
  };

  const toggleMute = async () => {
    if (!call) return;
    const next = !call.muted;
    await softphone.mute(next);
    await fetch(`${apiBase()}/${call.channelId}/${next ? 'mute' : 'unmute'}`, {
      method: 'POST',
      headers: { 'x-api-key': API_KEY },
    });
    setCall((prev) => (prev ? { ...prev, muted: next } : prev));
  };

  const startVoicebot = async () => {
    if (!call) return;
    pushLog('API', `POST voicebot/start → channel ${call.channelId}`);
    try {
      const res = await fetch(`${apiBase()}/${call.channelId}/voicebot/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
        body: JSON.stringify({ callId: call.callId }),
      });
      if (!res.ok) throw new Error(`Start voicebot failed HTTP ${res.status}`);
      setBotActive(true);
    } catch (err: any) {
      setError(err?.message || String(err));
      pushLog('ERROR', err?.message || String(err));
    }
  };

  const stopVoicebot = async () => {
    if (!call) return;
    pushLog('API', `POST voicebot/stop → channel ${call.channelId}`);
    try {
      await fetch(`${apiBase()}/${call.channelId}/voicebot/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
        body: JSON.stringify({ callId: call.callId }),
      });
      setBotActive(false);
    } catch (err: any) {
      setError(err?.message || String(err));
    }
  };

  const handoffVoicebot = async () => {
    if (!call) return;
    softphone.setAutoAnswer(true);
    setError(null);
    try {
      await softphone.ensureRegistered({ extension: AGENT_EXT });
      await softphone.ensureMicrophone();
    } catch (err: any) {
      setError(err?.message || String(err));
      pushLog('ERROR', err?.message || String(err));
      return;
    }

    pushLog('API', `POST voicebot/handoff → agent ${AGENT_EXT}`);
    try {
      const res = await fetch(`${apiBase()}/${call.channelId}/voicebot/handoff`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
        body: JSON.stringify({ agentExtension: AGENT_EXT, callId: call.callId }),
      });
      if (!res.ok) throw new Error(`Handoff failed HTTP ${res.status}`);
      setBotActive(false);
      setHandoffRequested(false);
      setCall((prev) => (prev ? { ...prev, status: 'BRIDGING' } : prev));
    } catch (err: any) {
      setError(err?.message || String(err));
      pushLog('ERROR', err?.message || String(err));
    }
  };

  const dialOut = async () => {
    if (!dial.trim()) return;
    if (call) {
      setError('Already on a call — end it before dialing out.');
      return;
    }
    if (presence === 'OFFLINE') {
      setError('Set presence to Available before dialing.');
      return;
    }

    const to = normalizeDialNumber(dial);
    softphone.setAutoAnswer(true);
    setError(null);
    pushLog('API', `Dialing ${to}…`);

    try {
      await softphone.ensureRegistered({ extension: AGENT_EXT });
      await softphone.ensureMicrophone();
    } catch (err: any) {
      const msg = err?.message || String(err);
      setError(msg);
      pushLog('ERROR', msg);
      return;
    }

    try {
      pushLog('API', `POST originate ${AGENT_EXT} → ${to}`);
      const res = await fetch(apiBase(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
        body: JSON.stringify({ from: AGENT_EXT, to }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Originate failed HTTP ${res.status} ${text}`.trim());
      }
      setCall({
        channelId: `pending_${Date.now()}`,
        from: AGENT_EXT,
        to,
        status: 'BRIDGING',
        direction: 'OUTBOUND',
        startTime: Date.now(),
      });
      setPresence('BUSY');
      setDial('');
    } catch (err: any) {
      const msg = err?.message || String(err);
      setError(msg);
      pushLog('ERROR', msg);
    }
  };

  const sipDot = sipState === 'REGISTERED' ? 'ok' : sipState === 'REGISTERING' ? 'warn' : 'err';
  const duration = useMemo(
    () => (call ? formatDuration(call.startTime) : '00:00'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [call, tick],
  );

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <h1>Agent Console</h1>
          <p>Contact Center Support · Extension {AGENT_EXT}</p>
        </div>
        <div className="badges">
          <span className="badge">
            <span className={`dot ${wsOk ? 'ok' : 'err'}`} />
            {wsOk ? 'Events Live' : 'Events Offline'}
          </span>
          <span className="badge">
            <span className={`dot ${sipDot}`} />
            {sipState === 'REGISTERED' ? `SIP ${AGENT_EXT}` : sipState}
          </span>
          <select
            className="select"
            value={presence}
            onChange={(e) => setPresence(e.target.value as any)}
          >
            <option value="AVAILABLE">Available</option>
            <option value="BUSY">Busy</option>
            <option value="OFFLINE">Offline</option>
          </select>
        </div>
      </header>

      {!isSecureContextOk() && (
        <div className="error-banner">
          Insecure HTTP — microphone is blocked. Open{' '}
          <strong>https://{typeof window !== 'undefined' ? window.location.host : 'HOST:5174'}</strong>{' '}
          (accept the certificate warning), then Allow microphone.
        </div>
      )}

      {error && <div className="error-banner">{error}</div>}

      <div className="grid">
        <section className="panel">
          <h2>Live Call</h2>

          {!call && (
            <div className="idle">
              <strong>Waiting for calls</strong>
              Ensure SIP badge is green before accepting inbound or dialing out.
            </div>
          )}

          {call?.status === 'RINGING' && (
            <div className="ringing">
              <div>
                <div style={{ opacity: 0.85, fontSize: '0.8rem', fontWeight: 700, marginBottom: 6 }}>
                  INCOMING CALL {botActive ? '· 🤖 VOICEBOT ACTIVE' : ''}
                </div>
                <div className="caller">{call.from}</div>
                <div className="meta">DID {call.to} · {call.channelId}</div>
              </div>
              <div className="actions">
                <button className="btn btn-accept" onClick={accept} disabled={presence === 'OFFLINE'}>
                  Accept & Speak
                </button>
                {!botActive ? (
                  <button className="btn btn-bot" onClick={startVoicebot}>
                    Start Voicebot
                  </button>
                ) : (
                  <button className="btn btn-handoff" onClick={handoffVoicebot}>
                    Take Over Call
                  </button>
                )}
                <button className="btn btn-reject" onClick={hangup}>
                  Decline
                </button>
              </div>
            </div>
          )}

          {call && call.status !== 'RINGING' && (
            <div className="active-call">
              <div className="call-top">
                <div>
                  <div className="caller" style={{ fontSize: '1.4rem' }}>
                    {call.direction === 'OUTBOUND' ? call.to : call.from}
                  </div>
                  <div className="meta">
                    {call.direction} · {call.channelId}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <span
                    className={`status-pill ${
                      call.status === 'ON_HOLD' ? 'hold' : call.status === 'BRIDGING' ? 'bridging' : ''
                    }`}
                  >
                    {call.status === 'ON_HOLD'
                      ? 'ON HOLD'
                      : call.status === 'BRIDGING'
                        ? call.direction === 'OUTBOUND'
                          ? 'RINGING CALLEE'
                          : 'CONNECTING'
                        : 'LIVE'}
                  </span>
                  <div className="timer">{duration}</div>
                </div>
              </div>

              <div className="controls">
                <button className="btn btn-secondary" onClick={toggleMute}>
                  {call.muted ? 'Unmute' : 'Mute'}
                </button>
                <button className="btn btn-secondary" onClick={toggleHold}>
                  {call.held ? 'Resume' : 'Hold'}
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={() =>
                    fetch(`${apiBase()}/${call.channelId}/record`, {
                      method: 'POST',
                      headers: { 'x-api-key': API_KEY },
                    })
                  }
                >
                  Record
                </button>
                <button className="btn btn-end" onClick={hangup}>
                  End Call
                </button>
              </div>
            </div>
          )}

          {(botActive || transcripts.length > 0) && (
            <div className="transcript-panel">
              <div className="transcript-header">
                <span>🤖 AI Voicebot Live Transcript</span>
                {botActive ? (
                  <button className="btn btn-handoff" style={{ fontSize: '0.75rem', padding: '4px 10px' }} onClick={handoffVoicebot}>
                    Take Over
                  </button>
                ) : (
                  <span style={{ color: 'var(--muted)', fontSize: '0.75rem' }}>Bot Stopped</span>
                )}
              </div>
              <div className="transcript-list">
                {transcripts.length === 0 && (
                  <div style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>Listening for caller...</div>
                )}
                {transcripts.map((t) => (
                  <div key={t.id} className={`transcript-msg ${t.role}`}>
                    <strong>{t.role === 'user' ? 'Caller' : 'Voicebot'}:</strong> {t.text}
                    <span className="time">{t.at}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        <section className="panel dialer">
          <h2>Outbound Dialer</h2>
          <input
            value={dial}
            onChange={(e) => setDial(e.target.value)}
            placeholder="Phone number"
            onKeyDown={(e) => e.key === 'Enter' && dialOut()}
          />
          <div className="pad">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'].map((d) => (
              <button key={d} type="button" onClick={() => setDial((v) => v + d)}>
                {d}
              </button>
            ))}
          </div>
          <button
            className="btn btn-primary"
            style={{ width: '100%' }}
            onClick={dialOut}
            disabled={!!call || presence === 'OFFLINE'}
          >
            {sipState === 'REGISTERED' ? 'Call Number' : 'Call Number (will re-register SIP)'}
          </button>
        </section>
      </div>

      <section className="panel">
        <h2>Event Log</h2>
        <div className="log">
          {logs.length === 0 && <div className="log-row">No events yet</div>}
          {logs.map((l) => (
            <div key={l.id} className="log-row">
              <span className="tag">[{l.at}] {l.tag}</span>
              {l.msg}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
