import React from 'react';
import { Activity, Users, Layers, Phone, Mic, Settings, Server } from 'lucide-react';

interface MainLayoutProps {
  children: React.ReactNode;
  activeTab: string;
  setActiveTab: (tab: any) => void;
  socketConnected: boolean;
}

export const MainLayout: React.FC<MainLayoutProps> = ({
  children,
  activeTab,
  setActiveTab,
  socketConnected,
}) => {
  return (
    <div className="app-container">
      {/* Sidebar Navigation */}
      <aside className="sidebar">
        <div className="brand">
          <Server size={28} />
          <span>Telephony Admin</span>
        </div>

        <nav className="nav-menu">
          <div
            className={`nav-item ${activeTab === 'dashboard' ? 'active' : ''}`}
            onClick={() => setActiveTab('dashboard')}
          >
            <Activity size={18} />
            <span>Live Dashboard</span>
          </div>

          <div
            className={`nav-item ${activeTab === 'agents' ? 'active' : ''}`}
            onClick={() => setActiveTab('agents')}
          >
            <Users size={18} />
            <span>Agents & Extensions</span>
          </div>

          <div
            className={`nav-item ${activeTab === 'queues' ? 'active' : ''}`}
            onClick={() => setActiveTab('queues')}
          >
            <Layers size={18} />
            <span>ACD Queues</span>
          </div>

          <div
            className={`nav-item ${activeTab === 'numbers' ? 'active' : ''}`}
            onClick={() => setActiveTab('numbers')}
          >
            <Phone size={18} />
            <span>DID Numbers</span>
          </div>

          <div
            className={`nav-item ${activeTab === 'recordings' ? 'active' : ''}`}
            onClick={() => setActiveTab('recordings')}
          >
            <Mic size={18} />
            <span>Call Recordings</span>
          </div>

          <div
            className={`nav-item ${activeTab === 'settings' ? 'active' : ''}`}
            onClick={() => setActiveTab('settings')}
          >
            <Settings size={18} />
            <span>Settings</span>
          </div>
        </nav>
      </aside>

      {/* Main Container */}
      <main className="main-content">
        <header className="header">
          <div>
            <h1 className="title">Platform Operations Dashboard</h1>
            <p style={{ color: 'var(--text-secondary)', marginTop: '4px' }}>
              Real-time Asterisk Stasis ARI & Event Pipeline Monitor
            </p>
          </div>

          <div className={`badge ${socketConnected ? 'badge-success' : 'badge-danger'}`}>
            <span className="pulse-dot" />
            <span>{socketConnected ? 'WebSocket Live' : 'Connecting to Platform...'}</span>
          </div>
        </header>

        {children}
      </main>
    </div>
  );
};
