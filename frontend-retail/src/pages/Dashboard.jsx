import { DonutChart } from '../components/ui/donut-chart.tsx';
import { SUPPLIER_METAL_DEDUCTION_CUTOVER } from '../lib/ledger.js';
import { loanFlows } from '../lib/loans.js';
import { useEffect, useMemo, useRef, useState } from 'react';
import Chart from 'chart.js/auto';
import jsPDF from 'jspdf';
import { apiGet, apiPut, apiPost } from '../lib/api';
import { useAuth } from '../context/AuthContext.jsx';
import { subscribeToActivityFeed } from '../lib/activityFeed';
import { useLanguage } from '../context/LanguageContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import SkeletonPage from '../components/Skeleton.jsx';
import CountUp from '../components/CountUp.jsx';
import Sparkline from '../components/Sparkline.jsx';
import DateField from '../components/DateField.jsx';
import { IconLock, IconDownload, IconSaudiRiyal } from '../components/Icons.jsx';

function toLocalDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function fmt(n) {
  return Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
}

const isSale = (e) => e.category === 'sale';
const isPurchase = (e) => e.category === 'purchase_jewelry' || e.category === 'purchase_scrap';
const isExpense = (e) => e.category === 'expense';
const isCashOnly = (e) => (e.category === 'supplier_payment' || e.category === 'expense') && e.payment_source !== 'cash_deposit';
const isCashAdd = (e) => e.category === 'cash_adjustment';
// Gold paid to a supplier leaves the business like a sale. Counted only on/after
// SUPPLIER_METAL_DEDUCTION_CUTOVER — older supplier payments were already adjusted
// by hand, so deducting them again would double-count.
const isSupplierMetalDeductible = (e) =>
  e.category === 'supplier_payment' && e.invoice_date >= SUPPLIER_METAL_DEDUCTION_CUTOVER;

export default function Dashboard() {
  const { user, can } = useAuth();
  const { showToast } = useToast();
  const { t, tf, lang } = useLanguage();
  // Reopen a closed day (admin, or any role granted 'day.reopen' in Settings > Team & Access).
  const [showReopen, setShowReopen] = useState(false);
  const [reopenReason, setReopenReason] = useState('');
  const [reopenErr, setReopenErr] = useState('');
  const [reopening, setReopening] = useState(false);
  const [loading, setLoading] = useState(true);
  const [cashFlowCount, setCashFlowCount] = useState(7);
  const [cashFlowUnit, setCashFlowUnit] = useState('day');
  const [liveBanners, setLiveBanners] = useState([]);
  const [error, setError] = useState('');
  const [entries, setEntries] = useState([]);
  const [dailySummary, setDailySummary] = useState({});
  const [contacts, setContacts] = useState([]);
  const [dayOpenings, setDayOpenings] = useState({});
  const [reconciliations, setReconciliations] = useState({});
  const [activeDay, setActiveDay] = useState(toLocalDateStr(new Date()));
  const [openingForm, setOpeningForm] = useState({ cash: '', gold: '', silver: '' });
  const [savingOpening, setSavingOpening] = useState(false);

  const [showReconcile, setShowReconcile] = useState(false);
  const [countedCash, setCountedCash] = useState('');
  const [reconNote, setReconNote] = useState('');
  const [savingRecon, setSavingRecon] = useState(false);
  const [reconError, setReconError] = useState('');
  const cashCanvasRef = useRef(null);
  const cashChartRef = useRef(null);
  // Gold/silver lent to other shops (pages/ShopLoans.jsx). Optional: if the endpoint is
  // unavailable (or empty) everything below behaves exactly as before.
  const [loansByDay, setLoansByDay] = useState({});
  const [loanShops, setLoanShops] = useState([]);

  async function loadAll() {
    setLoading(true);
    setError('');
    try {
      // Full invoice detail is only ever displayed for a recent window
      // (today's entry list, a 7-day trend, a 10-day cash/card chart) — a
      // 20-day buffer covers all of that with room to spare. Historical
      // totals further back (the running closing-balance, all-time
      // overview stats) come from /daily-summary instead, which is
      // computed with SQL GROUP BY rather than shipping every invoice
      // ever created to the browser just to add them up in JavaScript.
      const recentFrom = new Date();
      recentFrom.setDate(recentFrom.getDate() - 20);
      const recentFromStr = toLocalDateStr(recentFrom);

      const [invoicesRes, summaryRes, contactsRes, openingsRes, reconRes, loansRes, loanShopsRes] = await Promise.all([
        apiGet(`/invoices?date_from=${recentFromStr}&limit=2000`),
        apiGet(`/invoices/daily-summary`),
        apiGet(`/contacts`),
        apiGet(`/day-openings`),
        apiGet(`/reconciliations`),
        // Shop loans must never be able to break the Dashboard.
        apiGet(`/shop-loans/daily-summary`).catch(() => ({})),
        apiGet(`/shop-loans/shops`).catch(() => []),
      ]);

      const list = Array.isArray(invoicesRes) ? invoicesRes : invoicesRes?.items || [];
      setEntries(list);
      setDailySummary(summaryRes || {});
      setContacts(contactsRes || []);
      setLoansByDay(loansRes && typeof loansRes === 'object' ? loansRes : {});
      setLoanShops(Array.isArray(loanShopsRes) ? loanShopsRes : []);

      const openingsMap = {};
      (openingsRes || []).forEach(row => {
        openingsMap[row.opening_date] = {
          cash: row.opening_cash || 0,
          gold: row.opening_gold || 0,
          silver: row.opening_silver || 0,
        };
      });
      setDayOpenings(openingsMap);

      const reconMap = {};
      (reconRes || []).forEach(row => { reconMap[row.reconciliation_date] = row; });
      setReconciliations(reconMap);

      const summaryDays = Object.keys(summaryRes || {});
      const listDays = list.map(e => e.invoice_date);
      const days = [...new Set([...summaryDays, ...listDays])].filter(Boolean).sort(); // loan-only days don't move the default day
      setActiveDay(days[days.length - 1] || toLocalDateStr(new Date()));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadAll(); }, []);

  // The initial load only fetches invoices from the last 20 days (for
  // performance — see loadAll's comment). If the person picks an OLDER
  // date via the calendar date-picker, that day's invoices were never
  // fetched, so dayEntries below would wrongly compute as empty/zero even
  // though the day genuinely has data (which History, with no such
  // window, shows correctly). This fetches that specific day on demand
  // and merges it in, without re-fetching the whole 20-day window again.
  const fetchedDaysRef = useRef(new Set());
  useEffect(() => {
    if (!activeDay || loading) return;
    const alreadyLoaded = entries.some(e => e.invoice_date === activeDay);
    if (alreadyLoaded || fetchedDaysRef.current.has(activeDay)) return;
    fetchedDaysRef.current.add(activeDay);
    apiGet(`/invoices?invoice_date=${activeDay}&limit=500`)
      .then(res => {
        const list = Array.isArray(res) ? res : res?.items || [];
        if (list.length === 0) return;
        setEntries(prev => {
          const existingIds = new Set(prev.map(e => e.id));
          const fresh = list.filter(e => !existingIds.has(e.id));
          return fresh.length ? [...prev, ...fresh] : prev;
        });
      })
      .catch(() => { /* non-fatal — the daily-summary totals above still work regardless */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDay, loading]);

  // Live activity banners — whenever ANYONE creates/cancels an invoice or
  // closes the day while this Dashboard is open, a card animates in from
  // the top announcing it, then fades itself out a few seconds later.
  // Subscribes to the SHARED activity feed (lib/activityFeed.js) instead
  // of running its own setInterval poll — previously this ran alongside
  // NotificationBell's identical poll, hitting /activity-logs?since_id=X
  // twice every 6s whenever Dashboard was open. Now there's one poll,
  // shared by both.
  useEffect(() => {
    const CATEGORY_LABEL_KEY = {
      sale: 'entry.sale', purchase_jewelry: 'entry.purchaseJewelry', purchase_scrap: 'entry.purchaseScrap',
      supplier_payment: 'entry.supplierPayment', expense: 'entry.expense', cash_adjustment: 'entry.addCash',
    };
    const CATEGORY_ICON = {
      sale: '💰', purchase_jewelry: '💍', purchase_scrap: '🔶',
      supplier_payment: '🏦', expense: '🧾', cash_adjustment: '➕', day_close: '🔒',
    };
    const unsubscribe = subscribeToActivityFeed((fresh) => {
      // Oldest-first so banners stack in the order things actually happened.
      [...fresh].reverse().forEach(item => {
        const bannerId = `${item.id}-${Date.now()}`;
        const icon = CATEGORY_ICON[item.category] || (item.action_type === 'day_close' ? '🔒' : '📋');
        const categoryLabel = item.action_type === 'day_close'
          ? t('notif.dayClosed')
          : t(CATEGORY_LABEL_KEY[item.category] || item.category);
        setLiveBanners(prev => [...prev, {
          id: bannerId, icon,
          title: t('dash.newActivityTitle'),
          sub: tf('dash.newActivityLine', { category: categoryLabel, amount: (item.amount || 0).toLocaleString(), user: item.user_name || '—' }),
        }]);
        setTimeout(() => setLiveBanners(prev => prev.filter(b => b.id !== bannerId)), 4200);
      });
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const allDays = useMemo(() => {
    const fromSummary = Object.keys(dailySummary);
    const fromOpenings = Object.keys(dayOpenings);
    const fromLoans = Object.keys(loansByDay);
    const set = new Set([...fromSummary, ...fromOpenings, ...fromLoans, activeDay]);
    return [...set].filter(Boolean).sort();
  }, [dailySummary, dayOpenings, loansByDay, activeDay]);

  // Carry-forward opening balance — a day with no explicit opening entry
  // inherits the PREVIOUS day's closing cash/gold instead of silently
  // resetting to zero. Computed once across every day in order (not just
  // yesterday→today) so a multi-day gap still carries through correctly.
  const closingByDay = useMemo(() => {
    const sorted = [...allDays].sort();
    const toK21Local = (w, k) => w * (k / 21);
    const convOfSums = (catSummary) => {
      if (!catSummary) return 0;
      return (catSummary.w21 || 0) + toK21Local(catSummary.w18 || 0, 18) + toK21Local(catSummary.w24 || 0, 24);
    };
    const result = {};
    let carryCash = 0, carryGold = 0, carrySilver = 0;
    for (const day of sorted) {
      const explicit = dayOpenings[day];
      const dOpenCash = explicit ? (explicit.cash || 0) : carryCash;
      const dOpenGold = explicit ? (explicit.gold || 0) : carryGold;
      const dOpenSilver = explicit ? (explicit.silver || 0) : carrySilver;

      const daySum = dailySummary[day] || {};
      const dSalesCash = daySum.sale?.cash || 0;
      const dPurchaseCash = (daySum.purchase_jewelry?.cash || 0) + (daySum.purchase_scrap?.cash || 0);
      const dExpenseCash = (daySum.supplier_payment?.cash || 0) + (daySum.expense?.cash || 0);
      const dCashAddTotal = daySum.cash_adjustment?.cash || 0;
      const dLoan = loanFlows(loansByDay[day]); // all zeros when there are no shop loans that day
      const dClosingCash = dOpenCash + dSalesCash + dCashAddTotal + dLoan.settledCash - dPurchaseCash - dExpenseCash;

      const dSupplierConv = day >= SUPPLIER_METAL_DEDUCTION_CUTOVER ? convOfSums(daySum.supplier_payment) : 0;
      const dSalesConv = convOfSums(daySum.sale) + dSupplierConv;
      const dPurchConv = convOfSums(daySum.purchase_jewelry) + convOfSums(daySum.purchase_scrap);
      const dClosingGold = dOpenGold - dSalesConv + dPurchConv - dLoan.lentGold + dLoan.returnedGold;

      result[day] = { cash: dClosingCash, gold: dClosingGold, silver: dOpenSilver };
      carryCash = dClosingCash; carryGold = dClosingGold; carrySilver = dOpenSilver;
    }
    return result;
  }, [allDays, dayOpenings, dailySummary, loansByDay]);

  // All-time overview stats — summed from the SQL-aggregated daily
  // summary instead of the entries array, since entries is now only a
  // recent window (not the full history) for performance reasons.
  const overviewTotals = useMemo(() => {
    let totalSales = 0, totalPurchases = 0, totalCount = 0;
    for (const day of Object.keys(dailySummary)) {
      const daySum = dailySummary[day];
      for (const cat of Object.keys(daySum)) {
        const c = daySum[cat];
        totalCount += c.count || 0;
        if (cat === 'sale') totalSales += c.total || 0;
        if (cat === 'purchase_jewelry' || cat === 'purchase_scrap') totalPurchases += c.total || 0;
      }
    }
    return { totalSales, totalPurchases, totalCount };
  }, [dailySummary]);

  const opening = useMemo(() => {
    if (dayOpenings[activeDay]) return dayOpenings[activeDay];
    const sorted = [...allDays].sort();
    const idx = sorted.indexOf(activeDay);
    const prevDay = idx > 0 ? sorted[idx - 1] : null;
    return (prevDay && closingByDay[prevDay]) || { cash: 0, gold: 0, silver: 0 };
  }, [dayOpenings, activeDay, allDays, closingByDay]);
  const recon = reconciliations[activeDay];

  function addNewDay() {
    const last = allDays[allDays.length - 1] || activeDay;
    const next = new Date(last + 'T00:00:00');
    next.setDate(next.getDate() + 1);
    const nStr = toLocalDateStr(next);
    setActiveDay(nStr);
    showToast('New day added', 'success');
  }

  const dayEntries = useMemo(
    () => entries.filter(e => e.invoice_date === activeDay && e.status !== 'canceled'),
    [entries, activeDay]
  );
  const sales = dayEntries.filter(isSale);
  const supplierPayments = dayEntries.filter(isSupplierMetalDeductible);
  const purchases = dayEntries.filter(isPurchase);
  const pureExpenses = dayEntries.filter(isExpense);

  // 7-day trailing trend for the sparkline-bearing cards.
  const trend7 = useMemo(() => {
    const trailingDays = allDays.filter(d => d <= activeDay).slice(-7);
    const salesTrend = trailingDays.map(d =>
      entries.filter(e => e.invoice_date === d && e.status !== 'canceled' && isSale(e))
        .reduce((s, e) => s + (Number(e.total_amount) || 0), 0));
    const purchTrend = trailingDays.map(d =>
      entries.filter(e => e.invoice_date === d && e.status !== 'canceled' && isPurchase(e))
        .reduce((s, e) => s + (Number(e.total_amount) || 0), 0));
    return { salesTrend, purchTrend };
  }, [entries, allDays, activeDay]);
  const cashOnly = dayEntries.filter(isCashOnly);
  const cashAdds = dayEntries.filter(isCashAdd);

  const salesTotal = sales.reduce((s, e) => s + Number(e.total_amount || 0), 0);
  const purchaseTotal = purchases.reduce((s, e) => s + Number(e.total_amount || 0), 0);
  const expenseTotal = cashOnly.reduce((s, e) => s + (Number(e.cash_amount) || 0) + (Number(e.card_amount) || 0), 0);
  const pureExpenseTotal = pureExpenses.reduce((s, e) => s + (Number(e.cash_amount) || 0) + (Number(e.card_amount) || 0), 0);
  // Physical drawer cash ("Closing Cash") must only count CASH legs — a
  // card/transfer sale never enters the drawer, it goes straight to the
  // bank. Using the card-inclusive totals above inflates this figure and
  // guarantees a false variance on Close Day whenever card payments happen.
  const salesCash = sales.reduce((s, e) => s + (Number(e.cash_amount) || 0), 0);
  const purchaseCash = purchases.reduce((s, e) => s + (Number(e.cash_amount) || 0), 0);
  const expenseCash = cashOnly.reduce((s, e) => s + (Number(e.cash_amount) || 0), 0);
  const cashAddTotal = cashAdds.reduce((s, e) => s + (Number(e.cash_amount) || 0), 0);
  const cardCollected = salesTotal - salesCash; // card/transfer money collected today (informational)
  // Shop loans for the day on screen: cash a shop paid for metal it kept comes into the drawer.
  const dayLoan = loanFlows(loansByDay[activeDay]);
  const systemClosingCash = (opening.cash || 0) + salesCash + cashAddTotal + dayLoan.settledCash - purchaseCash - expenseCash;

  const toK21 = (w, k) => w * (k / 21);
  const goldSaleWeight = useMemo(() =>
    sales.reduce((s, e) =>
      s + Number(e.weight_21k || 0) + toK21(Number(e.weight_18k || 0), 18) + toK21(Number(e.weight_24k || 0), 24), 0),
  [sales]);
  const goldSupplierWeight = useMemo(() =>
    supplierPayments.reduce((s, e) =>
      s + Number(e.weight_21k || 0) + toK21(Number(e.weight_18k || 0), 18) + toK21(Number(e.weight_24k || 0), 24), 0),
  [supplierPayments]);
  const goldPurchaseWeight = useMemo(() =>
    purchases.reduce((s, e) =>
      s + Number(e.weight_21k || 0) + toK21(Number(e.weight_18k || 0), 18) + toK21(Number(e.weight_24k || 0), 24), 0),
  [purchases]);

  // Extra KPIs: supplier payments, scrap purchases and silver movement (display only —
  // they do not feed the cash/gold balance math above).
  const kpiExtra = useMemo(() => {
    const k21 = (e) => Number(e.weight_21k || 0) + toK21(Number(e.weight_18k || 0), 18) + toK21(Number(e.weight_24k || 0), 24);
    const amt = (e) => Number(e.total_amount || 0) || ((Number(e.cash_amount) || 0) + (Number(e.card_amount) || 0));
    const sup = dayEntries.filter(e => e.category === 'supplier_payment');
    const scrap = dayEntries.filter(e => e.category === 'purchase_scrap');
    const sumS = (arr) => arr.reduce((s, e) => s + Number(e.weight_silver || 0), 0);
    return {
      supCount: sup.length, supAmount: sup.reduce((s, e) => s + amt(e), 0), supGold: sup.reduce((s, e) => s + k21(e), 0),
      scrapCount: scrap.length, scrapAmount: scrap.reduce((s, e) => s + amt(e), 0), scrapGold: scrap.reduce((s, e) => s + k21(e), 0),
      silverSold: sumS(sales), silverBought: sumS(purchases), silverSupplier: sumS(sup),
    };
  }, [dayEntries, sales, purchases]);

  const goldBalance = useMemo(() => {
    // Sales send gold OUT of the tray, purchases (buying jewelry/scrap from
    // customers) bring gold IN — the previous version had both signs
    // inverted, so heavier sales days made the gold balance look bigger.
    // Gold paid to suppliers also leaves the tray (from the cutover date onward).
    // Gold lent to a shop leaves the tray (21K-eq) and comes back when they return it.
    return (opening.gold || 0) - goldSaleWeight - goldSupplierWeight + goldPurchaseWeight - dayLoan.lentGold + dayLoan.returnedGold;
  }, [goldSaleWeight, goldSupplierWeight, goldPurchaseWeight, opening.gold, dayLoan.lentGold, dayLoan.returnedGold]);

  // Shops that still hold our gold/silver right now (all-time balance).
  const owingShops = useMemo(() => loanShops.filter(sh => (sh.balance_21k_eq || 0) > 0.0005 || (sh.balance?.silver || 0) > 0.0005), [loanShops]);
  const goldOutWithShops = owingShops.reduce((a, sh) => a + (sh.balance_21k_eq || 0), 0);

  const balanceWarnings = [];
  if (systemClosingCash < 0) balanceWarnings.push(tf('dash.negCashWarn', { amt: Math.abs(systemClosingCash).toFixed(2) }));
  if (goldBalance < 0) balanceWarnings.push(tf('dash.negGoldWarn', { amt: Math.abs(goldBalance).toFixed(1) }));


  const weightSegs = useMemo(() => {
    const w21 = sales.reduce((s, e) => s + Number(e.weight_21k || 0), 0);
    const w18 = sales.reduce((s, e) => s + Number(e.weight_18k || 0), 0);
    const w24 = sales.reduce((s, e) => s + Number(e.weight_24k || 0), 0);
    const wS = sales.reduce((s, e) => s + Number(e.weight_silver || 0), 0);
    const totalW = w21 + w18 + w24 + wS;
    const segs = [
      { label: '21K', w: w21, color: '#D4AA30' },
      { label: '18K', w: w18, color: '#AF8C28' },
      { label: '24K', w: w24, color: '#F2CA4C' },
      { label: 'Silver', w: wS, color: '#BCC6CE' },
    ].filter(s => s.w > 0);
    return { segs, totalW };
  }, [sales]);

  // Mismatch: karat-based entries where total doesn't equal cash+card split
  const mismatches = dayEntries.filter(e =>
    (isSale(e) || isPurchase(e)) &&
    Math.abs(Number(e.total_amount || 0) - ((Number(e.cash_amount) || 0) + (Number(e.card_amount) || 0))) > 0.5
  );

  // Cash Flow IN/OUT — built from dailySummary (unrestricted, all-time),
  // bucketed into the last N days/weeks/months/years per the person's
  // chosen granularity. IN = money coming into the shop (sales, cash
  // top-ups); OUT = money going out (purchases, supplier payments,
  // expenses). Uses REAL calendar today (not activeDay, which tracks
  // "latest day with an invoice" and can lag behind if nothing's been
  // entered yet today).
  const IN_CATEGORIES = ['sale', 'cash_adjustment'];
  const OUT_CATEGORIES = ['purchase_scrap', 'purchase_jewelry', 'supplier_payment', 'expense'];

  const cashFlowBuckets = useMemo(() => {
    const todayDate = new Date(toLocalDateStr(new Date()) + 'T00:00:00');
    const n = Math.max(1, Math.min(60, Number(cashFlowCount) || 1));
    const buckets = []; // each: { label, days: [dateStr, ...] }
    if (cashFlowUnit === 'day') {
      for (let i = n - 1; i >= 0; i--) {
        const d = new Date(todayDate); d.setDate(d.getDate() - i);
        const ds = toLocalDateStr(d);
        buckets.push({ label: ds.slice(5), days: [ds] });
      }
    } else if (cashFlowUnit === 'week') {
      // Weeks are anchored to end on Thursday (the shop's actual weekly
      // closing day) rather than a rolling 7-day window ending "today".
      const dayOfWeek = todayDate.getDay();
      const daysSinceThursday = (dayOfWeek - 4 + 7) % 7;
      const mostRecentThursday = new Date(todayDate); mostRecentThursday.setDate(mostRecentThursday.getDate() - daysSinceThursday);
      for (let i = n - 1; i >= 0; i--) {
        const end = new Date(mostRecentThursday); end.setDate(end.getDate() - i * 7);
        const start = new Date(end); start.setDate(start.getDate() - 6);
        const days = [];
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) days.push(toLocalDateStr(d));
        buckets.push({ label: toLocalDateStr(end).slice(5, 10), days });
      }
    } else if (cashFlowUnit === 'month') {
      for (let i = n - 1; i >= 0; i--) {
        const m = new Date(todayDate.getFullYear(), todayDate.getMonth() - i, 1);
        const monthEnd = new Date(m.getFullYear(), m.getMonth() + 1, 0);
        const days = [];
        for (let d = new Date(m); d <= monthEnd; d.setDate(d.getDate() + 1)) days.push(toLocalDateStr(d));
        buckets.push({ label: m.toLocaleDateString(lang === 'ar' ? 'ar' : 'en', { month: 'short', year: 'numeric' }), days });
      }
    } else { // year
      for (let i = n - 1; i >= 0; i--) {
        const y = todayDate.getFullYear() - i;
        const days = [];
        for (let d = new Date(y, 0, 1); d <= new Date(y, 11, 31); d.setDate(d.getDate() + 1)) days.push(toLocalDateStr(d));
        buckets.push({ label: String(y), days });
      }
    }
    return buckets;
  }, [cashFlowCount, cashFlowUnit, lang]);

  const cashFlowData = useMemo(() => {
    let totalIn = 0, totalOut = 0;
    const inCashByBucket = [], inCardByBucket = [], outCashByBucket = [], outCardByBucket = [], netByBucket = [];
    cashFlowBuckets.forEach(({ days }) => {
      let bIn = 0, bOut = 0, bInCash = 0, bInCard = 0, bOutCash = 0, bOutCard = 0;
      days.forEach(day => {
        const daySum = dailySummary[day];
        if (!daySum) return;
        Object.keys(daySum).forEach(cat => {
          const total = daySum[cat]?.total || 0;
          const cash = daySum[cat]?.cash || 0;
          const card = Math.max(0, total - cash);
          if (IN_CATEGORIES.includes(cat)) { bIn += total; bInCash += cash; bInCard += card; }
          else if (OUT_CATEGORIES.includes(cat)) { bOut += total; bOutCash += cash; bOutCard += card; }
        });
      });
      inCashByBucket.push(bInCash); inCardByBucket.push(bInCard);
      outCashByBucket.push(bOutCash); outCardByBucket.push(bOutCard);
      netByBucket.push(bIn - bOut);
      totalIn += bIn; totalOut += bOut;
    });
    return { inCashByBucket, inCardByBucket, outCashByBucket, outCardByBucket, netByBucket, totalIn, totalOut, net: totalIn - totalOut };
  }, [dailySummary, cashFlowBuckets]);

  useEffect(() => {
    if (loading || !cashCanvasRef.current) return;
    const labels = cashFlowBuckets.map(b => b.label);
    if (cashChartRef.current) cashChartRef.current.destroy();
    cashChartRef.current = new Chart(cashCanvasRef.current, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: `${t('dash.cashIn')} (${t('entry.cash')})`, data: cashFlowData.inCashByBucket, backgroundColor: 'rgba(90,200,120,.9)', borderRadius: 4, maxBarThickness: 30, stack: 'in' },
          { label: `${t('dash.cashIn')} (${t('entry.card')})`, data: cashFlowData.inCardByBucket, backgroundColor: 'rgba(74,190,196,.85)', borderRadius: 4, maxBarThickness: 30, stack: 'in' },
          { label: `${t('dash.cashOut')} (${t('entry.cash')})`, data: cashFlowData.outCashByBucket, backgroundColor: 'rgba(224,90,80,.9)', borderRadius: 4, maxBarThickness: 30, stack: 'out' },
          { label: `${t('dash.cashOut')} (${t('entry.card')})`, data: cashFlowData.outCardByBucket, backgroundColor: 'rgba(230,160,60,.85)', borderRadius: 4, maxBarThickness: 30, stack: 'out' },
          {
            label: t('dash.netTotal'), data: cashFlowData.netByBucket, type: 'line',
            borderColor: 'rgba(212,170,48,.9)', backgroundColor: 'transparent', borderWidth: 2,
            pointRadius: cashFlowBuckets.length > 15 ? 0 : 3, tension: 0.3,
          },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { labels: { color: '#8A95B0', boxWidth: 12, font: { size: 10.5 } } } },
        scales: {
          x: { stacked: true, ticks: { color: '#8A95B0', maxRotation: 0, autoSkip: true, maxTicksLimit: 12 }, grid: { display: false } },
          y: { stacked: true, ticks: { color: '#8A95B0' }, grid: { color: 'rgba(255,255,255,.05)' } },
        },
      },
    });
    return () => { if (cashChartRef.current) cashChartRef.current.destroy(); };
  }, [cashFlowData, cashFlowBuckets, loading, lang]);

  useEffect(() => {
    setOpeningForm({ cash: opening.cash || '', gold: opening.gold || '', silver: opening.silver || '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDay, dayOpenings]);

  async function saveOpening(e) {
    e.preventDefault();

    // Sanity-check against what the previous day actually closed at —
    // opening balance should equal yesterday's closing cash in the
    // overwhelming majority of cases; a mismatch is either a typo or a
    // sign that yesterday wasn't reconciled correctly.
    const sortedDays = [...allDays].sort();
    const idx = sortedDays.indexOf(activeDay);
    const prevDay = idx > 0 ? sortedDays[idx - 1] : null;
    const expectedOpening = prevDay && closingByDay[prevDay] ? closingByDay[prevDay].cash : null;
    const enteredCash = Number(openingForm.cash) || 0;
    if (expectedOpening !== null && Math.abs(enteredCash - expectedOpening) >= 0.01) {
      const proceed = window.confirm(
        tf('dash.openingMismatchWarn', { entered: enteredCash.toLocaleString(), expected: expectedOpening.toLocaleString() })
      );
      if (!proceed) return;
    }

    setSavingOpening(true);
    try {
      await apiPut(`/day-openings/${activeDay}`, {
        opening_cash: Number(openingForm.cash) || 0,
        opening_gold: Number(openingForm.gold) || 0,
        opening_silver: Number(openingForm.silver) || 0,
      });
      setDayOpenings(prev => ({ ...prev, [activeDay]: {
        cash: Number(openingForm.cash) || 0,
        gold: Number(openingForm.gold) || 0,
        silver: Number(openingForm.silver) || 0,
      }}));
      showToast(t('dash.openingSavedToast'), 'success');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSavingOpening(false);
    }
  }

  function openReconcile() {
    setCountedCash(recon ? recon.counted_cash : '');
    setReconNote(recon ? recon.note || '' : '');
    setReconError('');
    setShowReconcile(true);
  }

  async function doReopen(e) {
    e.preventDefault();
    if (reopenReason.trim().length < 3) { setReopenErr(t('dash.reopenReasonReq')); return; }
    setReopening(true);
    setReopenErr('');
    try {
      await apiPost(`/reconciliations/${activeDay}/reopen`, { reason: reopenReason.trim() });
      setReconciliations(prev => { const n = { ...prev }; delete n[activeDay]; return n; });
      showToast(t('dash.reopenDone'), 'success');
      setShowReopen(false);
      setReopenReason('');
    } catch (err) {
      setReopenErr(err.message);
    } finally {
      setReopening(false);
    }
  }

  async function saveReconciliation(e) {
    e.preventDefault();
    if (countedCash === '') { setReconError(t('dash.enterCountedCash')); return; }
    setSavingRecon(true);
    setReconError('');
    try {
      const result = await apiPut(`/reconciliations/${activeDay}`, {
        system_closing_cash: systemClosingCash,
        counted_cash: Number(countedCash),
        note: reconNote.trim(),
      });
      setReconciliations(prev => ({ ...prev, [activeDay]: result }));
      showToast('Day closed and reconciled', 'success');
      setShowReconcile(false);
    } catch (err) {
      setReconError(err.message);
    } finally {
      setSavingRecon(false);
    }
  }

  function exportDayPDF() {
    const closingCash = systemClosingCash;
    const doc = new jsPDF({ unit: 'pt', format: [320, 500] });
    let y = 36;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(16);
    doc.text('Swag Gold', 20, y); y += 18;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(110);
    doc.text(`Day Summary — ${activeDay}`, 20, y); y += 18;
    doc.setDrawColor(220); doc.line(20, y, 300, y); y += 16;

    const rows = [
      ['Opening Cash', `SAR ${fmt(opening.cash)}`],
      ['Cash Sales', `SAR ${fmt(salesCash)}`],
      ['Cash Purchases', `SAR ${fmt(purchaseCash)}`],
      ['Cash Expenses / Payments', `SAR ${fmt(expenseCash)}`],
      ['Card / Transfer collected (bank)', `SAR ${fmt(cardCollected)}`],
    ];
    doc.setTextColor(30); doc.setFontSize(11);
    rows.forEach(([label, val]) => {
      doc.text(label, 20, y);
      doc.text(val, 300, y, { align: 'right' });
      y += 20;
    });
    doc.setDrawColor(200); doc.line(20, y, 300, y); y += 18;
    doc.setFont('helvetica', 'bold');
    doc.text('Closing Cash', 20, y);
    doc.text(`SAR ${fmt(closingCash)}`, 300, y, { align: 'right' });
    y += 24;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(110);
    doc.text(`Active Invoices: ${dayEntries.length}`, 20, y); y += 16;
    doc.text(`Gold Balance (21K-eq): ${goldBalance.toFixed(1)}g`, 20, y);

    doc.save(`swag-gold-day-summary-${activeDay}.pdf`);
  }

  if (loading) return <SkeletonPage />;
  if (error) return <div className="login-err" style={{ display: 'block' }}>⚠ {error}</div>;

  return (
    <section className="view active">
      {liveBanners.length > 0 && (
        <div className="activity-banner-stack">
          {liveBanners.map(b => (
            <div key={b.id} className="activity-banner">
              <div className="activity-banner-icon">{b.icon}</div>
              <div className="activity-banner-body">
                <div className="activity-banner-title">{b.title}</div>
                <div className="activity-banner-sub">{b.sub}</div>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="topbar">
        <div>
          <div className="page-title">{t('dash.title')}</div>
          <div className="page-subtitle">{activeDay}</div>
        </div>
        <div className="topbar-actions">
          <DateField value={activeDay} onChange={e => setActiveDay(e.target.value)} className="dash-date-picker" />
          <button className="btn small" onClick={addNewDay}>+ {t('dash.newDay')}</button>
          <button className="btn small" onClick={openReconcile} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><IconLock size={14} /> {t('dash.closeDay')}</button>
          <button className="btn gold" onClick={exportDayPDF} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><IconDownload size={14} /> {t('dash.daySummary')}</button>
        </div>
      </div>

      {recon && (
        <div className={`alert ${Math.abs(recon.variance) < 0.01 ? 'success' : 'warn'}`} style={{ padding: 10, borderRadius: 8, marginBottom: 12 }}>
          {Math.abs(recon.variance) < 0.01
            ? `✓ Day closed and matches — reconciled by ${recon.reconciled_by_name || 'a team member'}`
            : `⚠ Day closed with a variance of SAR ${fmt(Math.abs(recon.variance))} (${recon.variance > 0 ? 'over' : 'short'}) — reconciled by ${recon.reconciled_by_name || 'a team member'}`}
          {can('day.reopen') && (
            <button type="button" className="btn small" style={{ marginInlineStart: 12 }} onClick={() => { setReopenReason(''); setReopenErr(''); setShowReopen(true); }}>{t('dash.reopenDay')}</button>
          )}
        </div>
      )}
      {mismatches.length > 0 && (
        <div className="alert warn" style={{ padding: 10, borderRadius: 8, marginBottom: 12 }}>
          ⚠ {mismatches.length} {mismatches.length === 1 ? 'entry has' : 'entries have'} a cash/card split that doesn't match its total
        </div>
      )}
      {balanceWarnings.map((w, i) => (
        <div key={i} className="alert warn" style={{ padding: 10, borderRadius: 8, marginBottom: 12 }}>⚠ {w}</div>
      ))}

      <div className="ledger-strip">
        <div className="ledger-strip-head">
          <div className="ledger-strip-title">{t('dash.weightDist')}</div>
          <div className="ledger-strip-title" style={{ color: 'var(--gold-21)' }}>{weightSegs.totalW.toFixed(1)}g total</div>
        </div>
        <div className="purity-bar" style={{ display: 'flex', height: 10, borderRadius: 6, overflow: 'hidden', background: 'var(--surface-3)' }}>
          {weightSegs.segs.map(s => (
            <div key={s.label} style={{ width: `${(s.w / weightSegs.totalW) * 100}%`, background: s.color }} title={`${s.label}: ${s.w.toFixed(1)}g`} />
          ))}
          {weightSegs.totalW === 0 && <div style={{ width: '100%', color: 'var(--cream-faint)', fontSize: 12, textAlign: 'center' }}>{t('dash.noSalesWeightToday')}</div>}
        </div>
        <div className="purity-legend" style={{ display: 'flex', gap: 16, marginTop: 8, flexWrap: 'wrap' }}>
          {weightSegs.segs.map(s => (
            <span key={s.label} style={{ fontSize: 12.5, color: 'var(--cream-dim)' }}>
              <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: s.color, marginRight: 5 }} />
              {s.label}: {s.w.toFixed(1)}g
            </span>
          ))}
        </div>
      </div>

      <div className="cards-grid">
        <div className="card">
          <div className="card-accent" style={{ background: 'linear-gradient(90deg, var(--silver), #d0dadf)' }}></div>
          <div className="card-label">{t('dash.openingCash')}</div>
          <div className="card-value silver"><IconSaudiRiyal /> {fmt(opening.cash)}</div>
        </div>
        <div className="card">
          <div className="card-accent" style={{ background: 'linear-gradient(90deg, var(--gold-21), var(--gold-24))' }}></div>
          <div className="card-label">{t('dash.todaySales')}</div>
          <div className="card-value emerald"><IconSaudiRiyal /> <CountUp value={salesTotal} /></div>
          <div className="card-delta" style={{ color: 'var(--accent-green)' }}>{sales.length} {t('card.activeinvoices')}</div>
          <div style={{ marginTop: 8 }}><Sparkline data={trend7.salesTrend} color="var(--gold-21)" /></div>
        </div>
        <div className="card">
          <div className="card-accent" style={{ background: 'linear-gradient(90deg, var(--accent-blue), #4A9FD8)' }}></div>
          <div className="card-label">{t('dash.todayPurchases')}</div>
          <div className="card-value blue"><IconSaudiRiyal /> <CountUp value={purchaseTotal} /></div>
          <div className="card-delta">{purchases.length} {t('card.purchaseinvoices')}</div>
          <div style={{ marginTop: 8 }}><Sparkline data={trend7.purchTrend} color="var(--accent-blue)" /></div>
        </div>
        <div className="card">
          <div className="card-accent" style={{ background: systemClosingCash < 0 ? 'linear-gradient(90deg, var(--red), #e07a64)' : 'linear-gradient(90deg, var(--emerald), #7FBF9B)' }}></div>
          <div className="card-label">{t('dash.closingCash')}</div>
          <div className={`card-value ${systemClosingCash < 0 ? 'red' : 'emerald'}`}><IconSaudiRiyal /> {fmt(systemClosingCash)}</div>
          <div className="card-delta">{t('card.aftersales')}</div>
        </div>
        <div className="card">
          <div className="card-accent" style={{ background: 'linear-gradient(90deg, var(--red), #e07a64)' }}></div>
          <div className="card-label">{t('dash.todayExpense')}</div>
          <div className="card-value red"><IconSaudiRiyal /> <CountUp value={pureExpenseTotal} /></div>
          <div className="card-delta">{pureExpenses.length} {t('card.expenseinvoices')}</div>
        </div>
        {user?.role !== 'cashier' && (
          <>
            <div className="card">
              <div className="card-accent" style={{ background: 'linear-gradient(90deg, var(--gold-21), var(--gold-24))' }}></div>
              <div className="card-label">{t('dash.goldSale')}</div>
              <div className="card-value emerald"><CountUp value={goldSaleWeight} decimals={1} suffix="g" /></div>
              <div className="card-delta">{t('card.21keq')}</div>
            </div>
            <div className="card">
              <div className="card-accent" style={{ background: 'linear-gradient(90deg, var(--red), #e07a64)' }}></div>
              <div className="card-label">{t('dash.goldPurchases')}</div>
              <div className="card-value red"><CountUp value={goldPurchaseWeight} decimals={1} suffix="g" /></div>
              <div className="card-delta">{t('card.21keq')}</div>
            </div>
            <div className="card">
              <div className="card-accent" style={{ background: goldBalance < 0 ? 'linear-gradient(90deg, var(--red), #e07a64)' : 'linear-gradient(90deg, var(--silver), #d0dadf)' }}></div>
              <div className="card-label">{t('dash.goldBalance')}</div>
              <div className={`card-value ${goldBalance < 0 ? 'red' : 'silver'}`}><CountUp value={goldBalance} decimals={1} suffix="g" /></div>
              <div className="card-delta">{t('card.21keq')}</div>
            </div>
            <div className="card">
              <div className="card-accent" style={{ background: 'linear-gradient(90deg, var(--accent-blue), #4A9FD8)' }}></div>
              <div className="card-label">{t('dash.supplierPaid')}</div>
              <div className="card-value blue"><IconSaudiRiyal /> <CountUp value={kpiExtra.supAmount} /></div>
              <div className="card-delta">{kpiExtra.supCount} {t('card.supplierentries')} · {kpiExtra.supGold.toFixed(1)}g {t('card.21keq')}</div>
            </div>
            <div className="card">
              <div className="card-accent" style={{ background: 'linear-gradient(90deg, #C9772B, #E0A25F)' }}></div>
              <div className="card-label">{t('dash.scrapPurchase')}</div>
              <div className="card-value red"><IconSaudiRiyal /> <CountUp value={kpiExtra.scrapAmount} /></div>
              <div className="card-delta">{kpiExtra.scrapCount} {t('card.scrapentries')} · {kpiExtra.scrapGold.toFixed(1)}g {t('card.21keq')}</div>
            </div>
            <div className="card">
              <div className="card-accent" style={{ background: 'linear-gradient(90deg, var(--silver), #d0dadf)' }}></div>
              <div className="card-label">{t('dash.silverToday')}</div>
              <div className="card-value silver"><CountUp value={kpiExtra.silverSold} decimals={1} suffix="g" /></div>
              <div className="card-delta">{t('dash.silverBought')}: {kpiExtra.silverBought.toFixed(1)}g · {t('dash.silverSupplier')}: {kpiExtra.silverSupplier.toFixed(1)}g</div>
            </div>
            {owingShops.length > 0 && (
              <div className="card">
                <div className="card-accent" style={{ background: 'linear-gradient(90deg, #B0592F, #D58A5E)' }}></div>
                <div className="card-label">{t('loans.outWithShops')}</div>
                <div className="card-value red"><CountUp value={goldOutWithShops} decimals={1} suffix="g" /></div>
                <div className="card-delta">{tf('loans.shopsCount', { n: owingShops.length })} · {t('card.21keq')}</div>
              </div>
            )}
            <div className="card">
              <div className="card-accent" style={{ background: 'linear-gradient(90deg, var(--gold-21), var(--gold-24))' }}></div>
              <div className="card-label">{t('dash.entriesToday')}</div>
              <div className="card-value"><CountUp value={dayEntries.length} /></div>
            </div>
          </>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 16, marginBottom: 16 }}>
        <div className="panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
            <div className="panel-title" style={{ marginBottom: 0 }}>{t('dash.cashFlowInOut')}</div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ fontSize: 12.5, color: 'var(--cream-dim)' }}>{t('dash.last')}</span>
              <input
                type="number" min="1" max="60" value={cashFlowCount}
                onChange={e => setCashFlowCount(e.target.value)}
                style={{ width: 56, padding: '5px 6px', textAlign: 'center', fontSize: 13, fontFamily: "'IBM Plex Mono', monospace", background: 'var(--surface-2)', border: '1.5px solid var(--line)', borderRadius: 7, color: 'var(--cream)' }}
              />
              <select
                value={cashFlowUnit} onChange={e => setCashFlowUnit(e.target.value)}
                style={{ padding: '5px 8px', fontSize: 13, background: 'var(--surface-2)', border: '1.5px solid var(--line)', borderRadius: 7, color: 'var(--cream)' }}
              >
                <option value="day">{t('dash.unitDay')}</option>
                <option value="week">{t('dash.unitWeek')}</option>
                <option value="month">{t('dash.unitMonth')}</option>
                <option value="year">{t('dash.unitYear')}</option>
              </select>
            </div>
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--cream-faint)', marginBottom: 10, fontFamily: "'IBM Plex Mono', monospace" }}>
            {cashFlowBuckets.length > 0 && `${cashFlowBuckets[0].days[0]} → ${cashFlowBuckets[cashFlowBuckets.length - 1].days[cashFlowBuckets[cashFlowBuckets.length - 1].days.length - 1]}`}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 14 }}>
            <div style={{ background: 'var(--surface-2)', borderRadius: 8, padding: '8px 12px' }}>
              <div style={{ fontSize: 11, color: 'var(--cream-faint)' }}>{t('dash.cashIn')}</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--accent-green)' }}><IconSaudiRiyal size={12} /> {fmt(cashFlowData.totalIn)}</div>
            </div>
            <div style={{ background: 'var(--surface-2)', borderRadius: 8, padding: '8px 12px' }}>
              <div style={{ fontSize: 11, color: 'var(--cream-faint)' }}>{t('dash.cashOut')}</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--accent-red)' }}><IconSaudiRiyal size={12} /> {fmt(cashFlowData.totalOut)}</div>
            </div>
            <div style={{ background: 'var(--surface-2)', borderRadius: 8, padding: '8px 12px' }}>
              <div style={{ fontSize: 11, color: 'var(--cream-faint)' }}>{t('dash.netTotal')}</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: cashFlowData.net < 0 ? 'var(--accent-red)' : 'var(--gold-21)' }}><IconSaudiRiyal size={12} /> {fmt(cashFlowData.net)}</div>
            </div>
          </div>
          <div style={{ height: 240 }}><canvas ref={cashCanvasRef} /></div>
        </div>
        <div className="panel">
          <div className="panel-title" style={{ marginBottom: 16 }}>{t('dash.salesByKarat')}</div>
          <div style={{ height: 240, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 20 }}>
            {weightSegs.totalW > 0 ? (
              <>
                <DonutChart
                  data={weightSegs.segs.map(s => ({ label: s.label, value: s.w, color: s.color }))}
                  size={160}
                  strokeWidth={22}
                  centerContent={
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--cream)' }}>{weightSegs.totalW.toFixed(1)}g</div>
                      <div style={{ fontSize: 10.5, color: 'var(--cream-faint)' }}>{t('dash.totalWord')}</div>
                    </div>
                  }
                />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {weightSegs.segs.map(s => (
                    <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5 }}>
                      <span style={{ width: 9, height: 9, borderRadius: '50%', background: s.color, flexShrink: 0 }} />
                      <span style={{ color: 'var(--cream-dim)' }}>{s.label}</span>
                      <span style={{ color: 'var(--cream-faint)' }}>{s.w.toFixed(1)}g</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div style={{ color: 'var(--cream-faint)', fontSize: 13, textAlign: 'center' }}>{t('dash.noSalesWeightShort')}</div>
            )}
          </div>
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-title" style={{ marginBottom: 16 }}>{t('dash.exhibitionOverview')}</div>
        <div className="overview-grid">
          <div className="overview-card">
            <div className="ov-label">{t('dash.daysTracked')}</div>
            <div className="ov-value">{allDays.length}</div>
          </div>
          <div className="overview-card">
            <div className="ov-label">{t('dash.allTimeSales')}</div>
            <div className="ov-value">{fmt(overviewTotals.totalSales)}</div>
          </div>
          <div className="overview-card">
            <div className="ov-label">{t('dash.allTimePurchases')}</div>
            <div className="ov-value">{fmt(overviewTotals.totalPurchases)}</div>
          </div>
          <div className="overview-card">
            <div className="ov-label">{t('dash.totalInvoices')}</div>
            <div className="ov-value">{overviewTotals.totalCount}</div>
          </div>
        </div>
      </div>

      <form className="panel" onSubmit={saveOpening} style={{ marginTop: 20, maxWidth: 520 }}>
        <div className="panel-title" style={{ marginBottom: 16 }}>{t('dash.openingBalance')} — {activeDay}</div>
        <div className="form-grid">
          <div className="form-field">
            <label>{t('entry.cash')}</label>
            <input type="number" min="0" step="0.01" value={openingForm.cash}
              onChange={e => setOpeningForm(f => ({ ...f, cash: e.target.value }))} />
          </div>
          <div className="form-field">
            <label>{t('dash.goldGrams')}</label>
            <input type="number" min="0" step="0.001" value={openingForm.gold}
              onChange={e => setOpeningForm(f => ({ ...f, gold: e.target.value }))} />
          </div>
          <div className="form-field">
            <label>{t('dash.silverGrams')}</label>
            <input type="number" min="0" step="0.001" value={openingForm.silver}
              onChange={e => setOpeningForm(f => ({ ...f, silver: e.target.value }))} />
          </div>
        </div>
        <button className="btn gold" type="submit" disabled={savingOpening} style={{ marginTop: 14 }}>
          {savingOpening ? t('common.saving') : t('dash.saveOpening')}
        </button>
      </form>

      {showReopen && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(4,6,13,.6)', overflowY: 'auto', padding: '24px 16px' }}
          onClick={e => { if (e.target === e.currentTarget) setShowReopen(false); }}
        >
          <form className="panel" onSubmit={doReopen} style={{ width: 440, maxWidth: '92vw', margin: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}>
              <div className="panel-title">{tf('dash.reopenTitle', { day: activeDay })}</div>
              <button className="btn ghost sm" type="button" onClick={() => setShowReopen(false)}>✕</button>
            </div>
            <p style={{ color: 'var(--cream-dim)', fontSize: 13.5, marginBottom: 12 }}>{t('dash.reopenHint')}</p>
            <div className="form-field" style={{ marginBottom: 14 }}>
              <label>{t('dash.reopenReason')}</label>
              <input value={reopenReason} onChange={e => { setReopenReason(e.target.value); setReopenErr(''); }} autoFocus />
            </div>
            {reopenErr && <div className="login-err" style={{ display: 'block', marginBottom: 12 }}>⚠ {reopenErr}</div>}
            <button className="btn gold" type="submit" disabled={reopening}>{reopening ? t('common.saving') : t('dash.reopenConfirm')}</button>
          </form>
        </div>
      )}
      {showReconcile && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(4,6,13,.6)', overflowY: 'auto', padding: '24px 16px' }}
          onClick={e => { if (e.target === e.currentTarget) setShowReconcile(false); }}
        >
          <form className="panel" onSubmit={saveReconciliation} style={{ width: 440, maxWidth: '92vw', margin: 'auto', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}>
              <div className="panel-title">{tf('dash.closeDayTitle', { day: activeDay })}</div>
              <button className="btn ghost sm" type="button" onClick={() => setShowReconcile(false)}>✕</button>
            </div>
            <p style={{ color: 'var(--cream-dim)', fontSize: 13.5, marginBottom: 12 }}>
              {t('dash.systemClosingCash')}: <strong><IconSaudiRiyal /> {fmt(systemClosingCash)}</strong>
            </p>
            <div className="form-field" style={{ marginBottom: 14 }}>
              <label>{t('dash.countedCash')}</label>
              <input type="number" step="0.01" value={countedCash} onChange={e => setCountedCash(e.target.value)} />
            </div>
            <div className="form-field" style={{ marginBottom: 14 }}>
              <label>{t('dash.noteOptional')}</label>
              <input value={reconNote} onChange={e => setReconNote(e.target.value)} />
            </div>
            {owingShops.length > 0 && (
              <div className="alert warn" style={{ display: 'block', padding: 10, borderRadius: 8, marginBottom: 14, fontSize: 13 }}>
                <strong>{tf('loans.pendingAtClose', { n: owingShops.length })}</strong>
                {owingShops.map(sh => (
                  <div key={sh.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginTop: 4 }}>
                    <span>{sh.name}</span>
                    <span style={{ direction: 'ltr', unicodeBidi: 'isolate' }}>{[['24K', sh.balance.w24], ['21K', sh.balance.w21], ['18K', sh.balance.w18], ['Silver', sh.balance.silver]].filter(([, w]) => w > 0.0005).map(([k, w]) => `${k} ${Number(w).toFixed(2)}g`).join(' · ')}</span>
                  </div>
                ))}
              </div>
            )}
            {countedCash !== '' && (
              <div className={`alert ${Math.abs((Number(countedCash) || 0) - systemClosingCash) < 0.01 ? 'success' : 'warn'}`} style={{ padding: 10, borderRadius: 8, marginBottom: 14 }}>
                {Math.abs((Number(countedCash) || 0) - systemClosingCash) < 0.01
                  ? `✓ ${t('dash.matchesSystemTotal')}`
                  : `⚠ ${tf((Number(countedCash) || 0) > systemClosingCash ? 'dash.overBy' : 'dash.shortBy', { amt: fmt(Math.abs((Number(countedCash) || 0) - systemClosingCash)) })}`}
              </div>
            )}
            {reconError && <div className="login-err" style={{ display: 'block' }}>⚠ {reconError}</div>}
            <button className="btn gold" type="submit" disabled={savingRecon}>{savingRecon ? t('common.saving') : t('dash.confirmCloseDay')}</button>
          </form>
        </div>
      )}
    </section>
  );
}
