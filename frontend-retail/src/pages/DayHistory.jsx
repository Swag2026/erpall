import { useEffect, useState } from 'react';
import { apiGet } from '../lib/api';
import { useLanguage } from '../context/LanguageContext.jsx';
import { SkeletonTable } from '../components/Skeleton.jsx';
import { IconSaudiRiyal } from '../components/Icons.jsx';

export default function DayHistory() {
  const { t, tf, lang } = useLanguage();
  const [openings, setOpenings] = useState([]);
  const [reconciliations, setReconciliations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    Promise.all([apiGet('/day-openings'), apiGet('/reconciliations')])
      .then(([o, r]) => { setOpenings(o || []); setReconciliations(r || []); })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  // Merge both lists by date so each row shows the full opening->closing
  // story for that day, instead of two separate disconnected tables.
  const reconByDate = {};
  reconciliations.forEach(r => { reconByDate[r.reconciliation_date] = r; });
  const openByDate = {};
  openings.forEach(o => { openByDate[o.opening_date] = o; });
  const allDates = [...new Set([...openings.map(o => o.opening_date), ...reconciliations.map(r => r.reconciliation_date)])]
    .sort((a, b) => b.localeCompare(a)); // newest first

  return (
    <section className="view active">
      <div className="page-title">{t('dayhist.title')}</div>
      <p style={{ color: 'var(--cream-dim)', fontSize: 13.5, marginBottom: 16 }}>{t('dayhist.sub')}</p>

      {error && <div className="login-err" style={{ display: 'block', marginBottom: 16 }}>⚠ {error}</div>}

      {loading && <SkeletonTable rows={8} cols={6} />}

      {!loading && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t('dayhist.date')}</th>
                <th>{t('dayhist.openedBy')}</th>
                <th>{t('dayhist.openingCash')}</th>
                <th>{t('dayhist.closedBy')}</th>
                <th>{t('dayhist.countedCash')}</th>
                <th>{t('dayhist.variance')}</th>
              </tr>
            </thead>
            <tbody>
              {allDates.length === 0 && (
                <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--cream-faint)', padding: 20 }}>{t('dayhist.noRecords')}</td></tr>
              )}
              {allDates.map(date => {
                const opening = openByDate[date];
                const recon = reconByDate[date];
                const varianceColor = recon
                  ? (recon.variance === 0 ? 'var(--cream-dim)' : recon.variance > 0 ? 'var(--accent-green)' : 'var(--accent-red)')
                  : 'var(--cream-faint)';
                return (
                  <tr key={date}>
                    <td style={{ fontWeight: 600 }}>{date}</td>
                    <td>{opening?.updated_by_name || <span style={{ color: 'var(--cream-faint)' }}>—</span>}</td>
                    <td>
                      {opening ? (<><IconSaudiRiyal /> {Number(opening.opening_cash || 0).toLocaleString()}</>) : <span style={{ color: 'var(--cream-faint)' }}>—</span>}
                    </td>
                    <td>{recon?.reconciled_by_name || <span style={{ color: 'var(--cream-faint)' }}>{t('dayhist.notClosedYet')}</span>}</td>
                    <td>
                      {recon ? (<><IconSaudiRiyal /> {Number(recon.counted_cash || 0).toLocaleString()}</>) : <span style={{ color: 'var(--cream-faint)' }}>—</span>}
                    </td>
                    <td style={{ color: varianceColor, fontWeight: recon && recon.variance !== 0 ? 700 : 400 }}>
                      {recon ? `${recon.variance > 0 ? '+' : ''}${Number(recon.variance).toLocaleString()}` : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
