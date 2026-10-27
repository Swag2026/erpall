// Central place for the backend URL. Set VITE_API_BASE in Netlify/Vercel env
// vars (Environment Variables) to override this without touching code.
export const API_BASE = import.meta.env.VITE_API_BASE || 'https://api.swag.sa/api';

import { APP_ID } from './appConfig.js';

function authHeaders(json = true) {
  const headers = { 'X-App': APP_ID };
  if (json) headers['Content-Type'] = 'application/json';
  const token = localStorage.getItem('sg_token');
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

function showSessionExpiredOverlay() {
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;inset:0;z-index:999999;background:rgba(4,6,13,.75);' +
    'display:flex;align-items:center;justify-content:center;padding:20px;font-family:sans-serif;';
  el.innerHTML = `
    <div style="background:#151928;border:1px solid #d4af37;border-radius:12px;padding:28px;max-width:380px;color:#f3ecd8;text-align:center;">
      <div style="font-size:32px;margin-bottom:12px;">⏱</div>
      <div style="font-weight:700;font-size:16px;margin-bottom:8px;">Session Expired</div>
      <div style="font-size:13.5px;color:#b8ae94;margin-bottom:20px;line-height:1.5;">
        Please log in again. Any unsaved changes on this page were not submitted.
      </div>
      <button id="__sg_session_ok" style="background:#d4af37;color:#151928;border:none;border-radius:8px;padding:10px 24px;font-weight:700;cursor:pointer;">
        OK
      </button>
    </div>`;
  document.body.appendChild(el);
  document.getElementById('__sg_session_ok').addEventListener('click', () => window.location.reload());
}

async function handle(res) {
  if (res.status === 401) {
    // Token expired/invalid — but don't reload instantly. If someone is
    // mid-way through a long form when their session happens to expire,
    // an unannounced reload wipes everything they typed with zero
    // warning. This shows a plain DOM overlay (not window.alert — some
    // embedded/kiosk browser setups suppress native dialogs entirely)
    // so they have a moment to notice/copy their work first.
    localStorage.removeItem('sg_token');
    localStorage.removeItem('sg_user');
    if (!window.__sgSessionExpiredShown) {
      window.__sgSessionExpiredShown = true;
      showSessionExpiredOverlay();
    } else {
      window.location.reload();
    }
    throw new Error('Session expired');
  }
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      msg = body.detail || body.message || msg;
    } catch (_) { /* no json body */ }
    throw new Error(msg);
  }
  if (res.status === 204) return null;
  return res.json();
}

export async function apiGet(path) {
  const res = await fetch(API_BASE + path, { headers: authHeaders() });
  return handle(res);
}

export async function apiPost(path, body) {
  const res = await fetch(API_BASE + path, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body)
  });
  return handle(res);
}

export async function apiPut(path, body) {
  const res = await fetch(API_BASE + path, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify(body)
  });
  return handle(res);
}

export async function apiDelete(path) {
  const res = await fetch(API_BASE + path, {
    method: 'DELETE',
    headers: authHeaders()
  });
  return handle(res);
}
