import { useEffect } from 'react';
import { IconX } from './Icons.jsx';
import { useLanguage } from '../context/LanguageContext.jsx';

// Full-screen lightbox for previewing an attached image in-app, instead
// of just opening a new browser tab. Click the backdrop, press Escape,
// or hit the X to close.
export default function AttachmentPreview({ src, name, onClose }) {
  const { t } = useLanguage();
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!src) return null;
  const isImage = src.startsWith('data:image');

  return (
    <div
      className="attachment-lightbox-backdrop"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="attachment-lightbox-inner">
        <button className="attachment-lightbox-close" onClick={onClose} aria-label={t('common.close')}>
          <IconX size={18} />
        </button>
        {isImage ? (
          <img src={src} alt={name || 'attachment'} className="attachment-lightbox-img" />
        ) : (
          <div className="attachment-lightbox-file">
            <div>{name || 'attachment'}</div>
            <a href={src} download={name} className="btn gold sm">{t('common.download')}</a>
          </div>
        )}
        {name && <div className="attachment-lightbox-caption">{name}</div>}
      </div>
    </div>
  );
}
