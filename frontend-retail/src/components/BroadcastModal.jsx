import { useState } from 'react';
import { apiPost } from '../lib/api';
import { useLanguage } from '../context/LanguageContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import Modal from './Modal.jsx';
import { IconSend } from './Icons.jsx';

// Admin-only — sends one announcement to every active user at once, instead
// of messaging each person individually. Reuses the same Message table as
// direct chat (just flagged), so it shows up in everyone's chat/notifications
// automatically with no separate system to maintain.
export default function BroadcastModal({ onClose }) {
  const { t, tf } = useLanguage();
  const { showToast } = useToast();
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);

  async function send() {
    if (!body.trim() || sending) return;
    setSending(true);
    try {
      const sent = await apiPost('/messages/broadcast', { body: body.trim() });
      showToast(tf('chat.broadcastSentToast', { n: sent.length }), 'success');
      onClose();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal title={t('chat.broadcastTitle')} onClose={onClose} width={440}>
      <p style={{ color: 'var(--cream-dim)', fontSize: 13.5, marginBottom: 14 }}>
        {t('chat.broadcastDesc')}
      </p>
      <div className="form-field" style={{ marginBottom: 16 }}>
        <label>{t('chat.broadcastLabel')}</label>
        <textarea
          dir="auto"
          rows={4}
          style={{ width: '100%', resize: 'vertical' }}
          value={body}
          onChange={e => setBody(e.target.value)}
          placeholder={t('chat.broadcastPlaceholder')}
        />
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button className="btn ghost" onClick={onClose}>{t('common.cancel')}</button>
        <button className="btn gold" onClick={send} disabled={sending || !body.trim()} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <IconSend size={14} /> {sending ? t('common.saving') : t('chat.broadcastSend')}
        </button>
      </div>
    </Modal>
  );
}
