export function getCookie(name) {
  try {
    const cookies = document.cookie ? document.cookie.split('; ') : [];
    const cookie = cookies.find((row) => row.startsWith(`${name}=`));
    if (!cookie) return null;
    try {
      return decodeURIComponent(cookie.split('=').slice(1).join('='));
    } catch {
      return cookie.split('=').slice(1).join('=') || null;
    }
  } catch {
    return null;
  }
}

export function setCookie(name, value, days = 365) {
  const expires = new Date(Date.now() + days * 864e5).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; expires=${expires}; SameSite=Lax`;
}

export function getStorage(key, storage = 'local') {
  try {
    const store = storage === 'session' ? sessionStorage : localStorage;
    return store.getItem(key);
  } catch {
    return null;
  }
}

export function setStorage(key, value, storage = 'local') {
  try {
    const store = storage === 'session' ? sessionStorage : localStorage;
    store.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function removeStorage(key, storage = 'local') {
  try {
    const store = storage === 'session' ? sessionStorage : localStorage;
    store.removeItem(key);
  } catch {
    /* ignore */
  }
}
