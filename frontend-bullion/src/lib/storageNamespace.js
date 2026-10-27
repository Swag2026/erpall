// In the single-domain build Retail (/retail) and Bullion (/bullion) share ONE browser origin, so they would share
// localStorage too: the login token, theme, language... of one app would overwrite the other's. This makes every
// localStorage key of the current app live under its own prefix ("retail:sg_token", "bullion:sg_token", ...).
// It is imported FIRST in main.jsx, so all later code (which just says `localStorage`) gets the namespaced version.
// Stand-alone builds (base '/') are left completely untouched.
import { APP_ID, PATH_MODE } from './appConfig.js';

if (PATH_MODE) {
  const raw = window.localStorage;
  const P = APP_ID + ':';
  const mine = () => Object.keys(raw).filter((k) => k.startsWith(P));
  const ns = {
    getItem: (k) => raw.getItem(P + k),
    setItem: (k, v) => raw.setItem(P + k, v),
    removeItem: (k) => raw.removeItem(P + k),
    clear: () => mine().forEach((k) => raw.removeItem(k)),
    key: (i) => { const k = mine()[i]; return k === undefined ? null : k.slice(P.length); },
    get length() { return mine().length; },
  };
  try {
    Object.defineProperty(window, 'localStorage', { configurable: true, value: ns });
  } catch (_) { /* very old browser: fall back to the shared storage */ }
  window.__rawLocalStorage = raw;
}
