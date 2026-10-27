import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { API_BASE, apiGet, apiPost } from '../lib/api';
import { APP_ID, APPS_META } from '../lib/appConfig.js';
import { useLanguage } from './LanguageContext.jsx';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const { t, tf } = useLanguage();
  const [user, setUser] = useState(() => {
    const raw = localStorage.getItem('sg_user');
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (_) {
      // Corrupted/incompatible stored value — treat as logged out rather
      // than crashing the entire app before it can even render a login
      // screen to recover from.
      localStorage.removeItem('sg_user');
      localStorage.removeItem('sg_token');
      return null;
    }
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  // The current user's OWN effective permissions (page access + actions),
  // fetched once after login. Admins get everything true without a network
  // round-trip since the backend already special-cases that, but we still
  // fetch for consistency (cheap, cached for the session).
  const [permissions, setPermissions] = useState(null);

  const loadPermissions = useCallback(() => {
    apiGet('/auth/my-permissions').then(setPermissions).catch(() => setPermissions({}));
  }, []);

  useEffect(() => {
    if (user) loadPermissions();
    else setPermissions(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Admin implicitly passes every check even if the permissions fetch
  // hasn't resolved yet (avoids a flash of "access denied" for admins on
  // first paint) — everyone else waits for the real data.
  const can = useCallback((key) => {
    if (user?.role === 'admin') return true;
    if (!permissions) return false;
    return !!permissions[key];
  }, [user, permissions]);

  const login = useCallback(async (username, password) => {
    setError('');
    setLoading(true);
    let res;
    try {
      res = await fetch(API_BASE + '/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, app: APP_ID })
      });
    } catch (networkErr) {
      // fetch() itself threw — this means the request never reached the
      // server at all (CORS block, DNS/offline, or a browser extension
      // interfering with fetch). This is NOT the same as wrong credentials,
      // so don't show the generic "wrong password" text for it.
      console.error('Login request failed before reaching the server:', networkErr);
      setLoading(false);
      const msg = tf('msg.loginnetworkfail', { err: networkErr.message });
      setError(msg);
      throw networkErr;
    }
    try {
      if (!res.ok) {
        throw new Error(t('msg.loginfail'));
      }
      const data = await res.json();
      // Matches backend/app/schemas/auth.py TokenResponse exactly — it's a
      // flat object (no nested "user" key), so we build our own user object.
      const loggedInUser = {
        id: data.user_id,
        username: data.username,
        name: data.full_name,
        role: data.role,
        avatar: data.avatar,
        mustChangePassword: data.must_change_password,
        apps: data.apps || [APP_ID],
      };
      localStorage.setItem('sg_token', data.access_token);
      localStorage.setItem('sg_user', JSON.stringify(loggedInUser));
      setUser(loggedInUser);
      return loggedInUser;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('sg_token');
    localStorage.removeItem('sg_user');
    setUser(null);
  }, []);

  const setUserLocal = useCallback((partial) => {
    setUser(prev => {
      const merged = { ...prev, ...partial };
      localStorage.setItem('sg_user', JSON.stringify(merged));
      return merged;
    });
  }, []);

  // After any (re)load: re-read WHO I am from the server (never trust the stored/handed-over copy) and which apps this
  // username can open — an admin may have granted or removed access since the last login.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    Promise.all([apiGet('/auth/me'), apiGet('/auth/apps')]).then(([me, a]) => {
      if (cancelled) return;
      setUserLocal({ id: me.id, username: me.username, name: me.full_name, role: me.role, avatar: me.avatar, apps: a.apps });
    }).catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Switch to the other app: the server issues a token for that app's own account (same username, that app's role),
  // no password needed. The other site is opened with the token in the address hash (never sent to any server).
  const switchApp = useCallback(async (target) => {
    const data = await apiPost('/auth/switch', { app: target });
    const u = {
      id: data.user_id, username: data.username, name: data.full_name, role: data.role,
      mustChangePassword: data.must_change_password, apps: data.apps,
    };
    const targetUrl = new URL(APPS_META[target].url, window.location.href);
    if (targetUrl.origin === window.location.origin) {
      // Same site (single-domain build): drop the session into the other app's own storage namespace and go there.
      const store = window.__rawLocalStorage || window.localStorage;
      const prefix = window.__rawLocalStorage ? `${target}:` : '';
      store.setItem(`${prefix}sg_token`, data.access_token);
      store.setItem(`${prefix}sg_user`, JSON.stringify(u));
      sessionStorage.setItem('sg_just_logged_in', '1');
      window.location.href = targetUrl.href;
      return;
    }
    // Different site (two separate deployments): hand the token over in the address hash.
    const packed = btoa(unescape(encodeURIComponent(JSON.stringify({ t: data.access_token, u }))));
    window.location.href = `${targetUrl.href.replace(/\/$/, '')}/#sso=${packed}`;
  }, []);

  return (
    <AuthContext.Provider value={{ user, login, logout, setUserLocal, switchApp, error, loading, can, permissions }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
