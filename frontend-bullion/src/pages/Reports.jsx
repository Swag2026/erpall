import { useEffect, useState, useRef } from 'react';
import Chart from 'chart.js/auto';
import { apiGet } from '../lib/api';
import { AnimatedCard, CardBody, CardTitle, CardDescription, CardVisual, Visual3 } from '../components/ui/animated-card-chart.tsx';
import { todayLocalStr } from '../lib/dateUtils';
import { useLanguage } from '../context/LanguageContext.jsx';
import { SkeletonPanel } from '../components/Skeleton.jsx';
import DateField from '../components/DateField.jsx';
import { IconSaudiRiyal } from '../components/Icons.jsx';
import { DonutChart } from '../components/ui/donut-chart.tsx';
import DailyLedgerReport from '../components/DailyLedgerReport.jsx';

const EXPENSE_COLORS = ['#D4AF37', '#8A6FDF', '#4EA8DE', '#E8735C', '#5FBF8F', '#E0A93A', '#B0709B', '#6EC6C0'];

export default function Reports() {
  const { t } = useLanguage();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [summary, setSummary] = useState(null);
  const [dailyDate, setDailyDate] = useState(todayLocalStr());
  const [daily, setDaily] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [comparisonMode, setComparisonMode] = useState('week');
  const [comparison, setComparison] = useState(null);
  const [expenseData, setExpenseData] = useState(null);
  const [topCustomers, setTopCustomers] = useState(null);
  const [bySalesman, setBySalesman] = useState(null);

  async function loadComparison(mode) {
    try {
      setComparison(await apiGet(`/reports/comparison?mode=${mode}`));
    } catch (err) {
      setError(err.message);
    }
  }

  async function loadExpenseBreakdown() {
    try {
      setExpenseData(await apiGet('/reports/expense-breakdown'));
    } catch (err) {
      setError(err.message);
    }
  }

  async function loadTopCustomers() {
    try {
      setTopCustomers(await apiGet('/reports/top-customers?limit=5'));
    } catch (err) {
      setError(err.message);
    }
  }

  async function loadSummary() {
    setError('');
    try {
      const params = new URLSearchParams();
      if (from) params.set('start_date', from);
      if (to) params.set('end_date', to);
      setSummary(await apiGet(`/reports/summary?${params.toString()}`));
      setBySalesman(await apiGet(`/reports/by-salesman?${params.toString()}`));
    } catch (err) {
      setError(err.message);
    }
  }

  async function loadDaily(d) {
    try {
      setDaily(await apiGet(`/reports/daily?report_date=${d}`));
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    Promise.all([loadSummary(), loadDaily(dailyDate), loadComparison(comparisonMode), loadExpenseBreakdown(), loadTopCustomers()])
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) return <SkeletonPanel />;

  return (
    <section className="view active">
      <div className="topbar">
        <div>
          <div className="page-title">{t('reports.title')}</div>
          <div className="page-subtitle">{t('reports.subtitle')}</div>
        </div>
      </div>

      {error && <div className="login-err" style={{ display: 'block' }}>⚠ {error}</div>}

      <DailyLedgerReport />

      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-title" style={{ marginBottom: 12 }}>{t('reports.summary')}</div>
        <div className="filters-row">
          <div className="form-field"><label>{t('hist.fromDate')}</label><DateField value={from} onChange={e => setFrom(e.target.value)} /></div>
          <div className="form-field"><label>{t('hist.toDate')}</label><DateField value={to} onChange={e => setTo(e.target.value)} /></div>
          <div className="form-field" style={{ alignSelf: 'flex-end' }}>
            <button className="btn gold" type="button" onClick={loadSummary}>{t('common.apply')}</button>
          </div>
        </div>
        {summary && (
          <div className="cards-grid" style={{ marginTop: 16 }}>
            <div className="card"><div className="card-label">{t('reports.revenue')}</div><div className="card-value">{Number(summary.total_revenue).toLocaleString()}</div></div>
            <div className="card"><div className="card-label">{t('reports.purchases')}</div><div className="card-value">{Number(summary.total_purchases).toLocaleString()}</div></div>
            <div className="card"><div className="card-label">{t('reports.invoices')}</div><div className="card-value">{summary.total_invoices}</div></div>
            <div className="card"><div className="card-label">{t('reports.saleInvoices')}</div><div className="card-value">{summary.sale_invoices}</div></div>
            <div className="card"><div className="card-label">{t('reports.totalGold')}</div><div className="card-value">{Number(summary.total_gold_grams).toFixed(1)}</div></div>
          </div>
        )}
      </div>

      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-title" style={{ marginBottom: 12 }}>{t('reports.bySalesman')}</div>
        {bySalesman && bySalesman.salesmen.length > 0 ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>#</th><th>{t('reports.salesmanCol')}</th>
                  <th>{t('reports.salesmanSales')}</th><th>{t('reports.salesmanSalesCount')}</th>
                  <th>{t('reports.salesmanPurchases')}</th><th>{t('reports.salesmanPurchaseCount')}</th>
                </tr>
              </thead>
              <tbody>
                {bySalesman.salesmen.map((s, idx) => (
                  <tr key={s.salesman_id ?? 'none'}>
                    <td>{idx + 1}</td>
                    <td>{s.name || <span style={{ color: 'var(--cream-faint)' }}>{t('reports.noSalesman')}</span>}</td>
                    <td>{Number(s.sales_total).toLocaleString()}</td>
                    <td>{s.sales_count}</td>
                    <td>{Number(s.purchase_total).toLocaleString()}</td>
                    <td>{s.purchase_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ textAlign: 'center', color: 'var(--cream-faint)', padding: '30px 0' }}>{t('reports.noSalesmanData')}</div>
        )}
      </div>

      {((bySalesman && bySalesman.salesmen.length > 0) || comparison) && (
        <div className="tw-preflight" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 16, marginBottom: 16 }}>
          {bySalesman && bySalesman.salesmen.length > 0 && (
            <AnimatedCard className="max-w-none">
              <CardVisual>
                <Visual3
                  data={bySalesman.salesmen.slice(0, 12).map(s => ({ label: s.name || t('reports.noSalesman'), value: Number(s.sales_total) || 0 }))}
                  mainColor="#D4AA30"
                  secondaryColor="#7A8C99"
                  unit="SAR"
                />
              </CardVisual>
              <CardBody>
                <CardTitle>{t('reports.chartSalesBySalesman')}</CardTitle>
                <CardDescription>{t('reports.chartSalesBySalesmanSub')}</CardDescription>
              </CardBody>
            </AnimatedCard>
          )}
          {comparison && (
            <AnimatedCard className="max-w-none">
              <CardVisual>
                <Visual3
                  data={[
                    { label: t('reports.revenue'), value: Math.max(0, Number(comparison.current.revenue) || 0) },
                    { label: t('reports.purchases'), value: Math.max(0, Number(comparison.current.purchases) || 0) },
                    { label: t('reports.expenses'), value: Math.max(0, Number(comparison.current.expenses) || 0) },
                    { label: t('reports.profit'), value: Math.max(0, Number(comparison.current.profit) || 0) },
                  ]}
                  mainColor="#2A7A5A"
                  secondaryColor="#C04840"
                  unit="SAR"
                />
              </CardVisual>
              <CardBody>
                <CardTitle>{t('reports.chartPeriod')}</CardTitle>
                <CardDescription>{t('reports.chartPeriodSub')}</CardDescription>
              </CardBody>
            </AnimatedCard>
          )}
        </div>
      )}

      <div className="panel" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div className="panel-title">{t('reports.comparison')}</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              className={`btn ${comparisonMode === 'week' ? 'gold' : 'ghost'} sm`}
              onClick={() => { setComparisonMode('week'); loadComparison('week'); }}
            >{t('reports.thisWeek')}</button>
            <button
              className={`btn ${comparisonMode === 'month' ? 'gold' : 'ghost'} sm`}
              onClick={() => { setComparisonMode('month'); loadComparison('month'); }}
            >{t('reports.thisMonth')}</button>
          </div>
        </div>
        {comparison && (
          <div className="cards-grid">
            {[
              { key: 'revenue', label: t('reports.revenue') },
              { key: 'purchases', label: t('reports.purchases') },
              { key: 'expenses', label: t('reports.expenses') },
              { key: 'profit', label: t('reports.profit') },
            ].map(({ key, label }) => {
              const pct = comparison.change_pct[key];
              const positive = pct !== null && pct >= 0;
              return (
                <div className="card" key={key}>
                  <div className="card-label">{label}</div>
                  <div className="card-value">{Number(comparison.current[key]).toLocaleString()}</div>
                  {pct !== null ? (
                    <div style={{ fontSize: 12.5, fontWeight: 700, marginTop: 4, color: positive ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                      {positive ? '▲' : '▼'} {Math.abs(pct)}% {t('reports.vsLastPeriod')}
                    </div>
                  ) : (
                    <div style={{ fontSize: 12.5, color: 'var(--cream-faint)', marginTop: 4 }}>{t('reports.noPriorData')}</div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr', gap: 16, marginBottom: 16 }} className="reports-two-col">
        <div className="panel">
          <div className="panel-title" style={{ marginBottom: 12 }}>{t('reports.expenseBreakdown')}</div>
          {expenseData && expenseData.breakdown.length > 0 ? (
            <div style={{ height: 260, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 18 }}>
              <DonutChart
                data={expenseData.breakdown.map((b, i) => ({
                  label: b.description === 'Other' ? t('common.other') : b.description, value: b.total, color: EXPENSE_COLORS[i % EXPENSE_COLORS.length],
                }))}
                size={170}
                strokeWidth={22}
                centerContent={
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--cream)' }}>
                      {expenseData.breakdown.reduce((s, b) => s + Number(b.total || 0), 0).toFixed(0)}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--cream-faint)' }}>{t('common.total')}</div>
                  </div>
                }
              />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 240, overflowY: 'auto' }}>
                {expenseData.breakdown.map((b, i) => (
                  <div key={b.description} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: EXPENSE_COLORS[i % EXPENSE_COLORS.length], flexShrink: 0 }} />
                    <span style={{ color: 'var(--cream-dim)' }}>{b.description === 'Other' ? t('common.other') : b.description}</span>
                    <span style={{ color: 'var(--cream-faint)' }}>{Number(b.total).toFixed(0)}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ textAlign: 'center', color: 'var(--cream-faint)', padding: '30px 0' }}>{t('reports.noExpenseData')}</div>
          )}
        </div>

        <div className="panel">
          <div className="panel-title" style={{ marginBottom: 12 }}>{t('reports.topCustomers')}</div>
          {topCustomers && topCustomers.top_customers.length > 0 ? (
            <div className="table-wrap">
              <table>
                <thead><tr><th>#</th><th>{t('entry.customer')}</th><th>{t('common.total')}</th><th>{t('common.invoice')}</th></tr></thead>
                <tbody>
                  {topCustomers.top_customers.map((c, idx) => (
                    <tr key={c.contact_id}>
                      <td>{idx + 1}</td>
                      <td>{c.name}</td>
                      <td style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><IconSaudiRiyal size={13} /> {Number(c.total).toLocaleString()}</td>
                      <td>{c.invoice_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div style={{ textAlign: 'center', color: 'var(--cream-faint)', padding: '30px 0' }}>{t('reports.noCustomerData')}</div>
          )}
        </div>
      </div>

      <div className="panel">
        <div className="panel-title" style={{ marginBottom: 12 }}>{t('reports.daily')}</div>
        <div className="form-field" style={{ maxWidth: 220, marginBottom: 16 }}>
          <label>{t('common.date')}</label>
          <DateField value={dailyDate} onChange={e => { setDailyDate(e.target.value); loadDaily(e.target.value); }} />
        </div>
        {daily && (
          <>
            <div className="cards-grid">
              <div className="card"><div className="card-label">{t('reports.revenue')}</div><div className="card-value">{Number(daily.summary?.total_revenue || 0).toLocaleString()}</div></div>
              <div className="card"><div className="card-label">{t('reports.purchases')}</div><div className="card-value">{Number(daily.summary?.total_purchases || 0).toLocaleString()}</div></div>
              <div className="card"><div className="card-label">{t('reports.expenses')}</div><div className="card-value">{Number(daily.summary?.total_expenses || 0).toLocaleString()}</div></div>
              <div className="card"><div className="card-label">{t('reports.netCash')}</div><div className="card-value">{Number(daily.summary?.net_cash || 0).toLocaleString()}</div></div>
            </div>
            <div className="table-wrap" style={{ marginTop: 20 }}>
              <table>
                <thead><tr><th>{t('common.invoice')}</th><th>{t('entry.customer')}</th><th>{t('hist.salesman')}</th><th>{t('common.total')}</th><th>{t('common.cash')}</th><th>{t('common.card')}</th></tr></thead>
                <tbody>
                  {daily.sales.map(s => (
                    <tr key={s.invoice_no}>
                      <td>{s.invoice_no}</td><td>{s.contact || '—'}</td><td>{s.salesman || '—'}</td>
                      <td>{Number(s.total).toLocaleString()}</td><td>{s.cash}</td><td>{s.card}</td>
                    </tr>
                  ))}
                  {daily.sales.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--cream-faint)' }}>{t('reports.noSalesThatDay')}</td></tr>}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
