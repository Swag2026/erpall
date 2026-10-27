import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiGet, apiPut } from '../lib/api';
import { API_BASE } from '../lib/api';
import { useAuth } from '../context/AuthContext.jsx';
import { useLanguage } from '../context/LanguageContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { SkeletonPanel } from '../components/Skeleton.jsx';

export default function Settings() {
  const { showToast } = useToast();
  const { user } = useAuth();
  const { t, tf } = useLanguage();
  const [rates, setRates] = useState([]);
  const [loginAttempts, setLoginAttempts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(null);
  const [backupError, setBackupError] = useState('');
  const [permData, setPermData] = useState(null);
  const [permMatrix, setPermMatrix] = useState({});
  const [permLoading, setPermLoading] = useState(true);
  const [permSaving, setPermSaving] = useState(false);

  async function loadPermissions() {
    setPermLoading(true);
    try {
      const data = await apiGet('/settings/permissions');
      setPermData(data);
      setPermMatrix(data.matrix);
    } catch (err) {
      // Non-fatal — the rest of Settings still works without this panel.
      console.error('Failed to load permission groups:', err);
    } finally {
      setPermLoading(false);
    }
  }

  async function savePermissions() {
    setPermSaving(true);
    try {
      const data = await apiPut('/settings/permissions', { permissions: permMatrix });
      setPermData(data);
      setPermMatrix(data.matrix);
      showToast(t('perm.savedToast'), 'success');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setPermSaving(false);
    }
  }

  async function load() {
    setLoading(true);
    try {
      const [rateData, attemptsData] = await Promise.all([
        apiGet('/cost-rates'),
        apiGet('/auth/login-attempts?limit=20').catch(() => []),
      ]);
      setRates(rateData);
      setLoginAttempts(attemptsData || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); loadPermissions(); }, []);

  async function updateRate(id, cost_per_gram) {
    setSaving(id);
    try {
      await apiPut(`/cost-rates/${id}`, { cost_per_gram: Number(cost_per_gram) });
      load();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSaving(null);
    }
  }

  async function downloadBackup() {
    setBackupError('');
    try {
      const token = localStorage.getItem('sg_token');
      const res = await fetch(API_BASE + '/backup/export', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(tf('settings.backupFailed', { status: res.status }));
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'swag-gold-backup.json';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setBackupError(err.message);
    }
  }

  if (loading) return <><SkeletonPanel height={80} /><div style={{ height: 16 }} /><SkeletonPanel height={80} /></>;

  return (
    <section className="view active">
      <div className="topbar">
        <div>
          <div className="page-title">{t('settings.title')}</div>
          <div className="page-subtitle">{tf('settings.signedInAs', { name: user?.name, role: user?.role })}</div>
        </div>
      </div>

      {error && <div className="login-err" style={{ display: 'block' }}>⚠ {error}</div>}

      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-title" style={{ marginBottom: 12 }}>{t('settings.costRates')}</div>
        <div className="form-grid">
          {rates.map(r => (
            <div className="form-field" key={r.id}>
              <label>{String(r.purity).toUpperCase()}</label>
              <input
                type="number" min="0" step="0.01"
                defaultValue={r.cost_per_gram}
                onBlur={e => updateRate(r.id, e.target.value)}
                disabled={saving === r.id}
              />
            </div>
          ))}
        </div>
        <p style={{ color: 'var(--cream-dim)', fontSize: 12.5, marginTop: 10 }}>
          {t('settings.autoSaveHint')}
        </p>
      </div>

      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-title" style={{ marginBottom: 12 }}>{t('settings.teamAccess')}</div>
        <p style={{ color: 'var(--cream-dim)', fontSize: 13.5, marginBottom: 12 }}>
          {t('settings.teamAccessDesc')}
        </p>
        <Link className="btn gold" to="/users">{t('settings.manageUsers')}</Link>
      </div>

      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-title" style={{ marginBottom: 12 }}>{t('perm.title')}</div>
        <p style={{ color: 'var(--cream-dim)', fontSize: 13.5, marginBottom: 16 }}>
          {t('perm.desc')}
        </p>
        {permLoading ? (
          <div style={{ color: 'var(--cream-faint)', fontSize: 13 }}>{t('common.loading')}</div>
        ) : permData && (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t('perm.capability')}</th>
                    {permData.roles.filter(r => r !== 'admin').map(role => (
                      <th key={role} style={{ textAlign: 'center' }}>
                        {role === 'supervisor' ? t('mod.roleSupervisor') : role === 'cashier' ? t('mod.roleCashier') : role}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {permData.permissions.map(p => (
                    <tr key={p.key}>
                      <td>
                        <div style={{ fontWeight: 600, color: 'var(--cream)' }}>{t(`perm.key.${p.key}.label`)}</div>
                        <div style={{ fontSize: 12, color: 'var(--cream-faint)', marginTop: 2 }}>{t(`perm.key.${p.key}.desc`)}</div>
                      </td>
                      {permData.roles.filter(r => r !== 'admin').map(role => (
                        <td key={role} style={{ textAlign: 'center' }}>
                          <input
                            type="checkbox"
                            style={{ width: 18, height: 18, cursor: 'pointer' }}
                            checked={!!permMatrix[role]?.[p.key]}
                            onChange={e => {
                              setPermMatrix(m => ({
                                ...m,
                                [role]: { ...m[role], [p.key]: e.target.checked },
                              }));
                            }}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button className="btn gold" style={{ marginTop: 14 }} disabled={permSaving} onClick={savePermissions}>
              {permSaving ? t('common.saving') : t('perm.save')}
            </button>
            <p style={{ fontSize: 12, color: 'var(--cream-faint)', marginTop: 10 }}>{t('perm.adminNote')}</p>
          </>
        )}
      </div>

      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-title" style={{ marginBottom: 12 }}>{t('settings.backup')}</div>
        <p style={{ color: 'var(--cream-dim)', fontSize: 13.5, marginBottom: 12 }}>
          {t('settings.backupDesc')}
        </p>
        <button className="btn gold" onClick={downloadBackup}>{t('settings.downloadBackup')}</button>
        {backupError && <div className="login-err" style={{ display: 'block', marginTop: 10 }}>⚠ {backupError}</div>}
      </div>

      <div className="panel">
        <div className="panel-title" style={{ marginBottom: 12 }}>{t('settings.loginAttempts')}</div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>{t('settings.when')}</th><th>{t('users.username')}</th><th>{t('settings.result')}</th><th>{t('settings.ip')}</th><th>{t('settings.reason')}</th></tr></thead>
            <tbody>
              {loginAttempts.map(a => (
                <tr key={a.id}>
                  <td>{new Date(a.created_at).toLocaleString()}</td>
                  <td>{a.username}</td>
                  <td style={{ color: a.success ? 'var(--emerald)' : 'var(--red)' }}>{a.success ? t('common.success') : t('common.failed')}</td>
                  <td>{a.ip_address || '—'}</td>
                  <td>{a.reason || ''}</td>
                </tr>
              ))}
              {loginAttempts.length === 0 && (
                <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--cream-faint)' }}>{t('settings.noLoginAttempts')}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
