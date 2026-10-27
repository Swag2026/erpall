import { OTHER_APP_ID, APPS_META } from '../lib/appConfig.js';
import { useEffect, useState } from 'react';
import { apiGet, apiPost, apiPut, apiDelete } from '../lib/api';
import { useAuth } from '../context/AuthContext.jsx';
import { useLanguage } from '../context/LanguageContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { SkeletonTable } from '../components/Skeleton.jsx';

const ROLES = ['cashier', 'supervisor', 'admin'];
const emptyForm = { username: '', full_name: '', password: '', role: 'cashier', also_in: [] };

export default function Users() {
  const { showToast } = useToast();
  const { user: me } = useAuth();
  const { t, tf } = useLanguage();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);

  async function load() {
    setLoading(true);
    try {
      setUsers(await apiGet('/users'));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function startAdd() {
    setForm(emptyForm);
    setEditingId(null);
    setShowForm(true);
  }

  function startEdit(u) {
    setForm({ username: u.username, full_name: u.full_name, password: '', role: u.role });
    setEditingId(u.id);
    setShowForm(true);
  }

  async function save(e) {
    e.preventDefault();
    try {
      if (editingId) {
        const body = { full_name: form.full_name, role: form.role };
        if (form.password) body.password = form.password;
        await apiPut(`/users/${editingId}`, body);
      } else {
        await apiPost('/users', form);
      }
      setShowForm(false);
      load();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function toggleActive(u) {
    try {
      if (u.is_active) {
        await apiDelete(`/users/${u.id}`); // soft-disable
      } else {
        await apiPut(`/users/${u.id}`, { is_active: true });
      }
      load();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  if (loading) return <SkeletonTable rows={5} cols={5} />;

  return (
    <section className="view active">
      <div className="topbar">
        <div>
          <div className="page-title">{t('users.title')}</div>
          <div className="page-subtitle">{t('users.subtitle')}</div>
        </div>
        <div className="topbar-actions">
          <button className="btn gold" onClick={startAdd}>{t('users.new')}</button>
        </div>
      </div>

      {error && <div className="login-err" style={{ display: 'block' }}>⚠ {error}</div>}

      {showForm && (
        <form className="panel" onSubmit={save} style={{ marginBottom: 16 }}>
          <div className="form-grid">
            <div className="form-field">
              <label>{t('users.username')}</label>
              <input required disabled={!!editingId} value={form.username}
                onChange={e => setForm(f => ({ ...f, username: e.target.value }))} />
            </div>
            <div className="form-field">
              <label>{t('users.fullName')}</label>
              <input required value={form.full_name}
                onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} />
            </div>
            <div className="form-field">
              <label>{editingId ? 'New Password (leave blank to keep current)' : 'Password'}</label>
              <input type="password" required={!editingId} value={form.password}
                onChange={e => setForm(f => ({ ...f, password: e.target.value }))} />
            </div>
            <div className="form-field">
              <label>{t('users.role')}</label>
              <select
                value={form.role}
                disabled={editingId === me?.id}
                onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
              >
                {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            {!editingId && (
              <div className="form-field" style={{ gridColumn: '1 / -1' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={(form.also_in || []).includes(OTHER_APP_ID)}
                    onChange={e => setForm(f => ({ ...f, also_in: e.target.checked ? [OTHER_APP_ID] : [] }))}
                  />
                  {tf('users.alsoIn', { app: APPS_META[OTHER_APP_ID].name })}
                </label>
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            <button className="btn gold" type="submit">{editingId ? 'Update' : 'Create'} User</button>
            <button className="btn ghost" type="button" onClick={() => setShowForm(false)}>{t('common.cancel')}</button>
          </div>
        </form>
      )}

      <div className="panel">
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>{t('users.username')}</th><th>{t('users.fullName')}</th><th>{t('users.role')}</th><th>{t('common.status')}</th><th>{t('common.actions')}</th></tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id} style={!u.is_active ? { opacity: 0.5 } : undefined}>
                  <td>{u.username}</td>
                  <td>{u.full_name}</td>
                  <td>{u.role}</td>
                  <td>{u.is_active ? 'Active' : 'Disabled'}</td>
                  <td style={{ display: 'flex', gap: 6 }}>
                    <button className="btn ghost sm" onClick={() => startEdit(u)}>{t('common.edit')}</button>
                    {u.id !== me?.id && (
                      <button className="btn ghost sm" onClick={() => toggleActive(u)}>
                        {u.is_active ? t('users.disable') : t('users.enable')}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
