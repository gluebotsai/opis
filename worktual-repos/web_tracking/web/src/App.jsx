import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, ProtectedRoute } from './AuthContext';
import { CoWorkerProvider } from './context/CoWorkerContext';
import CoWorkerRouteSync from './components/CoWorkerRouteSync';
import Dashboard from './pages/Dashboard';
import Visitors from './pages/Visitors';
import VisitorDetail from './pages/VisitorDetail';
import Login from './pages/Login';
import AuthCallback from './pages/AuthCallback';
import Admin from './pages/Admin';
import Sessions from './pages/Sessions';
import SessionReplay from './pages/SessionReplay';
import Behavior from './pages/Behavior';
import Forms from './pages/Forms';
import ProductAnalytics from './pages/ProductAnalytics';
import Performance from './pages/Performance';
import Errors from './pages/Errors';
import Analytics from './pages/Analytics';
import CoWorker from './pages/CoWorker';

export default function App() {
  return (
    <AuthProvider>
      <CoWorkerProvider>
        <CoWorkerRouteSync />
        <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
        <Route path="/visitors" element={<ProtectedRoute><Visitors /></ProtectedRoute>} />
        <Route path="/visitors/:visitorId" element={<ProtectedRoute><VisitorDetail /></ProtectedRoute>} />
        <Route path="/sessions" element={<ProtectedRoute><Sessions /></ProtectedRoute>} />
        <Route path="/sessions/:sessionId/replay" element={<ProtectedRoute><SessionReplay /></ProtectedRoute>} />
        <Route path="/behavior" element={<ProtectedRoute><Behavior /></ProtectedRoute>} />
        <Route path="/forms" element={<ProtectedRoute><Forms /></ProtectedRoute>} />
        <Route path="/product-analytics" element={<ProtectedRoute><ProductAnalytics /></ProtectedRoute>} />
        <Route path="/performance" element={<ProtectedRoute><Performance /></ProtectedRoute>} />
        <Route path="/errors" element={<ProtectedRoute><Errors /></ProtectedRoute>} />
        <Route path="/admin" element={<ProtectedRoute><Admin /></ProtectedRoute>} />
        <Route path="/analytics" element={<ProtectedRoute><Analytics /></ProtectedRoute>} />
        <Route path="/co-worker" element={<ProtectedRoute><CoWorker /></ProtectedRoute>} />
        <Route path="/chat" element={<ProtectedRoute><Navigate to="/co-worker" replace /></ProtectedRoute>} />
        <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </CoWorkerProvider>
    </AuthProvider>
  );
}
