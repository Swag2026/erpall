import Modal from './Modal.jsx';
import { useLanguage } from '../context/LanguageContext.jsx';

export default function ConfirmModal({ title, message, confirmLabel, onConfirm, onCancel, danger = true }) {
  const { t } = useLanguage();
  const finalTitle = title || t('mod.confirmcancel');
  const finalConfirmLabel = confirmLabel || t('mod.delete');
  return (
    <Modal title={finalTitle} onClose={onCancel} width={400}>
      <p style={{ color: 'var(--cream-dim)', fontSize: 14.5, marginBottom: 20, lineHeight: 1.6 }}>{message}</p>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <button className="btn ghost" onClick={onCancel}>{t('mod.cancel')}</button>
        <button className={danger ? 'btn danger' : 'btn gold'} onClick={onConfirm}>{finalConfirmLabel}</button>
      </div>
    </Modal>
  );
}
