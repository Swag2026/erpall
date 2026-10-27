import { useState, useEffect } from 'react';
import { apiGet, apiPost } from '../lib/api';
import { useLanguage } from '../context/LanguageContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import Modal from './Modal.jsx';

// Admin or anyone can spin up a named group with a chosen set of teammates —
// simpler than a full channel system, but enough for "Exhibition Floor
// Staff" style team chats instead of only 1-on-1 DMs or all-hands broadcasts.
export default function CreateGroupModal({ onClose, onCreated }) {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const [name, setName] = useState('');
  const [users, setUsers] = useState([]);
  const [selected, setSelected] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiGet('/messages/conversations').then(data => {
      setUsers(Array.isArray(data) ? data : []);
    }).catch(() => {});
  }, []);

  function toggle(id) {
    setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);
  }

  async function create() {
    if (!name.trim() || selected.length === 0 || saving) return;
    setSaving(true);
    try {
      const group = await apiPost('/messages/groups', { name: name.trim(), member_ids: selected });
      showToast(t('chat.groupCreatedToast'), 'success');
      onCreated(group);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={t('chat.newGroup')} onClose={onClose} width={420}>
      <div className="form-field" style={{ marginBottom: 14 }}>
        <label>{t('chat.groupName')}</label>
        <input dir="auto" value={name} onChange={e => setName(e.target.value)} placeholder={t('chat.groupNamePlaceholder')} autoFocus />
      </div>
      <div className="form-field" style={{ marginBottom: 16 }}>
        <label>{t('chat.groupMembers')}</label>
        <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid var(--line-2)', borderRadius: 10 }}>
          {users.map(u => (
            <label
              key={u.user_id}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', cursor: 'pointer', borderBottom: '1px solid var(--line)' }}
            >
              <input type="checkbox" checked={selected.includes(u.user_id)} onChange={() => toggle(u.user_id)} />
              <span>{u.full_name}</span>
            </label>
          ))}
          {users.length === 0 && (
            <div style={{ padding: 12, fontSize: 12.5, color: 'var(--cream-faint)' }}>{t('chat.noOtherUsers')}</div>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button className="btn ghost" onClick={onClose}>{t('common.cancel')}</button>
        <button className="btn gold" onClick={create} disabled={saving || !name.trim() || selected.length === 0}>
          {saving ? t('common.saving') : t('chat.createGroup')}
        </button>
      </div>
    </Modal>
  );
}
