import { useState } from 'react';
import { apiPost, apiPut, apiDelete } from '../lib/api';
import { useLanguage } from '../context/LanguageContext.jsx';

const ADD_NEW = '__add_new__';

// Dropdown of salesmen with an inline "add new name" option, used on the
// Sale / Purchase entry forms. `salesmen` + `onCreated` come from the
// parent so the list stays in one place.
export default function SalesmanSelect({ value, onChange, salesmen, onCreated, onRenamed, onDeleted, canManage }) {
  const { t } = useLanguage();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const selected = salesmen.find(s => String(s.id) === String(value));

  function handleSelect(e) {
    if (e.target.value === ADD_NEW) {
      setAdding(true);
      setErr('');
      return;
    }
    onChange(e.target.value);
  }

  async function addSalesman() {
    const clean = name.replace(/\s+/g, ' ').trim();
    if (!clean) { setErr(t('entry.salesmanNameRequired')); return; }
    setBusy(true);
    setErr('');
    try {
      const created = await apiPost('/salesmen', { name: clean });
      onCreated(created);
      onChange(String(created.id));
      setName('');
      setAdding(false);
    } catch (ex) {
      setErr(typeof ex.message === 'string' ? ex.message : t('entry.salesmanNameRequired'));
    } finally {
      setBusy(false);
    }
  }

  async function renameSalesman() {
    const clean = editName.replace(/\s+/g, ' ').trim();
    if (!clean) { setErr(t('entry.salesmanNameRequired')); return; }
    setBusy(true); setErr('');
    try {
      const updated = await apiPut('/salesmen/' + selected.id, { name: clean });
      onRenamed && onRenamed(updated);
      setEditing(false);
    } catch (ex) {
      setErr(typeof ex.message === 'string' ? ex.message : '');
    } finally { setBusy(false); }
  }

  async function deleteSalesman() {
    if (!window.confirm(t('entry.salesmanDeleteConfirm'))) return;
    setBusy(true); setErr('');
    try {
      await apiDelete('/salesmen/' + selected.id);
      onDeleted && onDeleted(selected.id);
      onChange('');
      setEditing(false);
    } catch (ex) {
      setErr(typeof ex.message === 'string' ? ex.message : '');
    } finally { setBusy(false); }
  }

  return (
    <div className="form-field" style={{ marginBottom: 18 }}>
      <label>{t('entry.salesman')}</label>
      <select value={value} onChange={handleSelect}>
        <option value="">— {t('entry.noSalesman')} —</option>
        {salesmen.map(s => (
          <option key={s.id} value={s.id}>{s.name}</option>
        ))}
        <option value={ADD_NEW}>{t('entry.addSalesman')}</option>
      </select>
      {canManage && selected && !adding && !editing && (
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button type="button" className="btn ghost sm" onClick={() => { setEditName(selected.name); setEditing(true); setErr(''); }}>
            ✎ {t('entry.salesmanEdit')}
          </button>
          <button type="button" className="btn ghost sm" style={{ color: 'var(--red, #c0392b)' }} onClick={deleteSalesman} disabled={busy}>
            🗑 {t('entry.salesmanDelete')}
          </button>
        </div>
      )}
      {editing && selected && (
        <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          <input
            autoFocus
            style={{ flex: '1 1 180px' }}
            value={editName}
            maxLength={150}
            onChange={e => setEditName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); renameSalesman(); }
              if (e.key === 'Escape') { setEditing(false); setErr(''); }
            }}
          />
          <button type="button" className="btn gold sm" onClick={renameSalesman} disabled={busy}>{t('entry.salesmanSave')}</button>
          <button type="button" className="btn ghost sm" onClick={() => { setEditing(false); setErr(''); }}>{t('entry.salesmanCancel')}</button>
        </div>
      )}
      {adding && (
        <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          <input
            autoFocus
            style={{ flex: '1 1 180px' }}
            value={name}
            maxLength={150}
            placeholder={t('entry.salesmanNamePh')}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); addSalesman(); }
              if (e.key === 'Escape') { setAdding(false); setErr(''); }
            }}
          />
          <button type="button" className="btn gold sm" onClick={addSalesman} disabled={busy}>
            {t('entry.salesmanAdd')}
          </button>
          <button type="button" className="btn ghost sm" onClick={() => { setAdding(false); setErr(''); setName(''); }}>
            {t('entry.salesmanCancel')}
          </button>
        </div>
      )}
      {err && <div style={{ fontSize: 12, color: 'var(--red, #c0392b)', marginTop: 4 }}>{err}</div>}
    </div>
  );
}
