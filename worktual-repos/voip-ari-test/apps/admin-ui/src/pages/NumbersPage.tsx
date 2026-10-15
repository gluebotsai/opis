import React, { useState } from 'react';
import { Phone, Plus, Trash2, CheckCircle2 } from 'lucide-react';

export interface PhoneNumberItem {
  id: string;
  number: string;
  provider: string;
  assignedTo?: string;
  routeTo?: string;
  callerId?: string;
}

export const NumbersPage: React.FC = () => {
  const [numbers, setNumbers] = useState<PhoneNumberItem[]>([
    { id: 'num-1', number: '+18005550199', provider: 'AIRTEL', assignedTo: '1001 (Agent 1)', routeTo: 'Support Queue', callerId: '+18005550199' },
    { id: 'num-2', number: '+18005550200', provider: 'AIRTEL', assignedTo: '1002 (Agent 2)', routeTo: 'Sales Queue', callerId: '+18005550200' },
  ]);

  const [showModal, setShowModal] = useState(false);
  const [newNumber, setNewNumber] = useState('');
  const [provider, setProvider] = useState('AIRTEL');
  const [assignedTo, setAssignedTo] = useState('');
  const [routeTo, setRouteTo] = useState('');

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNumber) return;
    const item: PhoneNumberItem = {
      id: `num-${Date.now()}`,
      number: newNumber,
      provider,
      assignedTo: assignedTo || undefined,
      routeTo: routeTo || undefined,
      callerId: newNumber,
    };
    setNumbers([...numbers, item]);
    setNewNumber('');
    setAssignedTo('');
    setRouteTo('');
    setShowModal(false);
  };

  const handleDelete = (id: string) => {
    setNumbers(numbers.filter((n) => n.id !== id));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--text-primary)' }}>
            DID Phone Numbers
          </h2>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
            Provision and manage inbound DID numbers, provider trunks, and call routing targets
          </p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '10px 16px',
            backgroundColor: 'var(--accent-color)',
            color: '#fff',
            border: 'none',
            borderRadius: '6px',
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          <Plus size={16} />
          <span>Provision DID Number</span>
        </button>
      </div>

      <div style={{ backgroundColor: 'var(--card-bg)', borderRadius: '12px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.875rem' }}>
          <thead>
            <tr style={{ backgroundColor: 'rgba(255,255,255,0.03)', borderBottom: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}>
              <th style={{ padding: '14px 16px' }}>Phone Number</th>
              <th style={{ padding: '14px 16px' }}>Trunk Provider</th>
              <th style={{ padding: '14px 16px' }}>Assigned Extension</th>
              <th style={{ padding: '14px 16px' }}>Inbound Route</th>
              <th style={{ padding: '14px 16px' }}>Status</th>
              <th style={{ padding: '14px 16px', textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {numbers.map((num) => (
              <tr key={num.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                <td style={{ padding: '14px 16px', fontWeight: 600, color: 'var(--text-primary)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Phone size={16} style={{ color: 'var(--accent-color)' }} />
                    <span>{num.number}</span>
                  </div>
                </td>
                <td style={{ padding: '14px 16px', color: 'var(--text-secondary)' }}>{num.provider}</td>
                <td style={{ padding: '14px 16px', color: 'var(--text-primary)' }}>{num.assignedTo || 'Unassigned'}</td>
                <td style={{ padding: '14px 16px', color: 'var(--text-primary)' }}>{num.routeTo || 'Default Dialplan'}</td>
                <td style={{ padding: '14px 16px' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '4px 10px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 500, backgroundColor: 'rgba(34, 197, 94, 0.1)', color: '#22c55e' }}>
                    <CheckCircle2 size={12} />
                    Active
                  </span>
                </td>
                <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                  <button
                    onClick={() => handleDelete(num.id)}
                    style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '6px' }}
                    title="Delete Number"
                  >
                    <Trash2 size={16} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ backgroundColor: 'var(--card-bg)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '24px', width: '400px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-primary)' }}>Provision DID Number</h3>
            <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Phone Number (E.164)</label>
                <input
                  type="text"
                  placeholder="+18005550199"
                  value={newNumber}
                  onChange={(e) => setNewNumber(e.target.value)}
                  style={{ width: '100%', padding: '10px', backgroundColor: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', borderRadius: '6px', color: 'var(--text-primary)' }}
                  required
                />
              </div>
              <div>
                <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Provider</label>
                <select
                  value={provider}
                  onChange={(e) => setProvider(e.target.value)}
                  style={{ width: '100%', padding: '10px', backgroundColor: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', borderRadius: '6px', color: 'var(--text-primary)' }}
                >
                  <option value="AIRTEL">AIRTEL SIP Trunk</option>
                  <option value="TWILIO">TWILIO</option>
                  <option value="GENERIC_SIP">Generic SIP Provider</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Assigned Extension</label>
                <input
                  type="text"
                  placeholder="1001"
                  value={assignedTo}
                  onChange={(e) => setAssignedTo(e.target.value)}
                  style={{ width: '100%', padding: '10px', backgroundColor: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', borderRadius: '6px', color: 'var(--text-primary)' }}
                />
              </div>
              <div>
                <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Inbound Route</label>
                <input
                  type="text"
                  placeholder="Support Queue"
                  value={routeTo}
                  onChange={(e) => setRouteTo(e.target.value)}
                  style={{ width: '100%', padding: '10px', backgroundColor: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', borderRadius: '6px', color: 'var(--text-primary)' }}
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '12px' }}>
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  style={{ padding: '8px 14px', backgroundColor: 'transparent', border: '1px solid var(--border-color)', borderRadius: '6px', color: 'var(--text-secondary)', cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  style={{ padding: '8px 14px', backgroundColor: 'var(--accent-color)', border: 'none', borderRadius: '6px', color: '#fff', fontWeight: 500, cursor: 'pointer' }}
                >
                  Save Number
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
