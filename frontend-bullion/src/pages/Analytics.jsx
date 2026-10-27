import { useEffect, useMemo, useRef, useState } from 'react';
import Chart from 'chart.js/auto';
import { apiGet } from '../lib/api';
import { useLanguage } from '../context/LanguageContext.jsx';
import { SkeletonPanel } from '../components/Skeleton.jsx';
import { DonutChart } from '../components/ui/donut-chart.tsx';

const CATEGORY_KEYS = {
  sale: 'entry.sale',
  purchase_jewelry: 'entry.purchaseJewelry',
  purchase_scrap: 'entry.purchaseScrap',
  supplier_payment: 'entry.supplierPayment',
  expense: 'entry.expense',
};

export default function Analytics() {
  const { t, lang } = useLanguage();
  const categoryCanvasRef = useRef(null);
  const categoryChartRef = useRef(null);
  const trendCanvasRef = useRef(null);
  const trendChartRef = useRef(null);
  const stackedCanvasRef = useRef(null);
  const stackedChartRef = useRef(null);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Weight sold by purity (all-time) — pulled out of the Chart.js effect
  // below so the new DonutChart (a plain React component, not an
  // imperative Chart.js instance) can render it directly in JSX.
  const purityData = useMemo(() => {
    const active = entries.filter(e => e.status !== 'canceled');
    const sales = active.filter(e => e.category === 'sale');
    const weights = {
      '21K': sales.reduce((s, e) => s + Number(e.weight_21k || 0), 0),
      '18K': sales.reduce((s, e) => s + Number(e.weight_18k || 0), 0),
      '24K': sales.reduce((s, e) => s + Number(e.weight_24k || 0), 0),
      'Silver': sales.reduce((s, e) => s + Number(e.weight_silver || 0), 0),
    };
    const colors = { '21K': '#D4AA30', '18K': '#AF8C28', '24K': '#F2CA4C', 'Silver': '#BCC6CE' };
    const segs = Object.entries(weights).map(([label, value]) => ({ label, value, color: colors[label] })).filter(s => s.value > 0);
    const total = segs.reduce((s, seg) => s + seg.value, 0);
    return { segs, total };
  }, [entries]);

  useEffect(() => {
    apiGet('/invoices?limit=2000')
      .then(data => setEntries(Array.isArray(data) ? data : data.items || []))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (loading) return;
    const active = entries.filter(e => e.status !== 'canceled');

    // Chart 1 — totals by category
    const byCategory = {};
    Object.keys(CATEGORY_KEYS).forEach(k => { byCategory[k] = 0; });
    active.forEach(e => { byCategory[e.category] = (byCategory[e.category] || 0) + Number(e.total_amount || 0); });

    if (categoryChartRef.current) categoryChartRef.current.destroy();
    if (categoryCanvasRef.current) {
      // Same color language as the category tags elsewhere in the app
      // (History table, launcher tiles) — sales green, purchases red/gold,
      // supplier payments silver — so the chart reads at a glance instead
      // of every bar looking identical regardless of transaction type.
      const catColors = {
        sale: '#7FBF9B', purchase_jewelry: '#D68E7A', purchase_scrap: '#F2CA4C',
        supplier_payment: '#BCC6CE', expense: '#D68E7A',
      };
      const barColors = Object.keys(byCategory).map(k => catColors[k] || '#D4AA30');
      categoryChartRef.current = new Chart(categoryCanvasRef.current, {
        type: 'bar',
        data: {
          labels: Object.keys(byCategory).map(k => t(CATEGORY_KEYS[k])),
          datasets: [{
            label: 'Total (SAR)',
            data: Object.values(byCategory),
            backgroundColor: barColors.map(c => c + '8C'),
            borderColor: barColors,
            borderWidth: 1.5,
            borderRadius: 6,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { ticks: { color: '#8A95B0' }, grid: { color: 'rgba(255,255,255,.05)' } },
            y: { ticks: { color: '#8A95B0' }, grid: { color: 'rgba(255,255,255,.05)' } },
          },
        },
      });
    }

    // Chart 3 — sales trend over time (by day)
    const sales = active.filter(e => e.category === 'sale');
    const byDay = {};
    sales.forEach(e => { byDay[e.invoice_date] = (byDay[e.invoice_date] || 0) + Number(e.total_amount || 0); });
    const sortedDays = Object.keys(byDay).sort();
    if (trendChartRef.current) trendChartRef.current.destroy();
    if (trendCanvasRef.current && sortedDays.length > 0) {
      trendChartRef.current = new Chart(trendCanvasRef.current, {
        type: 'line',
        data: {
          labels: sortedDays,
          datasets: [{
            label: 'Sales (SAR)',
            data: sortedDays.map(d => byDay[d]),
            borderColor: 'rgba(242,202,76,1)',
            backgroundColor: 'rgba(242,202,76,.18)',
            pointBackgroundColor: 'rgba(242,202,76,1)',
            pointBorderColor: '#0B0E17',
            pointBorderWidth: 2,
            pointRadius: 4,
            pointHoverRadius: 6,
            borderWidth: 2.5,
            fill: true,
            tension: 0.35,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { ticks: { color: '#8A95B0' }, grid: { display: false } },
            y: { ticks: { color: '#8A95B0' }, grid: { color: 'rgba(255,255,255,.05)' } },
          },
        },
      });
    }

    // Chart 4 — stacked karat weight by day
    const byDayKarat = {};
    sales.forEach(e => {
      const d = e.invoice_date;
      byDayKarat[d] = byDayKarat[d] || { '21K': 0, '18K': 0, '24K': 0, Silver: 0 };
      byDayKarat[d]['21K'] += Number(e.weight_21k || 0);
      byDayKarat[d]['18K'] += Number(e.weight_18k || 0);
      byDayKarat[d]['24K'] += Number(e.weight_24k || 0);
      byDayKarat[d].Silver += Number(e.weight_silver || 0);
    });
    const stackedDays = Object.keys(byDayKarat).sort();
    if (stackedChartRef.current) stackedChartRef.current.destroy();
    if (stackedCanvasRef.current && stackedDays.length > 0) {
      const colors = { '21K': '#D4AA30', '18K': '#AF8C28', '24K': '#F2CA4C', Silver: '#BCC6CE' };
      stackedChartRef.current = new Chart(stackedCanvasRef.current, {
        type: 'bar',
        data: {
          labels: stackedDays,
          datasets: Object.keys(colors).map(k => ({
            label: k,
            data: stackedDays.map(d => byDayKarat[d][k]),
            backgroundColor: colors[k],
            borderRadius: 4,
            maxBarThickness: 46,
          })),
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { position: 'bottom', labels: { color: '#8A95B0' } } },
          scales: {
            x: { stacked: true, ticks: { color: '#8A95B0' }, grid: { display: false } },
            y: { stacked: true, ticks: { color: '#8A95B0' }, grid: { color: 'rgba(255,255,255,.05)' } },
          },
        },
      });
    }

    return () => {
      if (categoryChartRef.current) categoryChartRef.current.destroy();
      if (trendChartRef.current) trendChartRef.current.destroy();
      if (stackedChartRef.current) stackedChartRef.current.destroy();
    };
  }, [entries, loading, lang]);

  if (loading) return <><SkeletonPanel /><div style={{ height: 16 }} /><SkeletonPanel /></>;
  if (error) return <div className="login-err" style={{ display: 'block' }}>⚠ {error}</div>;

  return (
    <section className="view active">
      <div className="topbar">
        <div>
          <div className="page-title">{t('analytics.title')}</div>
          <div className="page-subtitle">{t('analytics.subtitle')}</div>
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-title" style={{ marginBottom: 12 }}>{t('analytics.totalsByCategory')}</div>
        <div style={{ height: 260 }}><canvas ref={categoryCanvasRef} /></div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 16 }}>
        <div className="panel">
          <div className="panel-title" style={{ marginBottom: 12 }}>{t('analytics.weightByPurity')}</div>
          <div style={{ height: 260, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 20 }}>
            {purityData.total > 0 ? (
              <>
                <DonutChart
                  data={purityData.segs}
                  size={170}
                  strokeWidth={24}
                  centerContent={
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--cream)' }}>{purityData.total.toFixed(1)}g</div>
                      <div style={{ fontSize: 10.5, color: 'var(--cream-faint)' }}>{t('common.total').toLowerCase()}</div>
                    </div>
                  }
                />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {purityData.segs.map(s => (
                    <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5 }}>
                      <span style={{ width: 9, height: 9, borderRadius: '50%', background: s.color, flexShrink: 0 }} />
                      <span style={{ color: 'var(--cream-dim)' }}>{s.label}</span>
                      <span style={{ color: 'var(--cream-faint)' }}>{s.value.toFixed(1)}g</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div style={{ color: 'var(--cream-faint)', fontSize: 13 }}>—</div>
            )}
          </div>
        </div>
        <div className="panel">
          <div className="panel-title" style={{ marginBottom: 12 }}>{t('analytics.salesTrend')}</div>
          <div style={{ height: 260 }}><canvas ref={trendCanvasRef} /></div>
        </div>
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
        <div className="panel-title" style={{ marginBottom: 12 }}>{t('analytics.karatByDay')}</div>
        <div style={{ height: 260 }}><canvas ref={stackedCanvasRef} /></div>
      </div>
    </section>
  );
}
