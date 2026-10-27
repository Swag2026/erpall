import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiGet } from '../lib/api';
import { useAuth } from '../context/AuthContext.jsx';
import { useLanguage } from '../context/LanguageContext.jsx';
import { computeLedger, summarizeLedger } from '../lib/ledger.js';
import { balanceChips, isOverdue, loanFlows } from '../lib/loans.js';
import { SkeletonPanel } from '../components/Skeleton.jsx';
import { ReportOverview } from '../components/ui/report-overview.tsx';

const pad = (n) => String(n).padStart(2, '0');
const toStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return toStr(d);
};
const lastNDays = (endIso, n) => Array.from({ length: n }, (_, i) => addDays(endIso, i - (n - 1)));

const KIND = {
  sale: 'sale', purchase_jewelry: 'purchase', purchase_scrap: 'purchase',
  supplier_payment: 'supplier', expense: 'expense', cash_adjustment: 'cash', cash_deposit: 'deposit',
};
const TITLE_KEY = {
  sale: 'entry.sale', purchase_jewelry: 'entry.purchaseJewelry', purchase_scrap: 'entry.purchaseScrap',
  supplier_payment: 'entry.supplierPayment', expense: 'entry.expense', cash_adjustment: 'entry.addCash',
  cash_deposit: 'cashDeposit.title',
};
const INCOMING = new Set(['sale', 'cash_adjustment', 'cash_deposit']);

function relTime(iso, t) {
  if (!iso) return '';
  const s = /Z|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`;
  const mins = Math.max(0, Math.round((Date.now() - new Date(s).getTime()) / 60000));
  if (mins < 1) return t('ov.now');
  if (mins < 60) return `${mins}${t('ov.min')}`;
  if (mins < 1440) return `${Math.round(mins / 60)}${t('ov.hr')}`;
  return `${Math.round(mins / 1440)}${t('ov.day')}`;
}

export default function ReportOverviewPage() {
  const { user } = useAuth();
  const { t, lang } = useLanguage();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [summary, openings, recons, loanDaily, shops, deposit, invoices] = await Promise.all([
          apiGet('/invoices/daily-summary'),
          apiGet('/day-openings'),
          apiGet('/reconciliations'),
          apiGet('/shop-loans/daily-summary').catch(() => null),
          apiGet('/shop-loans/shops').catch(() => null),
          apiGet('/cash-deposit/summary').catch(() => null),
          apiGet('/invoices?limit=8').catch(() => []),
        ]);
        if (alive) setData({ summary: summary || {}, openings, recons, loanDaily, shops, deposit, invoices });
      } catch (e) {
        if (alive) setError(e.message);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const view = useMemo(() => {
    if (!data) return null;
    const rows = computeLedger(data.summary, data.openings, data.recons, data.loanDaily || {});
    if (!rows.length) return { empty: true };
    const last = rows[rows.length - 1];
    const asOf = last.date;
    const byDate = Object.fromEntries(rows.map((r) => [r.date, r]));

    const days = lastNDays(asOf, 180);
    const salesDaily = days.map((d) => byDate[d]?.sales.total || 0);

    // Closing cash on (or before) the day 30 days ago, to show the 30-day change.
    const ref = addDays(asOf, -30);
    const before = [...rows].reverse().find((r) => r.date <= ref);
    const cashChange = last.closeCash - (before ? before.closeCash : rows[0].openCash);

    const d30 = lastNDays(asOf, 30);
    const entriesDaily = d30.map((d) => byDate[d]?.entries || 0);
    const sold = { w24: 0, w21: 0, w18: 0, silver: 0 };
    d30.forEach((d) => {
      const s = data.summary[d]?.sale;
      if (!s) return;
      sold.w24 += s.w24 || 0; sold.w21 += s.w21 || 0; sold.w18 += s.w18 || 0; sold.silver += s.wSilver || 0;
    });
    const win = rows.filter((r) => r.date >= d30[0]);
    const day = {
      closed: last.closed,
      closedBy: last.closedBy,
      variance: last.variance,
      closedDays30: win.filter((r) => r.closed).length,
      activeDays30: win.filter((r) => r.closed || r.entries > 0 || r.loan.count > 0).length,
    };

    const sm = summarizeLedger(win);
    const flow30 = { salesCash: sm.sales.cash, cashAdded: sm.cashAdded + sm.loan.settledCash, purchases: sm.purchases.cash, supplier: sm.supplier.cash, expenses: sm.expenses.cash };

    const today = toStr(new Date());
    let shops = [];
    let loans = null;
    if (Array.isArray(data.shops)) {
      const owing = data.shops.filter((s) => (s.balance_24k_eq || 0) > 0.0005 || (s.balance?.silver || 0) > 0.0005);
      shops = owing.map((s) => ({
        id: s.id, name: s.name, gold24eq: s.balance_24k_eq || 0, silver: s.balance?.silver || 0,
        chips: balanceChips(s.balance), openSince: s.open_since, overdue: isOverdue(s, today),
      }));
      loans = {
        goldOut: owing.reduce((a, s) => a + (s.balance_24k_eq || 0), 0),
        silverOut: owing.reduce((a, s) => a + (s.balance?.silver || 0), 0),
        shopCount: owing.length,
        overdueCount: shops.filter((s) => s.overdue).length,
        lentDaily: lastNDays(asOf, 10).map((d) => loanFlows((data.loanDaily || {})[d]).lentGold),
      };
    }

    const deposit = data.deposit
      ? { balance: data.deposit.balance || 0, deposited: data.deposit.total_deposited || 0, spent: data.deposit.total_spent || 0 }
      : null;

    const list = Array.isArray(data.invoices) ? data.invoices : data.invoices?.items || [];
    const nf = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
    const activity = list.slice(0, 6).map((e) => {
      const amt = e.total_amount || e.cash_amount || 0;
      return {
        id: String(e.id),
        kind: KIND[e.category] || 'cash',
        title: t(TITLE_KEY[e.category] || e.category),
        detail: [e.invoice_no, e.contact_name || e.description].filter(Boolean).join(' · '),
        amount: `${INCOMING.has(e.category) ? '+' : '−'}${nf.format(amt)}`,
        status: e.status === 'canceled' ? 'canceled' : 'active',
        time: relTime(e.created_at, t),
      };
    });

    return { rows, last, asOf, days, salesDaily, cashChange, entriesDaily, sold, flow30, day, shops, loans, deposit, activity };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, lang]);

  if (loading) return <SkeletonPanel />;

  return (
    <section className="view active">
      <div className="topbar">
        <div>
          <div className="page-title">{t('ov.title')}</div>
          <div className="page-subtitle">{t('ov.subtitle')}</div>
        </div>
      </div>

      {error && <div className="login-err" style={{ display: 'block', marginBottom: 16 }}>⚠ {error}</div>}
      {view?.empty && <div className="panel" style={{ padding: 24 }}>{t('ov.noData')}</div>}

      {view && !view.empty && (
        <div className="ov-dark">
          <ReportOverview
            t={t}
            locale={lang === 'ar' ? 'ar-SA-u-ca-gregory-nu-latn' : 'en-US'}
            account={user?.full_name || user?.username || ''}
            asOf={view.asOf}
            closeCash={view.last.closeCash}
            cashChange={view.cashChange}
            closeGold={view.last.closeGold}
            closeSilver={view.last.closeSilver}
            salesDaily={view.salesDaily}
            salesDates={view.days}
            entriesDaily={view.entriesDaily}
            sold={view.sold}
            flow30={view.flow30}
            day={view.day}
            shops={view.shops}
            loans={view.loans}
            deposit={view.deposit}
            activity={view.activity}
            onOpenLoans={() => navigate('/shop-loans')}
            onOpenDeposit={() => navigate('/cash-deposit')}
          />
        </div>
      )}
    </section>
  );
}
