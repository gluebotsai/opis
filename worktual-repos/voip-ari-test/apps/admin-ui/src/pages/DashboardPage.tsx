import React from 'react';
import { PhoneCall, Users, Layers, PhoneIncoming } from 'lucide-react';
import { MetricCard } from '../components/MetricCard';
import { ActiveCallsTable, ActiveCall } from '../components/ActiveCallsTable';
import { AgentsTable, Agent } from '../components/AgentsTable';

interface DashboardPageProps {
  activeCalls: ActiveCall[];
  agents: Agent[];
  totalCallsToday?: number;
  onAnswerCall?: (callId: string) => void;
  onHangupCall?: (callId: string) => void;
  onToggleHold?: (callId: string, currentHeld: boolean) => void;
  onToggleMute?: (callId: string, currentMuted: boolean) => void;
  onTransferCall?: (callId: string, targetExt: string) => void;
}

export const DashboardPage: React.FC<DashboardPageProps> = ({
  activeCalls,
  agents,
  totalCallsToday = 0,
  onAnswerCall,
  onHangupCall,
  onToggleHold,
  onToggleMute,
  onTransferCall,
}) => {
  const ringingCount = activeCalls.filter((c) => c.status === 'RINGING').length;

  return (
    <>
      {/* Metrics Section */}
      <section className="metrics-grid">
        <MetricCard title="Active Live Calls" value={activeCalls.length} icon={<PhoneCall size={24} />} />
        <MetricCard
          title="Ringing Inbound"
          value={ringingCount}
          icon={<PhoneIncoming size={24} />}
          iconColor={ringingCount > 0 ? '#F59E0B' : 'var(--status-green)'}
        />
        <MetricCard
          title="Available Agents"
          value={agents.filter((a) => a.status === 'AVAILABLE').length}
          icon={<Users size={24} />}
          iconColor="var(--status-green)"
        />
        <MetricCard
          title="Total Processed"
          value={totalCallsToday}
          icon={<Layers size={24} />}
          iconColor="var(--accent-purple)"
        />
      </section>

      {/* Tables Section */}
      <ActiveCallsTable
        calls={activeCalls}
        onAnswer={onAnswerCall}
        onHangup={onHangupCall}
        onToggleHold={onToggleHold}
        onToggleMute={onToggleMute}
        onTransfer={onTransferCall}
      />
      <AgentsTable agents={agents} />
    </>
  );
};
