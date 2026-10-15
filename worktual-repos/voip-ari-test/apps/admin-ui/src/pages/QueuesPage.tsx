import React from 'react';

export const QueuesPage: React.FC = () => {
  const queues = [
    { id: 'q-1', name: 'Support Queue', strategy: 'ringall', membersCount: 3, waitingCalls: 1 },
    { id: 'q-2', name: 'Sales Queue', strategy: 'random', membersCount: 2, waitingCalls: 0 },
  ];

  return (
    <div className="card">
      <div className="card-header">
        <h2>Automatic Call Distribution (ACD) Queues</h2>
        <button style={{ background: 'linear-gradient(135deg, var(--accent-cyan), var(--accent-blue))', color: '#0a0d14', fontWeight: 600, border: 'none', padding: '10px 18px', borderRadius: '10px', cursor: 'pointer' }}>
          + Create Queue
        </button>
      </div>

      <table className="table">
        <thead>
          <tr>
            <th>Queue Name</th>
            <th>Routing Strategy</th>
            <th>Active Members</th>
            <th>Waiting Calls</th>
          </tr>
        </thead>
        <tbody>
          {queues.map((queue) => (
            <tr key={queue.id}>
              <td>{queue.name}</td>
              <td style={{ fontFamily: 'monospace' }}>{queue.strategy}</td>
              <td>{queue.membersCount} agents</td>
              <td>
                <span className={`badge ${queue.waitingCalls > 0 ? 'badge-warning' : 'badge-success'}`}>
                  {queue.waitingCalls} waiting
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
