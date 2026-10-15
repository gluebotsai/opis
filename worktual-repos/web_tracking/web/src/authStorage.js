/** Shared login session helpers (token in localStorage). */

let logoutHandler = null;

export function registerLogoutHandler(handler) {
  logoutHandler = handler;
}

export function isTokenExpired(token) {
  if (!token) return true;
  try {
    const payload = JSON.parse(
      atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')),
    );
    if (!payload.exp) return false;
    return Date.now() >= payload.exp * 1000;
  } catch {
    return true;
  }
}

export function getStoredToken() {
  return localStorage.getItem('token');
}

export function hasValidSession() {
  const token = getStoredToken();
  const user = localStorage.getItem('user');
  return Boolean(token && user && !isTokenExpired(token));
}

export function clearAuthSession() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  logoutHandler?.();
}

export function redirectToLogin() {
  if (window.location.pathname !== '/login') {
    window.location.href = '/login';
  }
}
