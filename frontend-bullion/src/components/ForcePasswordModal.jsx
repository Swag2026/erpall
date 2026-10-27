import { useState } from 'react';
import Modal from './Modal.jsx';
import { apiPost } from '../lib/api';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useLanguage } from '../context/LanguageContext.jsx';
import { IconAlertTriangle } from './Icons.jsx';

export default function ForcePasswordModal() {
  const { t } = useLanguage();
  const { setUserLocal, logout } = useAuth();
  const { showToast } = useToast();
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (newPw.length < 8) { setError(t('force.minLengthError')); return; }
    if (newPw !== confirmPw) { setError(t('force.mismatchError')); return; }
    setSaving(true);
    try {
      await apiPost('/auth/change-password', { current_password: currentPw, new_password: newPw });
      setUserLocal({ mustChangePassword: false });
      showToast(t('force.updatedToast'), 'success');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={t('force.setNewPassword')} onClose={logout} width={420}>
      <p style={{ color: 'var(--cream-dim)', fontSize: 13.5, marginBottom: 16 }}>
        {t('force.description')}
      </p>
      <form onSubmit={submit}>
        <div className="form-field" style={{ marginBottom: 14 }}>
          <label>{t('force.tempPassword')}</label>
          <input type="password" value={currentPw} onChange={e => setCurrentPw(e.target.value)} autoFocus />
        </div>
        <div className="form-field" style={{ marginBottom: 14 }}>
          <label>{t('pw.new')} ({t('force.minChars')})</label>
          <input type="password" value={newPw} onChange={e => setNewPw(e.target.value)} />
        </div>
        <div className="form-field" style={{ marginBottom: 14 }}>
          <label>{t('pw.confirm')}</label>
          <input type="password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)} />
        </div>
        {error && <div className="login-err" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><IconAlertTriangle size={14} /> {error}</div>}
        <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
          <button className="btn gold" type="submit" disabled={saving}>{saving ? t('common.saving') : t('force.setPasswordContinue')}</button>
          <button className="btn ghost" type="button" onClick={logout}>{t('force.signOutInstead')}</button>
        </div>
      </form>
    </Modal>
  );
}
