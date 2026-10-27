import { SUPPLIER_METAL_DEDUCTION_CUTOVER } from '../lib/ledger.js';
import { loanFlows } from '../lib/loans.js';
import { useEffect, useMemo, useRef, useState } from 'react';
import Chart from 'chart.js/auto';
import jsPDF from 'jspdf';
import { apiGet, apiPut } from '../lib/api';
import { useAuth } from '../context/AuthContext.jsx';
import { subscribeToActivityFeed } from '../lib/activityFeed';
import { useLanguage } from '../context/LanguageContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import AppLoader from '../components/AppLoader.jsx';
import { DownloadButton } from '../components/ui/download-animation.tsx';
import CountUp from '../components/CountUp.jsx';
import { DonutChart } from '../components/ui/donut-chart.tsx';
import Sparkline from '../components/Sparkline.jsx';
import { KpiCard } from '../components/ui/kpi-card.tsx';
import { Typewriter } from '../components/ui/typewriter.tsx';
import { ScrambleResolve } from '../components/ui/scramble-resolve.tsx';
import DateField from '../components/DateField.jsx';
import { IconLock, IconDownload, IconSaudiRiyal } from '../components/Icons.jsx';

function toLocalDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const g1 = (n) => `${Number(n || 0).toFixed(1)}g`;

function fmt(n) {
  return Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
}

const isSale = (e) => e.category === 'sale';
const isPurchase = (e) => e.category === 'purchase_jewelry' || e.category === 'purchase_scrap';
const isExpense = (e) => e.category === 'expense';
const isCashOnly = (e) => (e.category === 'supplier_payment' || e.category === 'expense') && e.payment_source !== 'cash_deposit';
const isCashAdd = (e) => e.category === 'cash_adjustment';

// Supplier-payment gold/silver weight only counts against the balance for
// invoices dated on/after this cutover. Older supplier-payment invoices
// were never deducted before this fix shipped, and the business already
// accounted for that gold/silver by hand outside the app — so re-applying
// the new deduction rule to them retroactively would double-count it.
// Change this date (YYYY-MM-DD) if a different cutover is needed.
const isSupplierMetalDeductible = (e) =>
  e.category === 'supplier_payment' && e.invoice_date >= SUPPLIER_METAL_DEDUCTION_CUTOVER;

export default function Dashboard() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const { t, tf, lang } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [cashFlowCount, setCashFlowCount] = useState(7);
  const [cashFlowUnit, setCashFlowUnit] = useState('day');
  const [liveBanners, setLiveBanners] = useState([]);
  const activeDayRef = useRef(null);
  const [error, setError] = useState('');
  const [entries, setEntries] = useState([]);
  const [dailySummary, setDailySummary] = useState({});
  // Gold/silver lent to other shops (see pages/ShopLoans.jsx): shifts the cash/gold/silver balances below.
  const [loansByDay, setLoansByDay] = useState({});
  const [loanShops, setLoanShops] = useState([]);
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
        // Shop-loans must never be able to break the Dashboard — if the endpoint is unavailable the rest still loads.
        apiGet(`/shop-loans/daily-summary`).catch(() => ({})),
        apiGet(`/shop-loans/shops`).catch(() => []),
      ]);

      const list = Array.isArray(invoicesRes) ? invoicesRes : invoicesRes?.items || [];
      setEntries(list);
      setDailySummary(summaryRes || {});
      setLoansByDay(loansRes || {});
      setLoanShops(Array.isArray(loanShopsRes) ? loanShopsRes : []);
      setContacts(contactsRes || []);

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
      const loanDays = Object.keys(loansRes || {});
      const days = [...new Set([...summaryDays, ...listDays, ...loanDays])].filter(Boolean).sort();
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
      // Pull the active day's invoices again and merge them in, so the KPI
      // cards and the Live Activity feed update the moment someone saves.
      const day = activeDayRef.current;
      if (day) {
        apiGet(`/invoices?invoice_date=${day}&limit=500`)
          .then(res => {
            const list = Array.isArray(res) ? res : res?.items || [];
            if (!list.length) return;
            setEntries(prev => {
              const byId = new Map(prev.map(e => [e.id, e]));
              list.forEach(e => byId.set(e.id, e));
              return [...byId.values()];
            });
          })
          .catch(() => {});
      }
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
    const toK24Local = (w, k) => w * (k / 24);
    const convOfSums = (catSummary) => {
      if (!catSummary) return 0;
      return toK24Local(catSummary.w21 || 0, 21) + toK24Local(catSummary.w18 || 0, 18) + (catSummary.w24 || 0);
    };
    const silverOfSums = (catSummary) => (catSummary?.wSilver || 0);
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
      const dLoan = loanFlows(loansByDay[day]);
      const dClosingCash = dOpenCash + dSalesCash + dCashAddTotal + dLoan.settledCash - dPurchaseCash - dExpenseCash;

      // Gold/silver paid to a supplier leaves the business just like a
      // sale does, so it's subtracted alongside sales, not lumped in with
      // cash-only expenses (which don't move metal at all). Only counted
      // for days on/after SUPPLIER_METAL_DEDUCTION_CUTOVER, so older
      // supplier-payment invoices (already handled manually before this
      // fix existed) don't get double-deducted.
      const dSupplierConvDeductible = day >= SUPPLIER_METAL_DEDUCTION_CUTOVER ? convOfSums(daySum.supplier_payment) : 0;
      const dSupplierSilverDeductible = day >= SUPPLIER_METAL_DEDUCTION_CUTOVER ? silverOfSums(daySum.supplier_payment) : 0;

      const dSalesConv = convOfSums(daySum.sale) + dSupplierConvDeductible;
      const dPurchConv = convOfSums(daySum.purchase_jewelry) + convOfSums(daySum.purchase_scrap);
      const dClosingGold = dOpenGold - dSalesConv + dPurchConv - dLoan.lentGold + dLoan.returnedGold;

      const dSilverSales = silverOfSums(daySum.sale) + dSupplierSilverDeductible;
      const dSilverPurch = silverOfSums(daySum.purchase_jewelry) + silverOfSums(daySum.purchase_scrap);
      const dClosingSilver = dOpenSilver - dSilverSales + dSilverPurch - dLoan.lentSilver + dLoan.returnedSilver;

      result[day] = { cash: dClosingCash, gold: dClosingGold, silver: dClosingSilver };
      carryCash = dClosingCash; carryGold = dClosingGold; carrySilver = dClosingSilver;
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
    showToast(t('toast.dayAdded'), 'success');
  }

  const dayEntries = useMemo(
    () => entries.filter(e => e.invoice_date === activeDay && e.status !== 'canceled'),
    [entries, activeDay]
  );
  const sales = dayEntries.filter(isSale);
  const purchases = dayEntries.filter(isPurchase);
  const pureExpenses = dayEntries.filter(isExpense);
  // A Supplier Payment can be settled partly/fully in gold or silver
  // instead of cash — that metal physically leaves the business the same
  // way a sale's metal does, so it must count as an OUTFLOW against the
  // gold/silver balance even though it isn't revenue (isCashOnly already
  // keeps its cash leg out of the sales/purchase cash totals). Only
  // invoices on/after SUPPLIER_METAL_DEDUCTION_CUTOVER are included — see
  // the comment there for why older ones are deliberately skipped.
  const supplierPayments = dayEntries.filter(isSupplierMetalDeductible);

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

  const toK24 = (w, k) => w * (k / 24);
  const goldSaleWeight = useMemo(() =>
    sales.reduce((s, e) =>
      s + toK24(Number(e.weight_21k || 0), 21) + toK24(Number(e.weight_18k || 0), 18) + Number(e.weight_24k || 0), 0),
  [sales]);
  const goldPurchaseWeight = useMemo(() =>
    purchases.reduce((s, e) =>
      s + toK24(Number(e.weight_21k || 0), 21) + toK24(Number(e.weight_18k || 0), 18) + Number(e.weight_24k || 0), 0),
  [purchases]);

  const silverSaleWeight = useMemo(() =>
    sales.reduce((s, e) => s + Number(e.weight_silver || 0), 0),
  [sales]);
  const silverPurchaseWeight = useMemo(() =>
    purchases.reduce((s, e) => s + Number(e.weight_silver || 0), 0),
  [purchases]);

  // Gold/silver handed to a supplier as payment — same direction as a
  // sale (leaves the business) but tracked separately so it never gets
  // counted as sales revenue.
  const goldSupplierWeight = useMemo(() =>
    supplierPayments.reduce((s, e) =>
      s + toK24(Number(e.weight_21k || 0), 21) + toK24(Number(e.weight_18k || 0), 18) + Number(e.weight_24k || 0), 0),
  [supplierPayments]);
  const silverSupplierWeight = useMemo(() =>
    supplierPayments.reduce((s, e) => s + Number(e.weight_silver || 0), 0),
  [supplierPayments]);

  const goldBalance = useMemo(() => {
    // Sales send gold OUT of the tray, purchases (buying jewelry/scrap from
    // customers) bring gold IN — the previous version had both signs
    // inverted, so heavier sales days made the gold balance look bigger.
    // Gold given to a supplier as payment is also an OUTFLOW.
    // Gold lent to a shop leaves the tray and comes back when they return it.
    return (opening.gold || 0) - goldSaleWeight - goldSupplierWeight + goldPurchaseWeight - dayLoan.lentGold + dayLoan.returnedGold;
  }, [goldSaleWeight, goldSupplierWeight, goldPurchaseWeight, opening.gold, dayLoan.lentGold, dayLoan.returnedGold]);

  const silverBalance = useMemo(() => {
    return (opening.silver || 0) - silverSaleWeight - silverSupplierWeight + silverPurchaseWeight - dayLoan.lentSilver + dayLoan.returnedSilver;
  }, [silverSaleWeight, silverSupplierWeight, silverPurchaseWeight, opening.silver, dayLoan.lentSilver, dayLoan.returnedSilver]);

  // Shops that still hold our gold/silver right now (all-time balance, not just today's day).
  const owingShops = useMemo(() => loanShops.filter(sh => (sh.balance_24k_eq || 0) > 0.0005 || (sh.balance?.silver || 0) > 0.0005), [loanShops]);
  const goldOutWithShops = owingShops.reduce((a, sh) => a + (sh.balance_24k_eq || 0), 0);

  const balanceWarnings = [];
  if (systemClosingCash < 0) balanceWarnings.push(tf('dash.negCashWarn', { amt: Math.abs(systemClosingCash).toFixed(2) }));
  if (goldBalance < 0) balanceWarnings.push(tf('dash.negGoldWarn', { amt: Math.abs(goldBalance).toFixed(1) }));
  if (silverBalance < 0) balanceWarnings.push(tf('dash.negSilverWarn', { amt: Math.abs(silverBalance).toFixed(1) }));


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
      showToast(t('toast.dayClosed'), 'success');
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
    doc.text(`Gold Balance (24K-eq): ${goldBalance.toFixed(1)}g`, 20, y); y += 16;
    doc.text(`Silver Balance: ${silverBalance.toFixed(1)}g`, 20, y);

    doc.save(`swag-gold-day-summary-${activeDay}.pdf`);
  }

  if (loading) return <AppLoader />;
  if (error) return <div className="login-err" style={{ display: 'block' }}>⚠ {error}</div>;

  activeDayRef.current = activeDay;

  // KPI tiles — rendered with the KpiCard ported from Swag Maintenance.
  const riyal = <IconSaudiRiyal />;
  const kpiCards = [
    { icon: 'ri-wallet-3-line', label: t('dash.openingCash'), value: Number(opening.cash) || 0, format: fmt, prefix: riyal, color: '#7A8C99' },
    { icon: 'ri-shopping-bag-3-line', label: t('dash.todaySales'), value: salesTotal, format: fmt, prefix: riyal, color: '#2A7A5A', hint: `${sales.length} ${t('card.activeinvoices')}`, footer: <Sparkline data={trend7.salesTrend} color="var(--gold-21)" /> },
    { icon: 'ri-shopping-cart-2-line', label: t('dash.todayPurchases'), value: purchaseTotal, format: fmt, prefix: riyal, color: '#1D5C8C', hint: `${purchases.length} ${t('card.purchaseinvoices')}`, footer: <Sparkline data={trend7.purchTrend} color="var(--accent-blue)" /> },
    { icon: 'ri-safe-2-line', label: t('dash.closingCash'), value: systemClosingCash, format: fmt, prefix: riyal, color: systemClosingCash < 0 ? '#C04840' : '#2A7A5A', alert: systemClosingCash < 0, hint: t('card.aftersales') },
    { icon: 'ri-money-dollar-circle-line', label: t('dash.todayExpense'), value: pureExpenseTotal, format: fmt, prefix: riyal, color: '#C04840', hint: `${pureExpenses.length} ${t('card.expenseinvoices')}` },
    ...(user?.role !== 'cashier' ? [
      { icon: 'ri-medal-line', label: t('dash.goldSale'), value: goldSaleWeight, format: g1, color: '#D4AA30', hint: t('card.24keq') },
      { icon: 'ri-vip-diamond-line', label: t('dash.goldPurchases'), value: goldPurchaseWeight, format: g1, color: '#C04840', hint: t('card.24keq') },
      { icon: 'ri-scales-3-line', label: t('dash.goldBalance'), value: goldBalance, format: g1, color: goldBalance < 0 ? '#C04840' : '#D4AA30', alert: goldBalance < 0, hint: t('card.24keq') },
      ...(owingShops.length ? [{ icon: 'ri-store-2-line', label: t('loans.outWithShops'), value: goldOutWithShops, format: g1, color: '#B0592F', hint: tf('loans.shopsCount', { n: owingShops.length }) }] : []),
      { icon: 'ri-coin-line', label: t('dash.silverSale'), value: silverSaleWeight, format: g1, color: '#7A8C99' },
      { icon: 'ri-coins-line', label: t('dash.silverPurchases'), value: silverPurchaseWeight, format: g1, color: '#C04840' },
      { icon: 'ri-scales-line', label: t('dash.silverBalance'), value: silverBalance, format: g1, color: silverBalance < 0 ? '#C04840' : '#7A8C99', alert: silverBalance < 0 },
      { icon: 'ri-file-list-3-line', label: t('dash.entriesToday'), value: dayEntries.length, format: (n) => String(Math.round(n)), color: '#B8901F' },
    ] : []),
  ];

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
          <div className="page-title"><ScrambleResolve key={t('dash.title')} text={t('dash.title')} delay={150} duration={1000} scrambleColor="var(--gold-21)" /></div>
          <div className="page-subtitle">{activeDay}</div>
        </div>
        <div className="dash-tagline" style={{
          flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
          gap: 10, minWidth: 220, padding: '0 20px',
        }}>
          <div style={{
            fontSize: 15, fontWeight: 500, color: 'var(--cream-dim)', textAlign: 'center',
            fontFamily: 'Fraunces, serif',
          }}>
            <Typewriter
              text={
                lang === 'ar'
                  ? ['تتبع مبيعاتك ومشترياتك لحظياً', 'أغلق اليوم بعد مطابقة الرصيد', 'راجع سير عمل اليوم من القائمة الجانبية']
                  : ['Track today\u2019s sales and purchases live', 'Close the day once the balance is reconciled', 'Check Day Workflow in the sidebar for a full status view']
              }
              speed={35}
              waitTime={2500}
              deleteSpeed={15}
              cursorClassName="text-[var(--gold-21)]"
            />
          </div>
        </div>
        <div className="topbar-actions">
          <DateField value={activeDay} onChange={e => setActiveDay(e.target.value)} className="dash-date-picker" />
          <button className="btn small" onClick={addNewDay}>+ {t('dash.newDay')}</button>
          <button className="btn small" onClick={openReconcile} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><IconLock size={14} /> {t('dash.closeDay')}</button>
          <span className="tw-preflight" style={{ display: 'inline-flex', marginInlineEnd: 52 }}>
            <DownloadButton label={t('dash.daySummary')} color="#C49A1E" size={36} width={186} onDownload={() => exportDayPDF()} />
          </span>
        </div>
      </div>

      {recon && (
        <div className={`alert ${Math.abs(recon.variance) < 0.01 ? 'success' : 'warn'}`} style={{ padding: 10, borderRadius: 8, marginBottom: 12 }}>
          {Math.abs(recon.variance) < 0.01
            ? tf('dash.closedMatch', { name: recon.reconciled_by_name || t('dash.teamMember') })
            : tf('dash.closedVar', { amt: fmt(Math.abs(recon.variance)), dir: recon.variance > 0 ? t('dash.over') : t('dash.short'), name: recon.reconciled_by_name || t('dash.teamMember') })}
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
          <div className="ledger-strip-title" style={{ color: 'var(--gold-21)' }}>{weightSegs.totalW.toFixed(1)}g {t('dash.totalWord')}</div>
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

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))', gap: 14, marginBottom: 28 }}>
        {kpiCards.map((k, i) => <KpiCard key={k.label} index={i} {...k} />)}
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
            <button className="btn gold" type="submit" disabled={savingRecon}>{savingRecon ? <><i className="ri-loader-4-line animate-spin" /> {t('common.saving')}</> : t('dash.confirmCloseDay')}</button>
          </form>
        </div>
      )}
    </section>
  );
}
