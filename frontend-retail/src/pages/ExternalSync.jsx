import { useState } from 'react';
import { apiPost } from '../lib/api';
import { useLanguage } from '../context/LanguageContext.jsx';
import { SkeletonTable } from '../components/Skeleton.jsx';
import { IconSaudiRiyal } from '../components/Icons.jsx';

export default function ExternalSync() {
  const { t, tf, lang } = useLanguage();
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [lastSynced, setLastSynced] = useState(null);
  const [search, setSearch] = useState('');

  async function runSync() {
    setLoading(true);
    setError('');
    try {
      const res = await apiPost('/external-sync/customer-balances', {});
      const list = res?.data || [];
      setRows(Array.isArray(list) ? list : []);
      setLastSynced(new Date());
    } catch (err) {
      setError(err.message || t('extsync.failed'));
    } finally {
      setLoading(false);
    }
  }

  const filtered = (rows || []).filter(r => {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return (r.customer_name || '').toLowerCase().includes(q)
      || (r.customer_name_ar || '').includes(search.trim())
      || (r.customer_code || '').toLowerCase().includes(q);
  });

  const totalCash = filtered.reduce((s, r) => s + (Number(r.cash_balance) || 0), 0);
  const totalGold = filtered.reduce((s, r) => s + (Number(r.gold_balance) || 0), 0);
  const totalSilver = filtered.reduce((s, r) => s + (Number(r.silver_balance) || 0), 0);

  return (
    <section className="view active" id="view-external-sync">
      <div className="page-title">{t('extsync.title')}</div>
      <p style={{ color: 'var(--cream-dim)', fontSize: 13.5, marginBottom: 16 }}>{t('extsync.sub')}</p>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        <button className="btn gold" onClick={runSync} disabled={loading}>
          {loading ? t('extsync.syncing') : t('extsync.syncNow')}
        </button>
        {lastSynced && (
          <span style={{ fontSize: 12.5, color: 'var(--cream-faint)' }}>
            {tf('extsync.lastSynced', { time: lastSynced.toLocaleTimeString(lang === 'ar' ? 'ar-SA' : 'en-US') })}
          </span>
        )}
      </div>

      {error && (
        <div className="login-err" style={{ display: 'block', marginBottom: 16 }}>⚠ {error}</div>
      )}

      {loading && <SkeletonTable rows={6} cols={5} />}

      {!loading && rows === null && !error && (
        <div className="card" style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--cream-dim)' }}>
          {t('extsync.emptyPrompt')}
        </div>
      )}

      {!loading && rows !== null && (
        <>
          <div className="form-field" style={{ maxWidth: 320, marginBottom: 14 }}>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t('extsync.searchPlaceholder')}
            />
          </div>

          <div className="hist-summary" style={{ marginBottom: 12 }}>
            {tf('extsync.summaryLine', {
              n: filtered.length,
              cash: totalCash.toLocaleString(undefined, { maximumFractionDigits: 2 }),
              gold: totalGold.toLocaleString(undefined, { maximumFractionDigits: 2 }),
              silver: totalSilver.toLocaleString(undefined, { maximumFractionDigits: 2 }),
            })}
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('extsync.customerCode')}</th>
                  <th>{t('extsync.customerName')}</th>
                  <th>{t('extsync.cashBalance')}</th>
                  <th>{t('extsync.goldBalance')}</th>
                  <th>{t('extsync.silverBalance')}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--cream-faint)', padding: 20 }}>{t('extsync.noResults')}</td></tr>
                )}
                {filtered.map(r => (
                  <tr key={r.id}>
                    <td>{r.customer_code}</td>
                    <td>{lang === 'ar' ? (r.customer_name_ar || r.customer_name) : r.customer_name}</td>
                    <td style={{ color: (r.cash_balance || 0) >= 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                      <IconSaudiRiyal /> {Number(r.cash_balance || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </td>
                    <td>{Number(r.gold_balance || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} g</td>
                    <td>{Number(r.silver_balance || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} g</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
