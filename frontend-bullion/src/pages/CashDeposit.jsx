import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiGet } from '../lib/api';
import { useLanguage } from '../context/LanguageContext.jsx';
import { SkeletonPanel } from '../components/Skeleton.jsx';
import { IconSaudiRiyal } from '../components/Icons.jsx';

export default function CashDeposit() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    setError('');
    try {
      setData(await apiGet('/cash-deposit/summary'));
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => { load().finally(() => setLoading(false)); }, []);

  if (loading) return <SkeletonPanel />;

  return (
    <section className="view active">
      <div className="topbar">
        <div>
          <div className="page-title">{t('cashDeposit.title')}</div>
          <div className="page-subtitle">{t('cashDeposit.subtitle')}</div>
        </div>
        <div className="topbar-actions">
          <button className="btn gold" onClick={() => navigate('/entry')}>+ {t('cashDeposit.addDeposit')}</button>
        </div>
      </div>

      {error && <div className="login-err" style={{ display: 'block', marginBottom: 16 }}>⚠ {error}</div>}

      {data && (
        <div className="cards-grid" style={{ marginBottom: 16 }}>
          <div className="card">
            <div className="card-label">{t('cashDeposit.currentBalance')}</div>
            <div className="card-value" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <IconSaudiRiyal /> {Number(data.balance).toLocaleString()}
            </div>
          </div>
          <div className="card">
            <div className="card-label">{t('cashDeposit.totalDeposited')}</div>
            <div className="card-value" style={{ color: 'var(--accent-green)' }}>{Number(data.total_deposited).toLocaleString()}</div>
          </div>
          <div className="card">
            <div className="card-label">{t('cashDeposit.totalSpent')}</div>
            <div className="card-value" style={{ color: 'var(--accent-red)' }}>{Number(data.total_spent).toLocaleString()}</div>
          </div>
        </div>
      )}

      <div className="panel">
        <div className="panel-title" style={{ marginBottom: 12 }}>{t('cashDeposit.history')}</div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t('common.date')}</th>
                <th>{t('common.invoice')}</th>
                <th>{t('cashDeposit.type')}</th>
                <th>{t('common.description')}</th>
                <th>{t('common.amount')}</th>
                <th>{t('cashDeposit.balanceAfter')}</th>
                <th>{t('common.by')}</th>
              </tr>
            </thead>
            <tbody>
              {data && data.history.length === 0 && (
                <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--cream-faint)', padding: 20 }}>{t('cashDeposit.noHistory')}</td></tr>
              )}
              {data && data.history.map((row, idx) => (
                <tr key={idx}>
                  <td>{row.date}</td>
                  <td>{row.invoice_no}</td>
                  <td>
                    <span style={{
                      color: row.type === 'deposit' ? 'var(--accent-green)' : 'var(--accent-red)',
                      fontWeight: 600,
                    }}>
                      {row.type === 'deposit' ? `▲ ${t('cashDeposit.deposit')}` : `▼ ${t('entry.expense')}`}
                    </span>
                  </td>
                  <td>{row.description || '—'}</td>
                  <td>{row.type === 'deposit' ? '+' : '−'}{Number(row.amount).toLocaleString()}</td>
                  <td style={{ fontWeight: 600 }}>{Number(row.balance_after).toLocaleString()}</td>
                  <td>{row.created_by || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
