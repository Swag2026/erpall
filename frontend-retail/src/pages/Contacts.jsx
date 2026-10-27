import { useEffect, useState } from 'react';
import { apiGet, apiPost, apiPut, apiDelete } from '../lib/api';
import { useAuth } from '../context/AuthContext.jsx';
import { useLanguage } from '../context/LanguageContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import ConfirmModal from '../components/ConfirmModal.jsx';
import { SkeletonTable } from '../components/Skeleton.jsx';

const emptyForm = { name: '', phone: '', email: '', contact_type: 'customer', city: '', notes: '' };

export default function Contacts() {
  const { showToast } = useToast();
  const { user } = useAuth();
  const { t } = useLanguage();
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [showForm, setShowForm] = useState(false);
  const [detailContact, setDetailContact] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);

  async function load() {
    setLoading(true);
    try {
      setContacts(await apiGet('/contacts'));
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

  function startEdit(c) {
    setForm({ name: c.name, phone: c.phone || '', email: c.email || '', contact_type: c.contact_type, city: c.city || '', notes: c.notes || '' });
    setEditingId(c.id);
    setShowForm(true);
  }

  async function save(e) {
    e.preventDefault();
    try {
      if (editingId) await apiPut(`/contacts/${editingId}`, form);
      else await apiPost('/contacts', form);
      setShowForm(false);
      load();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function remove(id) {
    try {
      await apiDelete(`/contacts/${id}`);
      setPendingDelete(null);
      showToast('Contact deleted', 'success');
      load();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  if (loading) return <SkeletonTable rows={5} cols={4} />;

  return (
    <section className="view active">
      <div className="topbar">
        <div>
          <div className="page-title">{t('contacts.title')}</div>
          <div className="page-subtitle">{t('contacts.subtitle')}</div>
        </div>
        <div className="topbar-actions">
          <button className="btn gold" onClick={startAdd}>{t('contacts.new')}</button>
        </div>
      </div>

      {error && <div className="login-err" style={{ display: 'block' }}>⚠ {error}</div>}

      {showForm && (
        <form className="panel" onSubmit={save} style={{ marginBottom: 16 }}>
          <div className="form-grid">
            <div className="form-field"><label>{t('common.name')}</label><input required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
            <div className="form-field">
              <label>{t('common.type')}</label>
              <select value={form.contact_type} onChange={e => setForm(f => ({ ...f, contact_type: e.target.value }))}>
                <option value="customer">{t('contacts.customer')}</option>
                <option value="supplier">{t('contacts.supplier')}</option>
                <option value="both">{t('contacts.both')}</option>
              </select>
            </div>
            <div className="form-field"><label>{t('common.phone')}</label><input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} /></div>
            <div className="form-field"><label>{t('common.email')}</label><input value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} /></div>
            <div className="form-field"><label>{t('contacts.city')}</label><input value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} /></div>
          </div>
          <div className="form-field" style={{ marginTop: 12 }}>
            <label>{t('common.notes')}</label>
            <input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
            <button className="btn gold" type="submit">{editingId ? 'Update' : t('common.save')}</button>
            <button className="btn ghost" type="button" onClick={() => setShowForm(false)}>{t('common.cancel')}</button>
          </div>
        </form>
      )}

      <div className="panel">
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>{t('common.name')}</th><th>{t('common.type')}</th><th>{t('common.phone')}</th><th>{t('contacts.city')}</th><th>{t('contacts.totalSales')}</th><th>{t('contacts.totalPurchases')}</th><th>{t('common.actions')}</th></tr>
            </thead>
            <tbody>
              {contacts.map(c => (
                <tr key={c.id}>
                  <td>
                    <span style={{ cursor: 'pointer', color: 'var(--gold-21)', fontWeight: 600 }} onClick={() => setDetailContact(c)}>
                      {c.name}
                    </span>
                  </td>
                  <td>{c.contact_type}</td>
                  <td>{c.phone}</td>
                  <td>{c.city}</td>
                  <td>{Number(c.total_sales_amount || 0).toLocaleString()}</td>
                  <td>{Number(c.total_purchase_amount || 0).toLocaleString()}</td>
                  <td style={{ display: 'flex', gap: 6 }}>
                    {user?.role !== 'cashier' && <button className="btn ghost sm" onClick={() => startEdit(c)}>{t('common.edit')}</button>}
                    {(user?.role === 'admin' || user?.role === 'supervisor') && <button className="btn ghost sm" onClick={() => setPendingDelete(c)}>{t('common.delete')}</button>}
                  </td>
                </tr>
              ))}
              {contacts.length === 0 && (
                <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--cream-faint)' }}>{t('contacts.none')}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {detailContact && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(4,6,13,.6)', overflowY: 'auto', padding: '24px 16px' }}
          onClick={e => { if (e.target === e.currentTarget) setDetailContact(null); }}
        >
          <div className="panel" style={{ width: 520, maxWidth: '92vw', margin: 'auto', maxHeight: '82vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <div className="panel-title">{detailContact.name}</div>
              <button className="btn ghost sm" onClick={() => setDetailContact(null)}>✕</button>
            </div>
            <div style={{ color: 'var(--cream-dim)', fontSize: 13, marginBottom: 16 }}>
              {detailContact.contact_type} {detailContact.city ? `· ${detailContact.city}` : ''} {detailContact.phone ? `· ${detailContact.phone}` : ''}
            </div>
            <div className="cards-grid" style={{ marginBottom: 18 }}>
              <div className="card">
                <div className="card-label">{t('contacts.totalSales')}</div>
                <div className="card-value">{Number(detailContact.total_sales_amount || 0).toLocaleString()}</div>
              </div>
              <div className="card">
                <div className="card-label">{t('contacts.totalPurchases')}</div>
                <div className="card-value">{Number(detailContact.total_purchase_amount || 0).toLocaleString()}</div>
              </div>
              <div className="card">
                <div className="card-label">{t('dash.totalInvoices')}</div>
                <div className="card-value">{detailContact.total_invoices || 0}</div>
              </div>
            </div>
            <div className="panel-title" style={{ marginBottom: 10 }}>{t('contacts.invoiceHistory')}</div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>{t('common.invoice')}</th><th>{t('common.date')}</th><th>{t('common.category')}</th><th>{t('common.total')}</th></tr></thead>
                <tbody>
                  {(detailContact.invoices || []).map(inv => (
                    <tr key={inv.id}>
                      <td>{inv.invoice_no}</td>
                      <td>{inv.invoice_date}</td>
                      <td>{inv.category}</td>
                      <td>{Number(inv.total_amount).toLocaleString()}</td>
                    </tr>
                  ))}
                  {(!detailContact.invoices || detailContact.invoices.length === 0) && (
                    <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--cream-faint)' }}>{t('contacts.noInvoicesYet')}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
      {pendingDelete && (
        <ConfirmModal
          title={t('contacts.deleteContact')}
          message={`Delete "${pendingDelete.name}"? This cannot be undone.`}
          onConfirm={() => remove(pendingDelete.id)}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </section>
  );
}
