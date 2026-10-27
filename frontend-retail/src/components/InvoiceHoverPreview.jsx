import { useLayoutEffect, useRef, useState } from 'react';
import { IconSaudiRiyal } from './Icons.jsx';

const num = (n) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
const LTR = { direction: 'ltr', unicodeBidi: 'isolate', display: 'inline-block' };

// Small floating card shown while the mouse rests on a History row, so an invoice can be checked
// without opening the full modal. It never takes pointer events, so it can't steal the hover.
export default function InvoiceHoverPreview({ entry, anchor, t, catLabel }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: -9999, top: -9999 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth, h = el.offsetHeight;
    const vw = window.innerWidth, vh = window.innerHeight;
    let left = Math.min(Math.max(12, anchor.x + 16), vw - w - 12);
    let top = anchor.rowBottom + 8;
    if (top + h > vh - 12) top = Math.max(12, anchor.rowTop - h - 8);
    setPos({ left, top });
  }, [entry, anchor]);

  const lines = [
    entry.weight_21k > 0 && ['21K', entry.weight_21k, entry.amount_21k],
    entry.weight_18k > 0 && ['18K', entry.weight_18k, entry.amount_18k],
    entry.weight_24k > 0 && ['24K', entry.weight_24k, entry.amount_24k],
    entry.weight_silver > 0 && [t('common.silver'), entry.weight_silver, entry.amount_silver],
  ].filter(Boolean);
  const canceled = entry.status === 'canceled';
  const isImg = entry.attachment_data && entry.attachment_data.startsWith('data:image');
  const edited = entry.validity === 'Edited' && entry.updated_by_name;

  return (
    <div ref={ref} className="inv-hover" style={{ left: pos.left, top: pos.top }} role="tooltip">
      <div className="inv-hover-head">
        <b style={LTR}>#{entry.invoice_no}</b>
        <span className={`tag status-${canceled ? 'canceled' : 'paid'}`}>{canceled ? t('opt.canceled') : t('opt.active')}</span>
      </div>
      <div className="inv-hover-meta">{catLabel(entry.category)} · <span style={LTR}>{entry.invoice_date}</span></div>

      {lines.length > 0 ? (
        <div className="inv-hover-lines">
          {lines.map(([k, w, a]) => (
            <div key={k}><span>{k}</span><span style={LTR}>{w}g</span><span style={LTR}>{num(a)}</span></div>
          ))}
        </div>
      ) : entry.description ? (
        <div className="inv-hover-desc">{entry.description}</div>
      ) : null}

      <div className="inv-hover-total">
        <span>{t('common.total')}</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><IconSaudiRiyal size={13} /> <span style={LTR}>{num(entry.total_amount)}</span></span>
      </div>
      <div className="inv-hover-row"><span>{t('common.cash')} / {t('common.card')}</span><span style={LTR}>{num(entry.cash_amount)} / {num(entry.card_amount)}</span></div>
      {entry.contact_name && <div className="inv-hover-row"><span>{t('entry.customer')}</span><span>{entry.contact_name}</span></div>}
      {entry.salesman_name && <div className="inv-hover-row"><span>{t('hist.salesman')}</span><span>{entry.salesman_name}</span></div>}
      {(edited || entry.note) && (
        <div className="inv-hover-note">
          {edited && <div>{t('hist.editedBy')} {entry.updated_by_name}</div>}
          {entry.note && <div>{entry.note}</div>}
        </div>
      )}
      {isImg && <img className="inv-hover-img" src={entry.attachment_data} alt="" />}
    </div>
  );
}
