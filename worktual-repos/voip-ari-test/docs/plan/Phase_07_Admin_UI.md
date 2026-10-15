# Phase 7: Admin UI Portal

## 1. Overview
A modern, dark-themed React single-page application located in `apps/admin-ui`. It provides real-time monitoring and administrative tools for multi-tenant platform management.

---

## 2. Architecture & Modules Layout
```text
apps/admin-ui/
├── src/
│   ├── components/
│   │   ├── ActiveCallsGrid.tsx
│   │   ├── AgentStatusBadge.tsx
│   │   ├── AudioPlayer.tsx
│   │   └── MetricCard.tsx
│   ├── pages/
│   │   ├── Dashboard.tsx
│   │   ├── AgentsPage.tsx
│   │   ├── QueuesPage.tsx
│   │   ├── RecordingsPage.tsx
│   │   └── SettingsPage.tsx
│   ├── services/
│   │   ├── api.ts
│   │   └── socket.ts
│   └── App.tsx
```

---

## 3. Key UI Pages

### 3.1 Live Dashboard (`Dashboard.tsx`)
- Displays live KPI cards: **Active Calls**, **Available Agents**, **Waiting in Queue**, **Total Today**.
- **Real-Time Active Calls Table**: Connects to `EventsGateway` via Socket.io to live-update ongoing call durations, ringing states, and hold states without page reloads.

### 3.2 Call Recordings Player (`RecordingsPage.tsx`)
- Displays filterable list of call history entries.
- Includes embedded HTML5 audio player for stream listening and one-click file download.

---

## 4. Verification Steps
1. Start dev server: `npm run dev -w apps/admin-ui`.
2. Open `http://localhost:5173` in browser.
3. Originate a call using API Gateway and observe the Live Calls table auto-update in real time on the Dashboard.
