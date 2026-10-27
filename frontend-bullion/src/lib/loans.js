// Shop Loans helpers — gold/silver lent to other shops for the day.
export const KARAT_KEYS = [
  { key: 'weight_24k', k: '24K', bal: 'w24', f: 24 },
  { key: 'weight_21k', k: '21K', bal: 'w21', f: 21 },
  { key: 'weight_18k', k: '18K', bal: 'w18', f: 18 },
  { key: 'weight_silver', k: 'Silver', bal: 'silver', f: 0 },
];

export const k24eq = (w24, w21, w18) => (Number(w24) || 0) + (Number(w21) || 0) * 21 / 24 + (Number(w18) || 0) * 18 / 24;

export const fmtG = (n) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 3 });
export const fmtG2 = (n) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fmtMoney = (n) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Non-zero karat chips of a shop balance: [['21K', 5], ['18K', 3]]
export function balanceChips(bal) {
  if (!bal) return [];
  return [['24K', bal.w24], ['21K', bal.w21], ['18K', bal.w18], ['Silver', bal.silver]].filter(([, w]) => (Number(w) || 0) > 0.0005);
}

// Non-zero karat chips of an entry
export function entryChips(e) {
  return [['24K', e.weight_24k], ['21K', e.weight_21k], ['18K', e.weight_18k], ['Silver', e.weight_silver]].filter(([, w]) => (Number(w) || 0) > 0);
}

// A shop is "overdue" when it has been owing gold since BEFORE today (local calendar).
export function isOverdue(shop, todayStr) {
  if (!shop?.open_since) return false;
  const d = new Date(shop.open_since);
  const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return ds < todayStr;
}

// Minutes-of-day helper for the evening reminder ("HH:MM" → minutes).
export const hhmmToMin = (s) => { const [h, m] = (s || '18:00').split(':').map(Number); return (h || 0) * 60 + (m || 0); };

// One day of /shop-loans/daily-summary → the numbers the Dashboard needs.
// Lent metal leaves stock, returned metal comes back, settled metal stays with the shop (its cash enters the drawer).
export function loanFlows(day) {
  const d = day || {};
  const gold = (c) => (c ? (Number(c.w24) || 0) + (Number(c.w21) || 0) * 21 / 24 + (Number(c.w18) || 0) * 18 / 24 : 0);
  const silver = (c) => (c ? Number(c.wSilver) || 0 : 0);
  return {
    lentGold: gold(d.lend), lentSilver: silver(d.lend),
    returnedGold: gold(d.return), returnedSilver: silver(d.return),
    settledGold: gold(d.settle), settledSilver: silver(d.settle),
    settledCash: Number(d.settle?.cash) || 0,
  };
}
