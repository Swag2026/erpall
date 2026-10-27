import { apiGet } from './api';

// FIX (duplicate-request bug): NotificationBell.jsx (mounted globally, on
// every page) and Dashboard.jsx (mounted only on the Dashboard route) were
// each independently setInterval-polling `/activity-logs?since_id=X` every
// 6 seconds. Whenever Dashboard was open, that's the SAME endpoint hit
// twice per cycle for no reason — two components wanting "what's new"
// should share one fetch, not each open their own connection.
//
// This module is a plain singleton (not a React Context) specifically so
// it keeps working correctly even if it's imported from places that don't
// share a common ancestor component — one poll loop, any number of
// subscribers, each subscriber only re-renders when there's actually new
// data to hand them.

const POLL_MS = 6000;
let lastSeenId = null;
let intervalId = null;
let subscribers = new Set();
let baselinePromise = null;

async function ensureBaseline() {
  if (lastSeenId !== null) return;
  // FIX: without memoizing this promise, two subscribers mounting within
  // the same tick (NotificationBell + Dashboard, both on initial page
  // load) would each see lastSeenId still null and both fire their own
  // /activity-logs?limit=1 request before either had resolved.
  if (baselinePromise) return baselinePromise;
  baselinePromise = (async () => {
    try {
      const latest = await apiGet('/activity-logs?limit=1');
      lastSeenId = latest?.[0]?.id || 0;
    } catch (_) {
      lastSeenId = 0;
    }
  })();
  return baselinePromise;
}

async function pollOnce() {
  if (lastSeenId === null) return;
  try {
    const fresh = await apiGet(`/activity-logs?since_id=${lastSeenId}&limit=50`);
    if (!fresh || !fresh.length) return;
    lastSeenId = Math.max(lastSeenId, ...fresh.map(f => f.id));
    subscribers.forEach(cb => cb(fresh));
  } catch (_) { /* best-effort */ }
}

function ensurePolling() {
  if (intervalId) return;
  ensureBaseline().then(() => {
    if (intervalId) return; // a subscriber may have unsubscribed while we awaited
    pollOnce();
    intervalId = setInterval(pollOnce, POLL_MS);
  });
}

/**
 * Subscribe to new activity-log entries. Returns an unsubscribe function.
 * The underlying poll loop only runs while there's at least one active
 * subscriber, and is shared across every caller — mounting this from ten
 * different components still only produces one network request per cycle.
 */
export function subscribeToActivityFeed(callback) {
  subscribers.add(callback);
  ensurePolling();
  return () => {
    subscribers.delete(callback);
    if (subscribers.size === 0 && intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
  };
}

/** Returns the shared feed's current baseline id, fetching it once if no
 * poll has started yet. Lets callers (like NotificationBell's own
 * localStorage-based "last seen" baseline) reuse the same /activity-logs
 * ?limit=1 lookup instead of making their own redundant copy of it. */
export async function getActivityFeedBaseline() {
  await ensureBaseline();
  return lastSeenId;
}
