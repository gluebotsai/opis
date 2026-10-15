import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import {
  clearAuthSession,
  hasValidSession,
  registerLogoutHandler,
} from './authStorage';
import {
  clearDevUiPreviewSession,
  isDevUiPreviewSession,
  markDevUiPreviewSession,
} from './devPreview';
import { rotateChatSessionId } from './chat/session';
import { getAccount, selectWebsite as apiSelectWebsite } from './api';

const AuthContext = createContext(null);

function buildUserFromAuth(data) {
  return {
    admin_name: data.admin_name,
    email: data.email,
    organization_id: data.organization_id ?? null,
    website_id: data.website_id,
    website_url: data.website_url,
    site_type: data.site_type || 'other',
    business_type: data.business_type ?? null,
    features: data.features || { product_analytics: false, conversions: true, forms: true },
    websites: data.websites || [],
  };
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    if (isDevUiPreviewSession()) {
      const stored = localStorage.getItem('user');
      return stored ? JSON.parse(stored) : null;
    }
    if (!hasValidSession()) {
      clearAuthSession();
      return null;
    }
    const stored = localStorage.getItem('user');
    return stored ? JSON.parse(stored) : null;
  });

  useEffect(() => {
    registerLogoutHandler(() => setUser(null));
    return () => registerLogoutHandler(null);
  }, []);

  /** Refresh features/site_type from org business_type (PostgreSQL); stale localStorage after API deploy. */
  useEffect(() => {
    if (isDevUiPreviewSession() || !hasValidSession()) return;
    getAccount()
      .then((res) => {
        const data = res.data;
        if (!data?.features) return;
        setUser((prev) => {
          if (!prev) return prev;
          const next = {
            ...prev,
            site_type: data.site_type ?? prev.site_type,
            business_type: data.business_type ?? prev.business_type,
            features: data.features ?? prev.features,
          };
          localStorage.setItem('user', JSON.stringify(next));
          return next;
        });
      })
      .catch(() => {});
  }, []);

  const persistSession = (data) => {
    localStorage.setItem('token', data.token);
    const userData = buildUserFromAuth(data);
    localStorage.setItem('user', JSON.stringify(userData));
    rotateChatSessionId();
    setUser(userData);
  };

  const login = (data) => {
    if (data.token === 'dev-ui-preview-token') {
      markDevUiPreviewSession();
    } else {
      clearDevUiPreviewSession();
    }
    persistSession(data);
  };

  const selectWebsite = useCallback(async (websiteId) => {
    const data = await apiSelectWebsite(websiteId);
    persistSession(data);
    return data;
  }, []);

  const logout = () => {
    clearDevUiPreviewSession();
    clearAuthSession();
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, selectWebsite, isAuthenticated: !!user }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);

export function ProtectedRoute({ children }) {
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated && !isDevUiPreviewSession()) {
    window.location.href = '/login';
    return null;
  }
  return children;
}
