import { useEffect, useMemo, useState } from 'react';
import { apiGet } from '../lib/api';
import { toLocalDateStr, todayLocalStr } from '../lib/dateUtils';
import { computeLedger, summarizeLedger } from '../lib/ledger.js';
import { exportLedgerPDF, exportLedgerExcel } from '../lib/ledgerExport.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useLanguage } from '../context/LanguageContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { DownloadButton } from './ui/download-animation.tsx';
import DateField from './DateField.jsx';
import { IconSaudiRiyal } from './Icons.jsx';

const fmt = (n) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return toLocalDateStr(d);
}

// Daily Ledger: opening balance → sales / purchases / supplier payments / expenses → closing balance, per day,
// for any date range, exportable as a professional PDF or Excel workbook.
export default function DailyLedgerReport() {
  const { t, tf } = useLanguage();
  const { user } = useAuth();
  const { showToast } = useToast();
  const [raw, setRaw] = useState(null);
  const [error, setError] = useState('');
  const [from, setFrom] = useState(daysAgo(29));
  const [to, setTo] = useState(todayLocalStr());

  useEffect(() => {
    let alive = true;
    // Shop loans are optional: if that endpoint is unreachable the ledger still loads (just without loan lines).
    Promise.all([apiGet('/invoices/daily-summary'), apiGet('/day-openings'), apiGet('/reconciliations'), apiGet('/shop-loans/daily-summary').catch(() => ({}))])
      .then(([summary, openings, recons, loans]) => { if (alive) setRaw({ summary, openings, recons, loans }); })
      .catch((e) => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, []);

  // The whole history is walked once so carried-forward openings are right, then sliced to the range.
  const all = useMemo(() => (raw ? computeLedger(raw.summary, raw.openings, raw.recons, raw.loans) : []), [raw]);
  const rows = useMemo(() => all.filter((r) => (!from || r.date >= from) && (!to || r.date <= to)), [all, from, to]);
  const sum = useMemo(() => summarizeLedger(rows), [rows]);

  const hasLoans = sum.loan.count > 0;

  const meta = () => ({ from: rows[0]?.date || from, to: rows[rows.length - 1]?.date || to, user: user?.full_name || user?.username || '' });

  async function doExcel() {
    if (!rows.length) { showToast(t('ledger.noData'), 'error'); return; }
    try { await exportLedgerExcel(rows, sum, meta()); } catch (e) { showToast(e.message || 'Export failed', 'error'); }
  }
  async function doPDF() {
    if (!rows.length) { showToast(t('ledger.noData'), 'error'); return; }
    try { exportLedgerPDF(rows, sum, meta()); } catch (e) { showToast(e.message || 'Export failed', 'error'); }
  }

  const chips = [
    { key: '7', label: t('ledger.last7'), f: daysAgo(6), to: todayLocalStr() },
    { key: '30', label: t('ledger.last30'), f: daysAgo(29), to: todayLocalStr() },
    { key: 'm', label: t('reports.thisMonth'), f: todayLocalStr().slice(0, 8) + '01', to: todayLocalStr() },
    { key: 'all', label: t('ledger.all'), f: '', to: '' },
  ];

  const neg = (n) => (n < -0.005 ? { color: 'var(--accent-red)' } : null);
  // numbers stay left-to-right even in Arabic, otherwise the minus sign lands on the wrong side ("17.50g-")
  const L = { direction: 'ltr', unicodeBidi: 'isolate', display: 'inline-block' };

  return (
    <div className="panel" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 4 }}>
        <div>
          <div className="panel-title">{t('ledger.title')}</div>
          <div style={{ fontSize: 13, color: 'var(--cream-dim)', marginTop: 2 }}>{t('ledger.sub')}</div>
        </div>
        <div className="tw-preflight" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <DownloadButton label={t('ledger.pdf')} color="#1D5C8C" size={36} width={132} onDownload={doPDF} />
          <DownloadButton label={t('ledger.excel')} color="#C49A1E" size={36} width={146} onDownload={doExcel} />
        </div>
      </div>

      {error && <div className="login-err" style={{ display: 'block', marginTop: 10 }}>⚠ {error}</div>}

      <div className="filters-row" style={{ marginTop: 12 }}>
        <div className="form-field"><label>{t('hist.fromDate')}</label><DateField value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div className="form-field"><label>{t('hist.toDate')}</label><DateField value={to} onChange={(e) => setTo(e.target.value)} /></div>
        <div className="form-field" style={{ alignSelf: 'flex-end', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {chips.map((c) => (
            <button
              key={c.key} type="button"
              className={`btn ${from === c.f && to === c.to ? 'gold' : 'ghost'} sm`}
              onClick={() => { setFrom(c.f); setTo(c.to); }}
            >{c.label}</button>
          ))}
        </div>
      </div>

      {!raw && !error && <div style={{ padding: '18px 0', color: 'var(--cream-faint)' }}>{t('common.loading')}</div>}

      {raw && (
        <>
          <div className="cards-grid" style={{ marginTop: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
            <div className="card"><div className="card-label">{t('ledger.openCash')}</div><div className="card-value" style={{ fontSize: 22 }}><span style={{ ...L }}>{fmt(sum.openCash)}</span></div></div>
            <div className="card"><div className="card-label">{t('reports.revenue')}</div><div className="card-value" style={{ fontSize: 22 }}><span style={{ ...L }}>{fmt(sum.sales.total)}</span></div></div>
            <div className="card"><div className="card-label">{t('reports.purchases')}</div><div className="card-value" style={{ fontSize: 22 }}><span style={{ ...L }}>{fmt(sum.purchases.total)}</span></div></div>
            <div className="card"><div className="card-label">{t('ledger.closeCash')}</div><div className="card-value" style={{ fontSize: 22 }}><span style={{ ...L, ...neg(sum.closeCash) }}>{fmt(sum.closeCash)}</span></div></div>
            <div className="card"><div className="card-label">{t('ledger.closeGold')}</div><div className="card-value" style={{ fontSize: 22 }}><span style={{ ...L, ...neg(sum.closeGold) }}>{fmt(sum.closeGold)}g</span></div></div>
            <div className="card"><div className="card-label">{t('ledger.closeSilver')}</div><div className="card-value" style={{ fontSize: 22 }}><span style={{ ...L, ...neg(sum.closeSilver) }}>{fmt(sum.closeSilver)}g</span></div></div>
          </div>

          <div style={{ fontSize: 12.5, color: 'var(--cream-faint)', margin: '12px 0 6px' }}>
            {rows.length ? tf('ledger.rangeInfo', { n: rows.length, c: sum.closedDays }) : t('ledger.noData')}
            {hasLoans && <div style={{ marginTop: 4 }}>{t('ledger.loansNote')}</div>}
          </div>

          {rows.length > 0 && (
            <div className="table-wrap ledger-table" style={{ maxHeight: 440, overflowY: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th>{t('common.date')}</th>
                    <th>{t('ledger.opening')}</th>
                    <th>{t('reports.revenue')}</th>
                    <th>{t('reports.purchases')}</th>
                    <th>{t('ledger.supplierExp')}</th>
                    {hasLoans && <th>{t('ledger.lentOut')}</th>}
                    {hasLoans && <th>{t('ledger.returnedIn')}</th>}
                    <th>{t('ledger.closing')}</th>
                    <th>{t('ledger.goldClose')}</th>
                    <th>{t('ledger.silverClose')}</th>
                    <th>{t('common.status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {[...rows].reverse().map((r) => (
                    <tr key={r.date}>
                      <td>{r.date}</td>
                      <td><span style={L}>{fmt(r.openCash)}</span></td>
                      <td><span style={L}>{fmt(r.sales.total)}</span></td>
                      <td><span style={L}>{fmt(r.purchases.total)}</span></td>
                      <td><span style={L}>{fmt(r.supplier.cash + r.expenses.cash)}</span></td>
                      {hasLoans && <td><span style={L}>{r.loan.count ? `${fmt(r.loan.lentGold)}g` : '—'}</span></td>}
                      {hasLoans && <td><span style={L}>{r.loan.count ? `${fmt(r.loan.returnedGold + r.loan.settledGold)}g${r.loan.settledCash > 0 ? ` (${fmt(r.loan.settledCash)})` : ''}` : '—'}</span></td>}
                      <td style={{ fontWeight: 700, ...neg(r.closeCash) }}><span style={L}>{fmt(r.closeCash)}</span></td>
                      <td style={neg(r.closeGold)}><span style={L}>{fmt(r.closeGold)}g</span></td>
                      <td style={neg(r.closeSilver)}><span style={L}>{fmt(r.closeSilver)}g</span></td>
                      <td>
                        <span className={`tag ${r.closed ? 'status-paid' : ''}`} style={r.closed ? null : { background: 'var(--surface-2)', color: 'var(--cream-faint)' }}>
                          {r.closed ? t('ledger.closed') : t('ledger.open')}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
