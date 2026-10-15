import React from 'react';
import { AgentsTable, Agent } from '../components/AgentsTable';

interface AgentsPageProps {
  agents: Agent[];
}

export const AgentsPage: React.FC<AgentsPageProps> = ({ agents }) => {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div className="card-header" style={{ marginBottom: 0 }}>
        <h2>Agent & Extension Management</h2>
        <button style={{ background: 'linear-gradient(135deg, var(--accent-cyan), var(--accent-blue))', color: '#0a0d14', fontWeight: 600, border: 'none', padding: '10px 18px', borderRadius: '10px', cursor: 'pointer' }}>
          + Provision New Agent
        </button>
      </div>

      <AgentsTable agents={agents} />
    </div>
  );
};
