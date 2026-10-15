import React from 'react';

export interface Agent {
  id: string;
  name: string;
  extension: string;
  status: 'AVAILABLE' | 'BUSY' | 'ON_BREAK' | 'OFFLINE';
}

interface AgentsTableProps {
  agents: Agent[];
}

export const AgentsTable: React.FC<AgentsTableProps> = ({ agents }) => {
  return (
    <div className="card">
      <div className="card-header">
        <h2>Linphone Agents & Extensions Status</h2>
      </div>

      <table className="table">
        <thead>
          <tr>
            <th>Agent Name</th>
            <th>SIP Extension</th>
            <th>Presence Status</th>
          </tr>
        </thead>
        <tbody>
          {agents.map((agent) => (
            <tr key={agent.id}>
              <td>{agent.name}</td>
              <td style={{ fontFamily: 'monospace' }}>{agent.extension}</td>
              <td>
                <span className={`badge ${agent.status === 'AVAILABLE' ? 'badge-success' : agent.status === 'BUSY' ? 'badge-warning' : 'badge-danger'}`}>
                  {agent.status}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
