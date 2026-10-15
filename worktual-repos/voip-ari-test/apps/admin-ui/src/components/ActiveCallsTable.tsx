import React, { useState } from 'react';
import { Phone, PhoneOff, Pause, Play, Mic, MicOff, ArrowUpRight, Radio } from 'lucide-react';

export interface ActiveCall {
  id: string;
  from: string;
  to: string;
  status: 'RINGING' | 'ANSWERED' | 'ON_HOLD' | 'MUTED' | 'COMPLETED';
  isMuted?: boolean;
  isHeld?: boolean;
  duration: string;
  channelId?: string;
  startTime?: number;
}

interface ActiveCallsTableProps {
  calls: ActiveCall[];
  onAnswer?: (callId: string) => void;
  onHangup?: (callId: string) => void;
  onToggleHold?: (callId: string, currentHeld: boolean) => void;
  onToggleMute?: (callId: string, currentMuted: boolean) => void;
  onTransfer?: (callId: string, targetExt: string) => void;
}

export const ActiveCallsTable: React.FC<ActiveCallsTableProps> = ({
  calls,
  onAnswer,
  onHangup,
  onToggleHold,
  onToggleMute,
  onTransfer,
}) => {
  const [transferingCallId, setTransferingCallId] = useState<string | null>(null);
  const [targetExt, setTargetExt] = useState('');

  const handleTransferSubmit = (callId: string) => {
    if (!targetExt.trim()) return;
    if (onTransfer) onTransfer(callId, targetExt.trim());
    setTransferingCallId(null);
    setTargetExt('');
  };

  return (
    <div className="card" style={{ marginBottom: '24px' }}>
      <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '1.25rem', margin: 0 }}>
            <Radio size={20} style={{ color: 'var(--status-green)', animation: 'pulse 1.5s infinite' }} />
            Live Incoming & Active Calls
          </h2>
          <span style={{ fontSize: '0.825rem', color: 'var(--text-secondary)' }}>
            Real-time Asterisk ARI Telephony Stasis Controls
          </span>
        </div>
        <span style={{ fontSize: '0.85rem', background: 'rgba(16, 185, 129, 0.15)', color: '#10B981', padding: '4px 12px', borderRadius: '20px', fontWeight: 600 }}>
          {calls.length} Active Call{calls.length === 1 ? '' : 's'}
        </span>
      </div>

      <table className="table">
        <thead>
          <tr>
            <th>Call ID</th>
            <th>Caller (From)</th>
            <th>Target DID / Queue</th>
            <th>State</th>
            <th>Duration</th>
            <th>Live Call Controls</th>
          </tr>
        </thead>
        <tbody>
          {calls.length === 0 ? (
            <tr>
              <td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '36px' }}>
                <div style={{ fontSize: '1rem', fontWeight: 500, marginBottom: '4px' }}>
                  📞 No Active Calls Right Now
                </div>
                <div style={{ fontSize: '0.85rem', color: '#6B7280' }}>
                  Dial test number <strong>+914440004407</strong> to see incoming call stream live!
                </div>
              </td>
            </tr>
          ) : (
            calls.map((call) => {
              const isRinging = call.status === 'RINGING';
              const isHeld = call.status === 'ON_HOLD' || call.isHeld;
              const isMuted = call.isMuted;

              return (
                <tr key={call.id} style={{ background: isRinging ? 'rgba(245, 158, 11, 0.05)' : 'transparent' }}>
                  <td style={{ fontFamily: 'monospace', fontWeight: 600, color: 'var(--accent-cyan)' }}>
                    {call.id.slice(0, 12)}
                  </td>
                  <td style={{ fontWeight: 600 }}>{call.from}</td>
                  <td>{call.to}</td>
                  <td>
                    <span
                      className={`badge ${
                        call.status === 'ANSWERED'
                          ? 'badge-success'
                          : isRinging
                          ? 'badge-warning'
                          : call.status === 'ON_HOLD'
                          ? 'badge-warning'
                          : 'badge-danger'
                      }`}
                      style={{ padding: '6px 12px', borderRadius: '12px', fontWeight: 600 }}
                    >
                      <span className="pulse-dot" />
                      {call.status}
                    </span>
                  </td>
                  <td style={{ fontFamily: 'monospace', fontWeight: 600 }}>{call.duration}</td>
                  <td>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                      {/* Answer / Attend Button */}
                      {isRinging && (
                        <button
                          onClick={() => onAnswer && onAnswer(call.id)}
                          style={{
                            background: '#10B981',
                            color: '#FFFFFF',
                            border: 'none',
                            padding: '6px 14px',
                            borderRadius: '8px',
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px',
                            fontWeight: 600,
                            boxShadow: '0 2px 8px rgba(16, 185, 129, 0.4)',
                          }}
                        >
                          <Phone size={14} /> Attend
                        </button>
                      )}

                      {/* Hold / Resume Button */}
                      {!isRinging && (
                        <button
                          onClick={() => onToggleHold && onToggleHold(call.id, !!isHeld)}
                          style={{
                            background: isHeld ? 'rgba(245, 158, 11, 0.2)' : 'rgba(255, 255, 255, 0.08)',
                            color: isHeld ? '#F59E0B' : '#E5E7EB',
                            border: '1px solid rgba(255, 255, 255, 0.15)',
                            padding: '6px 10px',
                            borderRadius: '8px',
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            fontSize: '0.85rem',
                          }}
                        >
                          {isHeld ? <Play size={14} /> : <Pause size={14} />}
                          {isHeld ? 'Resume' : 'Hold'}
                        </button>
                      )}

                      {/* Mute / Unmute Button */}
                      {!isRinging && (
                        <button
                          onClick={() => onToggleMute && onToggleMute(call.id, !!isMuted)}
                          style={{
                            background: isMuted ? 'rgba(239, 68, 68, 0.2)' : 'rgba(255, 255, 255, 0.08)',
                            color: isMuted ? '#EF4444' : '#E5E7EB',
                            border: '1px solid rgba(255, 255, 255, 0.15)',
                            padding: '6px 10px',
                            borderRadius: '8px',
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            fontSize: '0.85rem',
                          }}
                        >
                          {isMuted ? <MicOff size={14} /> : <Mic size={14} />}
                          {isMuted ? 'Unmute' : 'Mute'}
                        </button>
                      )}

                      {/* Transfer Control */}
                      {!isRinging && transferingCallId !== call.id && (
                        <button
                          onClick={() => setTransferingCallId(call.id)}
                          style={{
                            background: 'rgba(59, 130, 246, 0.15)',
                            color: '#60A5FA',
                            border: '1px solid rgba(59, 130, 246, 0.3)',
                            padding: '6px 10px',
                            borderRadius: '8px',
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            fontSize: '0.85rem',
                          }}
                        >
                          <ArrowUpRight size={14} /> Transfer
                        </button>
                      )}

                      {transferingCallId === call.id && (
                        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                          <input
                            type="text"
                            placeholder="Ext (e.g. 1002)"
                            value={targetExt}
                            onChange={(e) => setTargetExt(e.target.value)}
                            style={{
                              width: '90px',
                              padding: '4px 8px',
                              borderRadius: '6px',
                              border: '1px solid rgba(255, 255, 255, 0.2)',
                              background: '#1F2937',
                              color: '#FFF',
                              fontSize: '0.85rem',
                            }}
                          />
                          <button
                            onClick={() => handleTransferSubmit(call.id)}
                            style={{
                              background: '#3B82F6',
                              color: '#FFF',
                              border: 'none',
                              padding: '4px 8px',
                              borderRadius: '6px',
                              cursor: 'pointer',
                              fontSize: '0.75rem',
                              fontWeight: 600,
                            }}
                          >
                            Go
                          </button>
                        </div>
                      )}

                      {/* Cut / Hangup Button */}
                      <button
                        onClick={() => onHangup && onHangup(call.id)}
                        style={{
                          background: 'rgba(239, 68, 68, 0.2)',
                          color: '#EF4444',
                          border: '1px solid rgba(239, 68, 68, 0.4)',
                          padding: '6px 12px',
                          borderRadius: '8px',
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          fontWeight: 600,
                          fontSize: '0.85rem',
                        }}
                      >
                        <PhoneOff size={14} /> Cut
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
};
