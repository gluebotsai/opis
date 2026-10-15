import React from 'react';

export const SettingsPage: React.FC = () => {
  return (
    <div className="card">
      <div className="card-header">
        <h2>Tenant & Platform Configuration</h2>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '600px' }}>
        <div>
          <label style={{ display: 'block', color: 'var(--text-secondary)', marginBottom: '6px' }}>Default Music On Hold (MOH)</label>
          <input type="text" defaultValue="default" style={{ width: '100%', background: 'rgba(255, 255, 255, 0.05)', border: '1px solid var(--border-color)', padding: '10px', borderRadius: '8px', color: '#fff' }} />
        </div>

        <div>
          <label style={{ display: 'block', color: 'var(--text-secondary)', marginBottom: '6px' }}>Recording Policy</label>
          <select style={{ width: '100%', background: 'rgba(255, 255, 255, 0.05)', border: '1px solid var(--border-color)', padding: '10px', borderRadius: '8px', color: '#fff' }}>
            <option value="always">Always Record Outbound & Inbound Calls</option>
            <option value="on_demand">On-Demand Recording Only</option>
            <option value="disabled">Disabled</option>
          </select>
        </div>

        <div>
          <label style={{ display: 'block', color: 'var(--text-secondary)', marginBottom: '6px' }}>SIP Trunking Provider</label>
          <input type="text" defaultValue="Airtel Enterprise SIP Trunk" disabled style={{ width: '100%', background: 'rgba(255, 255, 255, 0.05)', border: '1px solid var(--border-color)', padding: '10px', borderRadius: '8px', color: 'var(--text-secondary)' }} />
        </div>

        <button style={{ width: 'fit-content', background: 'linear-gradient(135deg, var(--accent-cyan), var(--accent-blue))', color: '#0a0d14', fontWeight: 600, border: 'none', padding: '10px 24px', borderRadius: '10px', cursor: 'pointer' }}>
          Save Configuration
        </button>
      </div>
    </div>
  );
};
