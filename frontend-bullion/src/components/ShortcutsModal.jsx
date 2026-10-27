import Modal from './Modal.jsx';
import { useLanguage } from '../context/LanguageContext.jsx';

const SHORTCUTS = [
  { descKey: 'shortcuts.newEntry', key: 'N' },
  { descKey: 'shortcuts.history', key: '/' },
  { descKey: 'shortcuts.dashboard', key: 'D' },
  { descKey: 'shortcuts.activityLog', key: 'A' },
  { descKey: 'shortcuts.showShortcuts', key: '?' },
  { descKey: 'shortcuts.closeModal', key: 'Esc' },
];

export default function ShortcutsModal({ onClose }) {
  const { t } = useLanguage();
  return (
    <Modal title={t('mod.shortcuts')} onClose={onClose} width={420}>
      <p style={{ color: 'var(--cream-dim)', fontSize: 13.5, marginBottom: 14 }}>
        {t('shortcuts.intro')}
      </p>
      <div>
        {SHORTCUTS.map(s => (
          <div key={s.key} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
            <span style={{ fontSize: 13.5 }}>{t(s.descKey)}</span>
            <span style={{
              fontFamily: "'IBM Plex Mono',monospace", background: 'var(--surface-3)',
              border: '1px solid var(--line-2)', borderRadius: 5, padding: '2px 8px', fontSize: 12.5,
            }}>{s.key}</span>
          </div>
        ))}
      </div>
      <button className="btn gold" onClick={onClose} style={{ marginTop: 16 }}>{t('mod.gotit')}</button>
    </Modal>
  );
}
