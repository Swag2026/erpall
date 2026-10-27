import { useRef, useState } from 'react';
import Modal from './Modal.jsx';
import { apiPut, apiPost } from '../lib/api';
import { useAuth } from '../context/AuthContext.jsx';
import { useLanguage } from '../context/LanguageContext.jsx';

function resizeToSquareDataUri(file, size = 200) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext('2d');
        const side = Math.min(img.width, img.height);
        const sx = (img.width - side) / 2, sy = (img.height - side) / 2;
        ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = () => reject(new Error('Could not read that image'));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error('Could not read that file'));
    reader.readAsDataURL(file);
  });
}

export default function ProfileModal({ onClose }) {
  const { user, setUserLocal } = useAuth();
  const { t } = useLanguage();
  const fileInputRef = useRef(null);

  const [fullName, setFullName] = useState(user?.name || '');
  const [email, setEmail] = useState(user?.email || '');
  const [phone, setPhone] = useState(user?.phone || '');
  const [avatar, setAvatar] = useState(user?.avatar || null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const [showPwForm, setShowPwForm] = useState(false);
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [pwError, setPwError] = useState('');
  const [pwSuccess, setPwSuccess] = useState('');
  const [pwSaving, setPwSaving] = useState(false);

  async function handleAvatarSelect(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { setError(t('prof.selectImageError')); return; }
    try {
      const dataUri = await resizeToSquareDataUri(file);
      setAvatar(dataUri);
    } catch (err) {
      setError(err.message);
    }
    e.target.value = '';
  }

  async function saveProfile(e) {
    e.preventDefault();
    setError('');
    if (!fullName.trim()) { setError(t('prof.fullNameRequired')); return; }
    setSaving(true);
    try {
      const updated = await apiPut('/auth/profile', { full_name: fullName.trim(), email, phone, avatar });
      setUserLocal({ name: updated.full_name, email: updated.email, phone: updated.phone, avatar: updated.avatar });
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function submitPasswordChange(e) {
    e.preventDefault();
    setPwError(''); setPwSuccess('');
    if (newPw.length < 8) { setPwError(t('prof.pwShort')); return; }
    setPwSaving(true);
    try {
      await apiPost('/auth/change-password', { current_password: currentPw, new_password: newPw });
      setPwSuccess(t('prof.pwChanged'));
      setCurrentPw(''); setNewPw('');
    } catch (err) {
      setPwError(err.message);
    } finally {
      setPwSaving(false);
    }
  }

  return (
    <Modal title={t('prof.title')} onClose={onClose}>
      <form onSubmit={saveProfile}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 18 }}>
          <div
            onClick={() => fileInputRef.current?.click()}
            style={{
              width: 84, height: 84, borderRadius: '50%', cursor: 'pointer',
              background: avatar ? `url(${avatar}) center/cover` : 'var(--surface-3)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              border: '2px solid var(--gold-21)', fontSize: 28, color: 'var(--gold-24)',
            }}
          >
            {!avatar && (fullName[0]?.toUpperCase() || '?')}
          </div>
          <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={handleAvatarSelect} />
        </div>

        <div className="form-field" style={{ marginBottom: 14 }}>
          <label>{t('prof.fullname')}</label>
          <input value={fullName} onChange={e => setFullName(e.target.value)} />
        </div>
        <div className="form-field" style={{ marginBottom: 14 }}>
          <label>{t('prof.email')}</label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} />
        </div>
        <div className="form-field" style={{ marginBottom: 14 }}>
          <label>{t('prof.phone')}</label>
          <input value={phone} onChange={e => setPhone(e.target.value)} />
        </div>

        {error && <div className="login-err" style={{ display: 'block' }}>⚠ {error}</div>}

        <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
          <button className="btn gold" type="submit" disabled={saving}>{saving ? t('common.saving') : t('prof.save')}</button>
          <button className="btn ghost" type="button" onClick={() => setShowPwForm(s => !s)}>
            {showPwForm ? 'Hide' : 'Change'} Password
          </button>
        </div>
      </form>

      {showPwForm && (
        <form onSubmit={submitPasswordChange} style={{ marginTop: 20, paddingTop: 20, borderTop: '1px solid var(--line)' }}>
          <div className="form-field" style={{ marginBottom: 14 }}>
            <label>{t('pw.current')}</label>
            <input type="password" value={currentPw} onChange={e => setCurrentPw(e.target.value)} />
          </div>
          <div className="form-field" style={{ marginBottom: 14 }}>
            <label>{t('pw.new')} (min 8 characters)</label>
            <input type="password" value={newPw} onChange={e => setNewPw(e.target.value)} />
          </div>
          {pwError && <div className="login-err" style={{ display: 'block' }}>⚠ {pwError}</div>}
          {pwSuccess && <div className="alert success" style={{ padding: 10, borderRadius: 8 }}>✓ {pwSuccess}</div>}
          <button className="btn gold" type="submit" disabled={pwSaving} style={{ marginTop: 8 }}>
            {pwSaving ? 'Updating…' : t('pw.submit')}
          </button>
        </form>
      )}
    </Modal>
  );
}
