import React from 'react';
import { Play, Download } from 'lucide-react';

export const RecordingsPage: React.FC = () => {
  const recordings = [
    { id: 'rec-1', callId: 'call-101', caller: '1001', callee: '1002', duration: '01:45', date: '2026-08-01 18:30', url: '/recordings/rec-101.wav' },
    { id: 'rec-2', callId: 'call-098', caller: '+1234567890', callee: '1001', duration: '03:12', date: '2026-08-01 17:15', url: '/recordings/rec-098.wav' },
  ];

  return (
    <div className="card">
      <div className="card-header">
        <h2>Call Recording Player & Archives</h2>
      </div>

      <table className="table">
        <thead>
          <tr>
            <th>Call ID</th>
            <th>Caller</th>
            <th>Destination</th>
            <th>Duration</th>
            <th>Timestamp</th>
            <th>Player & Download</th>
          </tr>
        </thead>
        <tbody>
          {recordings.map((rec) => (
            <tr key={rec.id}>
              <td style={{ fontFamily: 'monospace' }}>{rec.callId}</td>
              <td>{rec.caller}</td>
              <td>{rec.callee}</td>
              <td>{rec.duration}</td>
              <td>{rec.date}</td>
              <td style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <button style={{ background: 'rgba(79, 172, 254, 0.2)', color: 'var(--accent-blue)', border: '1px solid rgba(79, 172, 254, 0.4)', padding: '6px 12px', borderRadius: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Play size={14} /> Play
                </button>
                <button style={{ background: 'rgba(255, 255, 255, 0.08)', color: 'var(--text-primary)', border: '1px solid var(--border-color)', padding: '6px 12px', borderRadius: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Download size={14} /> Download
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
