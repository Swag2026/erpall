import { apiGet, apiPost } from './api';

// PushManager wants the VAPID public key as a raw Uint8Array, not the
// base64url string the backend hands out.
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export async function registerPushNotifications() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return; // unsupported browser — no-op

  try {
    const registration = await navigator.serviceWorker.register('/sw.js');

    let permission = Notification.permission;
    if (permission === 'default') permission = await Notification.requestPermission();
    if (permission !== 'granted') return;

    const { key } = await apiGet('/push/vapid-public-key');
    if (!key) return; // backend hasn't configured VAPID yet

    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key),
      });
    }

    const json = subscription.toJSON();
    await apiPost('/push/subscribe', {
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
    });
  } catch (err) {
    // Non-fatal — the app works fine without push, this is a best-effort
    // enhancement (also expected to fail on http:// in dev, no service
    // worker support there).
    console.warn('Push registration skipped:', err.message);
  }
}
