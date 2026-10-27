import { useState } from 'react';
import { useLanguage } from '../context/LanguageContext.jsx';

// Wraps any text (invoice numbers, IDs, etc.) so clicking it copies to the
// clipboard and shows a brief "Copied!" tooltip — handy whenever a cashier
// needs to quickly hand an invoice number to a customer or paste it
// elsewhere, without manually selecting/dragging over the text.
export default function CopyableText({ text, children, style = {} }) {
  const { t } = useLanguage();
  const [copied, setCopied] = useState(false);

  async function handleCopy(e) {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(String(text));
    } catch (_) {
      // Fallback for browsers/contexts without Clipboard API permission
      const ta = document.createElement('textarea');
      ta.value = String(text);
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch (_e) { /* give up quietly */ }
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  }

  return (
    <span
      onClick={handleCopy}
      title={copied ? t('common.copied') : t('common.clickToCopy')}
      style={{
        position: 'relative', cursor: 'pointer', display: 'inline-flex',
        alignItems: 'center', gap: 5, ...style,
      }}
    >
      {children ?? text}
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        style={{ width: 12, height: 12, opacity: .45, flexShrink: 0 }}>
        <rect x="9" y="9" width="13" height="13" rx="2" />
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
      </svg>
      {copied && (
        <span style={{
          position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)',
          marginBottom: 6, background: 'var(--emerald)', color: '#fff',
          fontSize: 11.5, fontWeight: 700, padding: '3px 8px', borderRadius: 6,
          whiteSpace: 'nowrap', animation: 'toastIn .15s ease', zIndex: 10,
        }}>
          {t('common.copied')}
        </span>
      )}
    </span>
  );
}
