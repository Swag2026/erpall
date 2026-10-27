import { useEffect, useMemo, useState } from 'react';
import { apiGet } from '../lib/api';
import { useLanguage } from '../context/LanguageContext.jsx';
import { SkeletonTable } from '../components/Skeleton.jsx';

// Last loaded log for this login: coming back shows it at once and refreshes quietly.
let LOG_CACHE = null; // { token, logs }
const logCacheFor = () => {
  const tok = localStorage.getItem('sg_token');
  return LOG_CACHE && tok && LOG_CACHE.token === tok ? LOG_CACHE.logs : null;
};

export default function ActivityLog() {
  const { t, tf, tx, lang } = useLanguage();
  const CAT_KEYS = { sale: 'entry.sale', purchase_jewelry: 'entry.purchaseJewelry', purchase_scrap: 'entry.purchaseScrap', supplier_payment: 'entry.supplierPayment', expense: 'entry.expense', cash_adjustment: 'entry.addCash', cash_deposit: 'entry.cashDepositEntry', day_close: 'act.cat.day_close', day_open: 'act.cat.day_open', shop_loan: 'act.cat.shop_loan' };
  const typeLabel = (ty) => tx(`act.type.${ty}`, ty);
  const catLabel = (c) => (c ? tx(CAT_KEYS[c], c) : '—');
  // The backend writes a few fixed English notes; show those in the user's language. Notes typed by staff are left untouched.
  const noteLabel = (n) => {
    if (!n || lang !== 'ar') return n || '';
    if (n === 'Restored via Undo') return t('act.note.restored');
    let m = n.match(/^Permanently deleted by (.+)$/);
    if (m) return tf('act.note.deleted', { name: m[1] });
    m = n.match(/^Day closed\. System: (.*?), Counted: (.*?), Variance: (.*?)(?: \| (.*))?$/);
    if (m) return tf('act.note.dayClose', { sys: m[1], cnt: m[2], var: m[3] }) + (m[4] ? ` | ${m[4]}` : '');
    return n;
  };
  const [logs, setLogs] = useState(() => logCacheFor() || []);
  const [loading, setLoading] = useState(() => !logCacheFor());
  const [error, setError] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [userFilter, setUserFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 25;

  useEffect(() => {
    // Capped at 150 (most recent) instead of the backend's default 500 —
    // rendering hundreds of rows with no pagination was making this page
    // noticeably slower to open as the log naturally grew after the bulk
    // import, on top of the network payload size itself.
    apiGet('/activity-logs?limit=150')
      .then((list) => { setLogs(list); LOG_CACHE = { token: localStorage.getItem('sg_token'), logs: list }; })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const users = useMemo(() => [...new Set(logs.map(l => l.user_name))].filter(Boolean), [logs]);
  const types = useMemo(() => [...new Set(logs.map(l => l.action_type))].filter(Boolean), [logs]);

  useEffect(() => { setPage(1); }, [typeFilter, userFilter, search]);

  const filtered = logs.filter(l => {
    if (typeFilter !== 'all' && l.action_type !== typeFilter) return false;
    if (userFilter !== 'all' && l.user_name !== userFilter) return false;
    if (search && !String(l.invoice_no || '').toLowerCase().includes(search.toLowerCase())
      && !String(l.note || '').toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const stats = useMemo(() => {
    const byType = {};
    filtered.forEach(l => { byType[l.action_type] = (byType[l.action_type] || 0) + 1; });
    return byType;
  }, [filtered]);

  if (loading) return <SkeletonTable rows={7} cols={4} />;
  if (error) return <div className="login-err" style={{ display: 'block' }}>⚠ {error}</div>;

  return (
    <section className="view active">
      <div className="topbar">
        <div>
          <div className="page-title">{t('activity.title')}</div>
          <div className="page-subtitle">{t('activity.subtitle')}</div>
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="filters-row">
          <div className="form-field">
            <label>{t('act.actionType')}</label>
            <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
              <option value="all">{t('act.allTypes')}</option>
              {types.map(ty => <option key={ty} value={ty}>{typeLabel(ty)}</option>)}
            </select>
          </div>
          <div className="form-field">
            <label>{t('act.user')}</label>
            <select value={userFilter} onChange={e => setUserFilter(e.target.value)}>
              <option value="all">{t('act.allUsers')}</option>
              {users.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
          <div className="form-field" style={{ flex: 1, minWidth: 160 }}>
            <label>{t('common.search')}</label>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder={t('act.searchPlaceholder')} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 12 }}>
          {Object.entries(stats).map(([ty, count]) => (
            <span key={ty} style={{ fontSize: 12.5, color: 'var(--cream-dim)' }}>
              <strong style={{ color: 'var(--gold-21)' }}>{count}</strong> {typeLabel(ty)}
            </span>
          ))}
          <span style={{ fontSize: 12.5, color: 'var(--cream-faint)' }}>· {tf('act.entriesCount', { shown: filtered.length, total: logs.length })}</span>
        </div>
      </div>

      <div className="panel">
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>{t('activity.when')}</th><th>{t('activity.user')}</th><th>{t('activity.action')}</th><th>{t('common.invoice')}</th><th>{t('common.category')}</th><th>{t('common.total')}</th><th>{t('activity.note')}</th></tr>
            </thead>
            <tbody>
              {pageItems.map(l => (
                <tr key={l.id}>
                  <td><span style={{ direction: 'ltr', unicodeBidi: 'isolate', display: 'inline-block' }}>{new Date(l.created_at).toLocaleString()}</span></td>
                  <td style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{
                      width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
                      background: l.user_avatar ? `url(${l.user_avatar}) center/cover` : 'var(--surface-3)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: 'var(--gold-24)',
                    }}>
                      {!l.user_avatar && (l.user_name || '?')[0]?.toUpperCase()}
                    </span>
                    {l.user_name} <span style={{ color: 'var(--cream-faint)' }}>({tx(`role.${l.user_role}`, l.user_role)})</span>
                  </td>
                  <td>{typeLabel(l.action_type)}</td>
                  <td>{l.invoice_no || '—'}</td>
                  <td>{catLabel(l.category)}</td>
                  <td>{Number(l.amount || 0).toLocaleString()}</td>
                  <td>{noteLabel(l.note)}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--cream-faint)' }}>{t('activity.none')}</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {totalPages > 1 && (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, marginTop: 16 }}>
            <button className="btn sm" disabled={safePage <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>
              {t('pg.prev')}
            </button>
            <span style={{ fontSize: 13, color: 'var(--cream-dim)', fontFamily: "'IBM Plex Mono', monospace" }}>
              {safePage} / {totalPages}
            </span>
            <button className="btn sm" disabled={safePage >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>
              {t('pg.next')}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
