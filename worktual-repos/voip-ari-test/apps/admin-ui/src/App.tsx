import React, { useState, useEffect } from 'react';
import {
  Phone,
  PhoneOff,
  PhoneCall,
  PhoneIncoming,
  PhoneOutgoing,
  Mic,
  MicOff,
  Pause,
  Play,
  ArrowUpRight,
  User,
  ShieldCheck,
  Radio,
  Clock,
  History,
  Volume2,
  Headphones,
  CheckCircle2,
  XCircle,
  LayoutDashboard,
  Bot,
  Users,
  FileText,
  Activity,
  Disc,
  MessageSquare,
  Search,
  Server,
  Zap,
} from 'lucide-react';
import { socketService } from './services/socket.service';
import { webrtcSoftphone, SoftphoneRegistrationState } from './services/webrtc-softphone.service';

export interface ActiveCall {
  id: string;
  from: string;
  to: string;
  status: 'RINGING' | 'BRIDGING' | 'ANSWERED' | 'ON_HOLD' | 'COMPLETED';
  isMuted?: boolean;
  isHeld?: boolean;
  isRecording?: boolean;
  duration: string;
  channelId?: string;
  callId?: string;
  startTime?: number;
  crmName?: string;
  crmTier?: string;
  aiTranscript?: string[];
  direction?: 'INBOUND' | 'OUTBOUND';
}

export interface CallLog {
  id: string;
  from: string;
  to: string;
  status: string;
  duration: string;
  timestamp: string;
}

export interface SystemEvent {
  id: string;
  event: string;
  timestamp: string;
  details: string;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'softphone' | 'dashboard' | 'queues' | 'voicebot' | 'history' | 'events'>('softphone');
  const [socketConnected, setSocketConnected] = useState(false);
  const [sipState, setSipState] = useState<SoftphoneRegistrationState>('UNREGISTERED');
  const [agentStatus, setAgentStatus] = useState<'AVAILABLE' | 'BUSY' | 'ON_BREAK' | 'OFFLINE'>('AVAILABLE');
  const [agentExtension] = useState(
    () => (import.meta as any).env?.VITE_AGENT_EXTENSION || 'w1001',
  );

  // Real-time Call & System State
  const [activeCall, setActiveCall] = useState<ActiveCall | null>(null);
  const [callLogs, setCallLogs] = useState<CallLog[]>([
    { id: 'c-101', from: '+919952282829', to: '+914440004407', status: 'COMPLETED', duration: '01:45', timestamp: '18:53:08' },
    { id: 'c-102', from: '+919150911820', to: '+914440004407', status: 'COMPLETED', duration: '00:42', timestamp: '18:48:53' },
  ]);
  const [eventStream, setEventStream] = useState<SystemEvent[]>([]);

  // Dialpad, Notes & Transfer State
  const [dialNumber, setDialNumber] = useState('');
  const [transferExt, setTransferExt] = useState('');
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [customerNotes, setCustomerNotes] = useState('');

  // Voicebot Config State
  const [botPrompt, setBotPrompt] = useState('You are an AI Contact Center Support Agent assisting customers with IVR and billing inquiries.');
  const [sttModel, setSttModel] = useState('Google Speech-to-Text (v2 En-US / Hi-IN)');
  const [ttsVoice, setTtsVoice] = useState('Google Journey Neural Voice (en-US-Journey-F)');

  const apiOrigin =
    (import.meta as any).env?.VITE_API_BASE ||
    `http://${typeof window !== 'undefined' ? window.location.hostname : 'localhost'}:3000`;
  const apiBase = () => `${apiOrigin}/api/v1/calls`;

  // Register WebRTC softphone when agent is AVAILABLE
  useEffect(() => {
    webrtcSoftphone.onRegistrationStateChange(setSipState);
    webrtcSoftphone.setAutoAnswer(true);

    const syncRegistration = async () => {
      if (agentStatus === 'AVAILABLE' || agentStatus === 'BUSY') {
        if (webrtcSoftphone.getRegistrationState() !== 'REGISTERED') {
          try {
            await webrtcSoftphone.register({ extension: agentExtension });
          } catch (err) {
            console.error('SIP register failed:', err);
          }
        }
      } else {
        await webrtcSoftphone.unregister();
      }
    };

    syncRegistration();
  }, [agentStatus, agentExtension]);

  useEffect(() => {
    socketService.connect(
      'demo-tenant-api-key-12345',
      () => setSocketConnected(true),
      () => setSocketConnected(false)
    );

    const logEvent = (name: string, payload: any) => {
      setEventStream((prev) => [
        {
          id: `ev_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
          event: name,
          timestamp: new Date().toLocaleTimeString(),
          details: JSON.stringify(payload).slice(0, 120),
        },
        ...prev.slice(0, 49),
      ]);
    };

    // 1. Incoming Call Event (call.started)
    const handleIncomingCall = (data: any) => {
      const payload = data.data || data;
      // Ignore outbound join legs / agent channels for ringing UI
      if (payload.direction === 'OUTBOUND') return;
      if (payload.role === 'agent' || payload.role === 'pstn') return;

      logEvent('call.started', payload);

      const channelId = payload.channelId || payload.callId || `call_${Date.now()}`;
      const callerNumber = payload.callerNumber || payload.from || 'Unknown';
      const didNumber = payload.did || payload.exten || payload.toNumber || '+914440004407';

      setActiveCall({
        id: channelId,
        callId: payload.callId,
        from: callerNumber,
        to: didNumber,
        status: 'RINGING',
        duration: '00:00',
        channelId,
        direction: 'INBOUND',
        startTime: Date.now(),
        crmName: callerNumber.includes('9952282829') ? 'Bharathi (VIP Account)' : 'Inbound Customer',
        crmTier: 'VIP Tier 1',
        aiTranscript: [
          'System: Inbound PSTN call waiting for agent accept...',
          `Customer: Calling DID ${didNumber}.`,
        ],
      });
      setAgentStatus('BUSY');
    };

    // 2. Bridged = true two-way media connected
    const handleCallBridged = (data: any) => {
      const payload = data.data || data;
      logEvent('call.bridged', payload);
      setActiveCall((prev) =>
        prev
          ? {
              ...prev,
              status: 'ANSWERED',
              callId: payload.callId || prev.callId,
              channelId: payload.callerChannelId || payload.channelId || prev.channelId,
              id: payload.callerChannelId || payload.channelId || prev.id,
              startTime: Date.now(),
            }
          : {
              id: payload.callerChannelId || payload.channelId || payload.callId,
              callId: payload.callId,
              from: payload.fromNumber || agentExtension,
              to: payload.toNumber || 'Unknown',
              status: 'ANSWERED',
              duration: '00:00',
              channelId: payload.callerChannelId || payload.channelId,
              direction: payload.direction || 'OUTBOUND',
              startTime: Date.now(),
              crmName: `Customer (${payload.toNumber || payload.fromNumber || 'PSTN'})`,
              crmTier: 'Live Call',
            },
      );
      setAgentStatus('BUSY');
    };

    // 3. Call Answered / bridging in progress
    const handleCallAnswered = (data: any) => {
      const payload = data.data || data;
      logEvent('call.answered', payload);
      setActiveCall((prev) =>
        prev
          ? {
              ...prev,
              status: prev.status === 'ANSWERED' ? 'ANSWERED' : 'BRIDGING',
              callId: payload.callId || prev.callId,
              channelId: payload.channelId || prev.channelId,
            }
          : null,
      );
    };

    // 4. Outbound Originated Event
    const handleCallOriginated = (data: any) => {
      const payload = data.data || data;
      logEvent('call.initiated', payload);
      setActiveCall((prev) =>
        prev
          ? {
              ...prev,
              id: payload.channelId || prev.id,
              channelId: payload.channelId || prev.channelId,
              callId: payload.callId || prev.callId,
              status: 'BRIDGING',
            }
          : {
              id: payload.channelId || payload.callId || `out_${Date.now()}`,
              callId: payload.callId,
              from: payload.from || agentExtension,
              to: payload.to || 'Unknown',
              status: 'BRIDGING',
              duration: '00:00',
              channelId: payload.channelId,
              direction: 'OUTBOUND',
              startTime: Date.now(),
              crmName: `Outbound Customer (${payload.to || ''})`,
              crmTier: 'PSTN Outbound',
            },
      );
      setAgentStatus('BUSY');
    };

    // 5. Call Ended / Hangup Event
    const handleCallEnded = (data: any) => {
      logEvent('call.ended', data);
      webrtcSoftphone.hangup().catch(() => {});
      setActiveCall((prev) => {
        if (prev) {
          setCallLogs((logs) => [
            {
              id: prev.id,
              from: prev.from,
              to: prev.to,
              status: 'COMPLETED',
              duration: prev.duration || '00:15',
              timestamp: new Date().toLocaleTimeString(),
            },
            ...logs,
          ]);
        }
        return null;
      });
      setAgentStatus('AVAILABLE');
    };

    socketService.on('call.started', handleIncomingCall);
    socketService.on('stasis.start', handleIncomingCall);
    socketService.on('call.ringing', handleIncomingCall);

    socketService.on('call.initiated', handleCallOriginated);
    socketService.on('channel.originated', handleCallOriginated);

    socketService.on('call.answered', handleCallAnswered);
    socketService.on('call.bridged', handleCallBridged);

    socketService.on('call.ended', handleCallEnded);
    socketService.on('stasis.end', handleCallEnded);

    return () => {
      socketService.disconnect();
      webrtcSoftphone.unregister().catch(() => {});
    };
  }, [agentExtension]);

  // Update Duration Timer
  useEffect(() => {
    const timer = setInterval(() => {
      setActiveCall((prev) => {
        if (prev && prev.startTime && (prev.status === 'ANSWERED' || prev.status === 'BRIDGING')) {
          const elapsed = Math.floor((Date.now() - prev.startTime) / 1000);
          const mins = String(Math.floor(elapsed / 60)).padStart(2, '0');
          const secs = String(elapsed % 60).padStart(2, '0');
          return { ...prev, duration: `${mins}:${secs}` };
        }
        return prev;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Call Actions (REST API)
  const handleAnswer = async () => {
    if (!activeCall) return;
    try {
      // REST answer originates WebRTC INVITE to this agent; softphone auto-answers
      webrtcSoftphone.setAutoAnswer(true);
      await fetch(`${apiBase()}/${activeCall.channelId || activeCall.id}/answer`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': 'demo-tenant-api-key-12345',
        },
        body: JSON.stringify({
          agentExtension,
          callId: activeCall.callId,
        }),
      });
      setActiveCall((prev) => (prev ? { ...prev, status: 'BRIDGING', startTime: Date.now() } : null));
    } catch (err) {
      console.error('Answer call error:', err);
    }
  };

  const handleHangup = async () => {
    if (!activeCall) return;
    try {
      await webrtcSoftphone.hangup();
      await fetch(`${apiBase()}/${activeCall.channelId || activeCall.id}/hangup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': 'demo-tenant-api-key-12345',
        },
        body: JSON.stringify({ callId: activeCall.callId }),
      });
      setCallLogs((logs) => [
        {
          id: activeCall.id,
          from: activeCall.from,
          to: activeCall.to,
          status: 'COMPLETED',
          duration: activeCall.duration || '00:10',
          timestamp: new Date().toLocaleTimeString(),
        },
        ...logs,
      ]);
      setActiveCall(null);
      setAgentStatus('AVAILABLE');
    } catch (err) {
      console.error('Hangup error:', err);
    }
  };

  const handleToggleHold = async () => {
    if (!activeCall) return;
    const isHeld = activeCall.isHeld;
    const action = isHeld ? 'resume' : 'hold';
    try {
      await fetch(`${apiBase()}/${activeCall.channelId || activeCall.id}/${action}`, {
        method: 'POST',
        headers: { 'x-api-key': 'demo-tenant-api-key-12345' },
      });
      setActiveCall((prev) =>
        prev ? { ...prev, isHeld: !isHeld, status: !isHeld ? 'ON_HOLD' : 'ANSWERED' } : null
      );
    } catch (err) {
      console.error('Hold error:', err);
    }
  };

  const handleToggleMute = async () => {
    if (!activeCall) return;
    const isMuted = !!activeCall.isMuted;
    const action = isMuted ? 'unmute' : 'mute';
    try {
      await webrtcSoftphone.mute(!isMuted);
      await fetch(`${apiBase()}/${activeCall.channelId || activeCall.id}/${action}`, {
        method: 'POST',
        headers: { 'x-api-key': 'demo-tenant-api-key-12345' },
      });
      setActiveCall((prev) => (prev ? { ...prev, isMuted: !isMuted } : null));
    } catch (err) {
      console.error('Mute error:', err);
    }
  };

  const handleToggleRecord = async () => {
    if (!activeCall) return;
    const recording = !!activeCall.isRecording;
    try {
      if (!recording) {
        await fetch(`${apiBase()}/${activeCall.channelId || activeCall.id}/record`, {
          method: 'POST',
          headers: { 'x-api-key': 'demo-tenant-api-key-12345' },
        });
      } else {
        await fetch(`${apiBase()}/${activeCall.channelId || activeCall.id}/record/stop`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': 'demo-tenant-api-key-12345',
          },
          body: JSON.stringify({ name: `rec_${activeCall.channelId || activeCall.id}` }),
        });
      }
      setActiveCall((prev) => (prev ? { ...prev, isRecording: !recording } : null));
    } catch (err) {
      console.error('Record error:', err);
    }
  };

  const handleTransferSubmit = async () => {
    if (!activeCall || !transferExt.trim()) return;
    try {
      await fetch(`${apiBase()}/${activeCall.channelId || activeCall.id}/transfer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': 'demo-tenant-api-key-12345' },
        body: JSON.stringify({ target: transferExt.trim(), type: 'BLIND' }),
      });
      setShowTransferModal(false);
      setTransferExt('');
      setActiveCall(null);
      setAgentStatus('AVAILABLE');
    } catch (err) {
      console.error('Transfer error:', err);
    }
  };

  const handleDialOutbound = async () => {
    if (!dialNumber.trim()) return;
    if (sipState !== 'REGISTERED') {
      console.error('WebRTC softphone not registered');
      return;
    }
    const target = dialNumber.trim();
    try {
      webrtcSoftphone.setAutoAnswer(true);
      await fetch(apiBase(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': 'demo-tenant-api-key-12345' },
        body: JSON.stringify({ from: agentExtension, to: target }),
      });
      setActiveCall({
        id: `pending_${Date.now()}`,
        from: agentExtension,
        to: target,
        status: 'BRIDGING',
        duration: '00:00',
        direction: 'OUTBOUND',
        startTime: Date.now(),
        crmName: `Outbound Customer (${target})`,
        crmTier: 'PSTN Outbound',
        aiTranscript: [`Agent ${agentExtension}: Dialing ${target}...`],
      });
      setDialNumber('');
      setAgentStatus('BUSY');
    } catch (err) {
      console.error('Outbound dial error:', err);
    }
  };

  const isRinging = activeCall?.status === 'RINGING';
  const sipBadgeColor =
    sipState === 'REGISTERED' ? '#10B981' : sipState === 'REGISTERING' ? '#F59E0B' : '#EF4444';
  const sipBadgeLabel =
    sipState === 'REGISTERED'
      ? `SIP ${agentExtension}`
      : sipState === 'REGISTERING'
        ? 'SIP Registering'
        : 'SIP Offline';

  return (
    <div style={{ minHeight: '100vh', background: '#0B0F19', color: '#F3F4F6', fontFamily: "'Inter', sans-serif", display: 'flex', flexDirection: 'column' }}>
      {/* 1. BRAND TOP HEADER */}
      <header style={{ background: 'rgba(17, 24, 39, 0.85)', backdropFilter: 'blur(16px)', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', padding: '14px 32px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ background: 'linear-gradient(135deg, #10B981, #059669)', padding: '10px', borderRadius: '12px', color: '#FFF', display: 'flex', alignItems: 'center' }}>
            <Headphones size={24} />
          </div>
          <div>
            <h1 style={{ fontSize: '1.25rem', fontWeight: 800, margin: 0, background: 'linear-gradient(135deg, #00F2FE, #4FACFE)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              Worktual Telephony & AI Contact Center
            </h1>
            <span style={{ fontSize: '0.8rem', color: '#9CA3AF' }}>Server: 82.113.92.45 | Monitored PSTN DID: +914440004407</span>
          </div>
        </div>

        {/* NAVIGATION TABS */}
        <nav style={{ display: 'flex', gap: '8px', background: 'rgba(255, 255, 255, 0.05)', padding: '4px', borderRadius: '14px', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
          {[
            { id: 'softphone', label: 'Softphone & Live Call', icon: Headphones },
            { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
            { id: 'queues', label: 'Queues & Agents', icon: Users },
            { id: 'voicebot', label: 'AI Voicebot', icon: Bot },
            { id: 'history', label: 'Call History', icon: History },
            { id: 'events', label: 'Live Events', icon: Activity },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '8px 16px',
                  borderRadius: '10px',
                  border: 'none',
                  background: isActive ? 'linear-gradient(135deg, #3B82F6, #1D4ED8)' : 'transparent',
                  color: isActive ? '#FFF' : '#9CA3AF',
                  fontSize: '0.85rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                }}
              >
                <Icon size={16} />
                {tab.label}
              </button>
            );
          })}
        </nav>

        {/* AGENT STATUS BAR */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(255, 255, 255, 0.05)', padding: '6px 12px', borderRadius: '20px', border: '1px solid rgba(255, 255, 255, 0.1)' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: socketConnected ? '#10B981' : '#EF4444', boxShadow: socketConnected ? '0 0 10px #10B981' : 'none' }} />
            <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>{socketConnected ? 'Live WSS' : 'Connecting'}</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(255, 255, 255, 0.05)', padding: '6px 12px', borderRadius: '20px', border: `1px solid ${sipBadgeColor}55` }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: sipBadgeColor, boxShadow: sipState === 'REGISTERED' ? `0 0 10px ${sipBadgeColor}` : 'none' }} />
            <span style={{ fontSize: '0.8rem', fontWeight: 600, color: sipBadgeColor }}>{sipBadgeLabel}</span>
          </div>

          <select
            value={agentStatus}
            onChange={(e: any) => setAgentStatus(e.target.value)}
            style={{
              background: '#1F2937',
              color: agentStatus === 'AVAILABLE' ? '#10B981' : agentStatus === 'BUSY' ? '#F59E0B' : '#EF4444',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              padding: '6px 12px',
              borderRadius: '8px',
              fontWeight: 700,
              fontSize: '0.85rem',
              cursor: 'pointer',
            }}
          >
            <option value="AVAILABLE">🟢 Available (Ready)</option>
            <option value="BUSY">🟡 Busy (On Call)</option>
            <option value="ON_BREAK">☕ On Break</option>
            <option value="OFFLINE">🔴 Offline</option>
          </select>
        </div>
      </header>

      {/* 2. MAIN APPLICATION CONTENT VIEWPORT */}
      <main style={{ flex: 1, padding: '24px 32px', maxWidth: '1400px', margin: '0 auto', width: '100%' }}>
        {/* TAB 1: SOFTPHONE & LIVE ACTIVE CALL WORKSTATION */}
        {activeTab === 'softphone' && (
          <div>
            {/* INCOMING RINGING CALL MODAL CARD */}
            {activeCall && isRinging && (
              <div style={{ background: 'linear-gradient(135deg, #059669 0%, #047857 100%)', borderRadius: '24px', padding: '32px', marginBottom: '32px', boxShadow: '0 20px 40px -10px rgba(5, 150, 105, 0.5)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
                  <div style={{ background: '#FFFFFF', color: '#059669', width: '64px', height: '64px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 8px 20px rgba(0,0,0,0.2)' }}>
                    <PhoneIncoming size={32} />
                  </div>
                  <div>
                    <span style={{ background: 'rgba(255, 255, 255, 0.2)', color: '#FFF', fontSize: '0.8rem', fontWeight: 700, padding: '4px 10px', borderRadius: '12px', letterSpacing: '1px' }}>
                      INCOMING CALL RINGING
                    </span>
                    <h2 style={{ fontSize: '1.8rem', fontWeight: 800, margin: '8px 0 4px 0' }}>{activeCall.from}</h2>
                    <div style={{ opacity: 0.9, fontSize: '0.95rem' }}>
                      Target Line: <strong>{activeCall.to}</strong> | Customer: <strong>{activeCall.crmName}</strong>
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '16px' }}>
                  <button onClick={handleAnswer} style={{ background: '#FFFFFF', color: '#047857', border: 'none', padding: '16px 36px', borderRadius: '16px', fontSize: '1.1rem', fontWeight: 800, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px', boxShadow: '0 8px 24px rgba(0,0,0,0.25)' }}>
                    <Phone size={24} /> ACCEPT & SPEAK
                  </button>
                  <button onClick={handleHangup} style={{ background: '#EF4444', color: '#FFFFFF', border: 'none', padding: '16px 28px', borderRadius: '16px', fontSize: '1.1rem', fontWeight: 800, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <PhoneOff size={24} /> DECLINE
                  </button>
                </div>
              </div>
            )}

            {/* ACTIVE CONNECTED CALL & CRM & TRANSCRIPT PANEL */}
            {activeCall && !isRinging && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: '24px', marginBottom: '32px' }}>
                {/* ACTIVE CALL CONTROL BOARD */}
                <div style={{ background: 'rgba(17, 24, 39, 0.9)', backdropFilter: 'blur(20px)', border: '1px solid rgba(16, 185, 129, 0.3)', borderRadius: '24px', padding: '28px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '20px', marginBottom: '24px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                      <div style={{ background: activeCall.isHeld ? '#F59E0B' : '#10B981', width: '52px', height: '52px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#FFF' }}>
                        <PhoneCall size={26} />
                      </div>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <h2 style={{ fontSize: '1.6rem', fontWeight: 800, margin: 0 }}>{activeCall.from}</h2>
                          <span style={{ background: activeCall.isHeld ? 'rgba(245, 158, 11, 0.2)' : activeCall.status === 'BRIDGING' ? 'rgba(59, 130, 246, 0.2)' : 'rgba(16, 185, 129, 0.2)', color: activeCall.isHeld ? '#F59E0B' : activeCall.status === 'BRIDGING' ? '#60A5FA' : '#10B981', padding: '4px 12px', borderRadius: '20px', fontSize: '0.8rem', fontWeight: 700 }}>
                            {activeCall.isHeld ? 'ON HOLD' : activeCall.status === 'BRIDGING' ? 'CONNECTING MEDIA' : 'LIVE CONNECTED'}
                          </span>
                        </div>
                        <span style={{ fontSize: '0.9rem', color: '#9CA3AF' }}>Line: {activeCall.to} | Channel ID: {activeCall.id.slice(0, 14)}</span>
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', height: '24px' }}>
                        {[12, 24, 16, 30, 20, 28, 14].map((h, i) => (
                          <div key={i} style={{ width: '4px', height: activeCall.isHeld ? '6px' : `${h}px`, background: activeCall.isHeld ? '#F59E0B' : '#10B981', borderRadius: '2px', transition: 'height 0.2s ease' }} />
                        ))}
                      </div>
                      <div style={{ fontSize: '2rem', fontWeight: 800, fontFamily: 'monospace', color: activeCall.isHeld ? '#F59E0B' : '#10B981' }}>
                        {activeCall.duration}
                      </div>
                    </div>
                  </div>

                  {/* SOFTPHONE ACTION CONTROLS */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '12px', marginBottom: '24px' }}>
                    <button onClick={handleToggleMute} style={{ background: activeCall.isMuted ? 'rgba(239, 68, 68, 0.25)' : 'rgba(255, 255, 255, 0.08)', color: activeCall.isMuted ? '#EF4444' : '#F3F4F6', border: '1px solid rgba(255, 255, 255, 0.15)', padding: '14px', borderRadius: '14px', fontSize: '0.85rem', fontWeight: 700, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
                      {activeCall.isMuted ? <MicOff size={20} /> : <Mic size={20} />}
                      {activeCall.isMuted ? 'UNMUTE MIC' : 'MUTE MIC'}
                    </button>

                    <button onClick={handleToggleHold} style={{ background: activeCall.isHeld ? 'rgba(245, 158, 11, 0.25)' : 'rgba(255, 255, 255, 0.08)', color: activeCall.isHeld ? '#F59E0B' : '#F3F4F6', border: '1px solid rgba(255, 255, 255, 0.15)', padding: '14px', borderRadius: '14px', fontSize: '0.85rem', fontWeight: 700, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
                      {activeCall.isHeld ? <Play size={20} /> : <Pause size={20} />}
                      {activeCall.isHeld ? 'RESUME' : 'HOLD'}
                    </button>

                    <button onClick={handleToggleRecord} style={{ background: activeCall.isRecording ? 'rgba(239, 68, 68, 0.25)' : 'rgba(255, 255, 255, 0.08)', color: activeCall.isRecording ? '#EF4444' : '#F3F4F6', border: '1px solid rgba(255, 255, 255, 0.15)', padding: '14px', borderRadius: '14px', fontSize: '0.85rem', fontWeight: 700, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
                      <Disc size={20} style={{ color: activeCall.isRecording ? '#EF4444' : 'inherit' }} />
                      {activeCall.isRecording ? 'RECORDING' : 'RECORD'}
                    </button>

                    <button onClick={() => setShowTransferModal(true)} style={{ background: 'rgba(59, 130, 246, 0.15)', color: '#60A5FA', border: '1px solid rgba(59, 130, 246, 0.3)', padding: '14px', borderRadius: '14px', fontSize: '0.85rem', fontWeight: 700, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
                      <ArrowUpRight size={20} />
                      TRANSFER
                    </button>

                    <button onClick={handleHangup} style={{ background: '#EF4444', color: '#FFFFFF', border: 'none', padding: '14px', borderRadius: '14px', fontSize: '0.85rem', fontWeight: 800, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
                      <PhoneOff size={20} />
                      CUT / END
                    </button>
                  </div>

                  {/* REAL-TIME AI TRANSCRIPTION & CUSTOMER NOTES */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                    <div style={{ background: 'rgba(0,0,0,0.3)', padding: '16px', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.06)' }}>
                      <h4 style={{ fontSize: '0.9rem', fontWeight: 700, color: '#60A5FA', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <Bot size={16} /> Live AI Speech-to-Text Stream
                      </h4>
                      <div style={{ fontSize: '0.85rem', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {activeCall.aiTranscript?.map((t, idx) => (
                          <div key={idx} style={{ padding: '6px 10px', borderRadius: '8px', background: t.startsWith('Customer') ? 'rgba(59, 130, 246, 0.15)' : 'rgba(16, 185, 129, 0.15)' }}>
                            {t}
                          </div>
                        ))}
                      </div>
                    </div>

                    <div style={{ background: 'rgba(0,0,0,0.3)', padding: '16px', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.06)' }}>
                      <h4 style={{ fontSize: '0.9rem', fontWeight: 700, color: '#F59E0B', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <FileText size={16} /> Agent Call Notes (Auto-saved to CRM)
                      </h4>
                      <textarea
                        rows={4}
                        placeholder="Type customer call notes here..."
                        value={customerNotes}
                        onChange={(e) => setCustomerNotes(e.target.value)}
                        style={{ width: '100%', background: 'transparent', border: 'none', color: '#FFF', fontSize: '0.85rem', outline: 'none', resize: 'none' }}
                      />
                    </div>
                  </div>
                </div>

                {/* CRM CUSTOMER PROFILE CARD */}
                <div style={{ background: 'rgba(17, 24, 39, 0.8)', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '24px', padding: '24px' }}>
                  <h3 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <User size={18} style={{ color: '#10B981' }} /> CRM Customer Information
                  </h3>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                    <div style={{ background: 'rgba(255,255,255,0.04)', padding: '12px 16px', borderRadius: '12px' }}>
                      <span style={{ fontSize: '0.75rem', color: '#9CA3AF' }}>CUSTOMER NAME</span>
                      <div style={{ fontWeight: 700, fontSize: '1rem', marginTop: '2px' }}>{activeCall.crmName}</div>
                    </div>

                    <div style={{ background: 'rgba(255,255,255,0.04)', padding: '12px 16px', borderRadius: '12px' }}>
                      <span style={{ fontSize: '0.75rem', color: '#9CA3AF' }}>ACCOUNT TIER</span>
                      <div style={{ fontWeight: 700, color: '#10B981', fontSize: '0.95rem', marginTop: '2px' }}>{activeCall.crmTier}</div>
                    </div>

                    <div style={{ background: 'rgba(255,255,255,0.04)', padding: '12px 16px', borderRadius: '12px' }}>
                      <span style={{ fontSize: '0.75rem', color: '#9CA3AF' }}>RECENT TICKET</span>
                      <div style={{ fontWeight: 600, fontSize: '0.9rem', marginTop: '2px' }}>#TICK-8849 - Voicebot DID Inquiry</div>
                    </div>

                    <div style={{ background: 'rgba(255,255,255,0.04)', padding: '12px 16px', borderRadius: '12px' }}>
                      <span style={{ fontSize: '0.75rem', color: '#9CA3AF' }}>AI SENTIMENT SCORE</span>
                      <div style={{ fontWeight: 700, color: '#60A5FA', fontSize: '0.95rem', marginTop: '2px' }}>Positive (0.88)</div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* LOWER PANEL: SOFTPHONE DIALPAD & CALL LOGS */}
            <div style={{ display: 'grid', gridTemplateColumns: '340px 1fr', gap: '32px' }}>
              {/* DIALPAD CARD */}
              <div style={{ background: 'rgba(17, 24, 39, 0.8)', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '24px', padding: '24px' }}>
                <h3 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <PhoneOutgoing size={18} style={{ color: '#10B981' }} /> Direct Outbound Softphone
                </h3>

                <input
                  type="text"
                  placeholder="Enter number (e.g. 9952282829)"
                  value={dialNumber}
                  onChange={(e) => setDialNumber(e.target.value)}
                  style={{ width: '100%', padding: '14px', borderRadius: '12px', border: '1px solid rgba(255, 255, 255, 0.15)', background: '#111827', color: '#FFF', fontSize: '1.1rem', fontWeight: 600, marginBottom: '16px', textAlign: 'center' }}
                />

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '20px' }}>
                  {['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'].map((digit) => (
                    <button key={digit} onClick={() => setDialNumber((prev) => prev + digit)} style={{ background: 'rgba(255, 255, 255, 0.05)', border: '1px solid rgba(255, 255, 255, 0.1)', color: '#FFF', padding: '16px', borderRadius: '12px', fontSize: '1.25rem', fontWeight: 700, cursor: 'pointer' }}>
                      {digit}
                    </button>
                  ))}
                </div>

                <button onClick={handleDialOutbound} style={{ width: '100%', background: '#10B981', color: '#FFF', border: 'none', padding: '14px', borderRadius: '14px', fontSize: '1rem', fontWeight: 800, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', boxShadow: '0 4px 14px rgba(16, 185, 129, 0.3)' }}>
                  <Phone size={20} /> CALL NUMBER
                </button>
              </div>

              {/* RECENT CALL LOGS */}
              <div style={{ background: 'rgba(17, 24, 39, 0.8)', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '24px', padding: '24px' }}>
                <h3 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <History size={18} style={{ color: '#60A5FA' }} /> Recent Call Activity History
                </h3>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {callLogs.map((log, idx) => (
                    <div key={idx} style={{ background: 'rgba(255, 255, 255, 0.03)', border: '1px solid rgba(255, 255, 255, 0.06)', borderRadius: '16px', padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                        <div style={{ background: 'rgba(16, 185, 129, 0.15)', color: '#10B981', padding: '10px', borderRadius: '12px' }}>
                          <PhoneIncoming size={20} />
                        </div>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: '1rem' }}>{log.from}</div>
                          <div style={{ fontSize: '0.85rem', color: '#9CA3AF' }}>Line: {log.to} | Time: {log.timestamp}</div>
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <span style={{ background: 'rgba(16, 185, 129, 0.15)', color: '#10B981', padding: '4px 10px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 700 }}>
                          {log.status}
                        </span>
                        <div style={{ fontSize: '0.9rem', fontWeight: 700, marginTop: '4px', fontFamily: 'monospace' }}>{log.duration}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: TELEPHONY OPERATIONS DASHBOARD */}
        {activeTab === 'dashboard' && (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '20px', marginBottom: '32px' }}>
              {[
                { title: 'Active Live Calls', val: activeCall ? '1' : '0', color: '#10B981', icon: PhoneCall },
                { title: 'Available Agents', val: '5 / 5', color: '#60A5FA', icon: Users },
                { title: 'Calls Waiting in Queue', val: '0', color: '#F59E0B', icon: Clock },
                { title: 'Total Processed Today', val: callLogs.length.toString(), color: '#A855F7', icon: Activity },
              ].map((card, i) => {
                const Icon = card.icon;
                return (
                  <div key={i} style={{ background: 'rgba(17, 24, 39, 0.8)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '20px', padding: '20px', display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <div style={{ background: `${card.color}20`, color: card.color, padding: '14px', borderRadius: '14px' }}>
                      <Icon size={24} />
                    </div>
                    <div>
                      <div style={{ fontSize: '0.85rem', color: '#9CA3AF' }}>{card.title}</div>
                      <div style={{ fontSize: '1.6rem', fontWeight: 800, marginTop: '2px' }}>{card.val}</div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* SYSTEM HEALTH STATUS */}
            <div style={{ background: 'rgba(17, 24, 39, 0.8)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '24px', padding: '24px' }}>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Server size={18} style={{ color: '#10B981' }} /> System Microservices Health
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
                {[
                  { name: 'Asterisk ARI Engine (8088)', status: 'HEALTHY', latency: '2ms' },
                  { name: 'PostgreSQL Database (5432)', status: 'HEALTHY', latency: '1ms' },
                  { name: 'Redis Event PubSub (6379)', status: 'HEALTHY', latency: '1ms' },
                  { name: 'API Gateway (3000)', status: 'HEALTHY', latency: '3ms' },
                  { name: 'Speech-to-Text PCM Pipeline', status: 'HEALTHY', latency: '18ms' },
                  { name: 'Text-to-Speech Audio Engine', status: 'HEALTHY', latency: '24ms' },
                ].map((s, idx) => (
                  <div key={idx} style={{ background: 'rgba(255,255,255,0.03)', padding: '16px', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.06)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>{s.name}</span>
                      <span style={{ background: 'rgba(16, 185, 129, 0.15)', color: '#10B981', padding: '2px 8px', borderRadius: '10px', fontSize: '0.75rem', fontWeight: 700 }}>
                        {s.status}
                      </span>
                    </div>
                    <div style={{ fontSize: '0.8rem', color: '#9CA3AF', marginTop: '8px' }}>Latency: {s.latency}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: QUEUES & AGENTS */}
        {activeTab === 'queues' && (
          <div style={{ background: 'rgba(17, 24, 39, 0.8)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '24px', padding: '24px' }}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '20px' }}>ACD Call Queues & Agent Assignments</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {[
                { name: 'Customer Support Queue', ext: '8001', strategy: 'round-robin', members: '1001, 1002, 1003', waiting: 0 },
                { name: 'Sales & Billing Queue', ext: '8002', strategy: 'least-recent', members: '1004, 1005', waiting: 0 },
              ].map((q, i) => (
                <div key={i} style={{ background: 'rgba(255,255,255,0.03)', padding: '20px', borderRadius: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <h4 style={{ fontSize: '1.1rem', fontWeight: 700 }}>{q.name} (Ext: {q.ext})</h4>
                    <div style={{ fontSize: '0.85rem', color: '#9CA3AF', marginTop: '4px' }}>Strategy: {q.strategy} | Assigned Agents: {q.members}</div>
                  </div>
                  <span style={{ background: 'rgba(16, 185, 129, 0.15)', color: '#10B981', padding: '6px 14px', borderRadius: '12px', fontWeight: 700 }}>
                    {q.waiting} Callers Waiting
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB 4: AI VOICEBOT CONFIGURATION */}
        {activeTab === 'voicebot' && (
          <div style={{ background: 'rgba(17, 24, 39, 0.8)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '24px', padding: '24px' }}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Bot size={20} style={{ color: '#00F2FE' }} /> AI Conversational Voicebot Setup
            </h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div>
                <label style={{ fontSize: '0.85rem', color: '#9CA3AF', fontWeight: 700, display: 'block', marginBottom: '8px' }}>SYSTEM AGENT PROMPT</label>
                <textarea
                  rows={4}
                  value={botPrompt}
                  onChange={(e) => setBotPrompt(e.target.value)}
                  style={{ width: '100%', padding: '14px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.15)', background: '#111827', color: '#FFF', fontSize: '0.9rem' }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                <div>
                  <label style={{ fontSize: '0.85rem', color: '#9CA3AF', fontWeight: 700, display: 'block', marginBottom: '8px' }}>STT MODEL ENGINE</label>
                  <input type="text" value={sttModel} onChange={(e) => setSttModel(e.target.value)} style={{ width: '100%', padding: '12px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.15)', background: '#111827', color: '#FFF' }} />
                </div>
                <div>
                  <label style={{ fontSize: '0.85rem', color: '#9CA3AF', fontWeight: 700, display: 'block', marginBottom: '8px' }}>TTS NEURAL VOICE</label>
                  <input type="text" value={ttsVoice} onChange={(e) => setTtsVoice(e.target.value)} style={{ width: '100%', padding: '12px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.15)', background: '#111827', color: '#FFF' }} />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 5: CALL HISTORY */}
        {activeTab === 'history' && (
          <div style={{ background: 'rgba(17, 24, 39, 0.8)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '24px', padding: '24px' }}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '20px' }}>Call History & Analytics</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {callLogs.map((log, idx) => (
                <div key={idx} style={{ background: 'rgba(255,255,255,0.03)', padding: '16px', borderRadius: '14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>{log.from} → {log.to}</div>
                    <div style={{ fontSize: '0.85rem', color: '#9CA3AF', marginTop: '4px' }}>ID: {log.id} | Timestamp: {log.timestamp}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <span style={{ background: 'rgba(16,185,129,0.15)', color: '#10B981', padding: '4px 10px', borderRadius: '10px', fontSize: '0.8rem', fontWeight: 700 }}>{log.status}</span>
                    <div style={{ fontWeight: 700, marginTop: '4px', fontFamily: 'monospace' }}>{log.duration}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB 6: REAL-TIME EVENT STREAM MONITOR */}
        {activeTab === 'events' && (
          <div style={{ background: 'rgba(17, 24, 39, 0.8)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '24px', padding: '24px' }}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Zap size={20} style={{ color: '#F59E0B' }} /> Real-Time Telephony Event Stream Monitor
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '500px', overflowY: 'auto' }}>
              {eventStream.length === 0 ? (
                <div style={{ color: '#9CA3AF', textAlign: 'center', padding: '32px' }}>Listening for live WebSocket events...</div>
              ) : (
                eventStream.map((ev) => (
                  <div key={ev.id} style={{ background: 'rgba(0,0,0,0.3)', padding: '10px 14px', borderRadius: '10px', fontSize: '0.85rem', fontFamily: 'monospace', display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: '#10B981', fontWeight: 700 }}>[{ev.timestamp}] {ev.event}</span>
                    <span style={{ color: '#9CA3AF' }}>{ev.details}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </main>

      {/* 3. TRANSFER MODAL POPUP */}
      {showTransferModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#1F2937', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '24px', padding: '32px', width: '400px' }}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '8px' }}>Transfer Live Call</h3>
            <p style={{ fontSize: '0.875rem', color: '#9CA3AF', marginBottom: '20px' }}>Enter the target extension or SIP endpoint to redirect this call.</p>
            <input type="text" placeholder="e.g. 1002 or 1003" value={transferExt} onChange={(e) => setTransferExt(e.target.value)} style={{ width: '100%', padding: '14px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.2)', background: '#111827', color: '#FFF', fontSize: '1rem', marginBottom: '24px' }} />
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button onClick={() => setShowTransferModal(false)} style={{ background: 'transparent', color: '#9CA3AF', border: '1px solid rgba(255,255,255,0.15)', padding: '10px 20px', borderRadius: '12px', cursor: 'pointer', fontWeight: 600 }}>Cancel</button>
              <button onClick={handleTransferSubmit} style={{ background: '#3B82F6', color: '#FFF', border: 'none', padding: '10px 24px', borderRadius: '12px', fontWeight: 700, cursor: 'pointer' }}>Complete Transfer</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
