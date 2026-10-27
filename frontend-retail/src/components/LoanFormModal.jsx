import { useMemo, useState } from 'react';
import Modal from './Modal.jsx';
import { apiPost } from '../lib/api';
import { useLanguage } from '../context/LanguageContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { todayLocalStr } from '../lib/dateUtils';
import { KARAT_KEYS, k21eq, fmtG2, fmtMoney } from '../lib/loans.js';
import { IconAlertTriangle, IconPaperclip, IconX } from './Icons.jsx';

const MAX_ATTACHMENT_BYTES = 1_500_000;
const LTR = { direction: 'ltr', unicodeBidi: 'isolate', display: 'inline-block' };
const TABS = ['lend', 'return', 'settle', 'sold'];
const nz = (v) => (v === '' || v == null ? 0 : Number(v) || 0);

// One form for the four things that can happen on a shop's account:
//   lend  → metal leaves stock (debit)      return → metal comes back (credit)
//   settle → shop keeps it and pays cash     sold   → shop sold the pieces, we receive the sale amount
export default function LoanFormModal({ shops, shopId, initialTab = 'lend', onClose, onSaved }) {
  const { t, tf } = useLanguage();
  const { showToast } = useToast();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [approve, setApprove] = useState(false);
  const [tab, setTab] = useState(initialTab);
  const [sid, setSid] = useState(shopId || shops[0]?.id || '');
  const [w, setW] = useState({ w24: '', w21: '', w18: '', silver: '' });
  const [cash, setCash] = useState('');
  const [time, setTime] = useState('18:00');
  const [takenBy, setTakenBy] = useState('');
  const [note, setNote] = useState('');
  const [pieces, setPieces] = useState([]);
  const [attachment, setAttachment] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const shop = useMemo(() => shops.find((s) => String(s.id) === String(sid)), [shops, sid]);
  const out = shop?.balance || { w24: 0, w21: 0, w18: 0, silver: 0 };
  const isLend = tab === 'lend';
  const isCashIn = tab === 'settle' || tab === 'sold';

  const entered = KARAT_KEYS.map((k) => ({ ...k, v: nz(w[k.bal]) }));
  const totalEq = k21eq(entered[0].v, entered[1].v, entered[2].v);
  const totalSilver = entered[3].v;
  const totalGrams = entered.reduce((a, x) => a + x.v, 0);
  const over = !isLend && entered.find((x) => x.v > (out[x.bal] || 0) + 0.0005);
  const curEq = shop?.balance_21k_eq || 0;
  const newEq = curEq + (isLend ? totalEq : -totalEq);
  const limit = shop?.credit_limit || 0;
  const overLimit = isLend && limit > 0 && newEq > limit + 0.0005;

  function setKey(k, v) { setW((p) => ({ ...p, [k]: v })); setError(''); }
  function fillAll() {
    setW({ w24: out.w24 > 0 ? String(out.w24) : '', w21: out.w21 > 0 ? String(out.w21) : '', w18: out.w18 > 0 ? String(out.w18) : '', silver: out.silver > 0 ? String(out.silver) : '' });
  }
  function pickFile(e) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (f.size > MAX_ATTACHMENT_BYTES) { setError(t('entry.attachmentTooLarge')); return; }
    const r = new FileReader();
    r.onload = () => setAttachment({ dataUrl: r.result, name: f.name });
    r.readAsDataURL(f);
  }

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (!shop) { setError(t('loans.pickShop')); return; }
    if (totalGrams <= 0) { setError(t('loans.enterWeight')); return; }
    if (over) { setError(tf('loans.overOutstanding', { name: shop.name, have: Number(out[over.bal]).toString(), k: over.k === 'Silver' ? t('common.silver') : over.k, want: String(over.v) })); return; }
    if (isCashIn && nz(cash) <= 0) { setError(t('loans.enterCash')); return; }
    if (overLimit && !(isAdmin && approve)) { setError(isAdmin ? t('loans.limitApproveFirst') : t('loans.limitNeedAdmin')); return; }
    setSaving(true);
    try {
      const payload = {
        shop_id: shop.id,
        entry_type: tab === 'sold' ? 'settle' : tab,
        entry_date: todayLocalStr(),
        weight_24k: nz(w.w24), weight_21k: nz(w.w21), weight_18k: nz(w.w18), weight_silver: nz(w.silver),
        note: note.trim() || null,
      };
      if (overLimit && isAdmin && approve) payload.override_limit = true;
      if (isLend) {
        payload.expected_return_time = time || null;
        payload.taken_by = takenBy.trim() || null;
        const ps = pieces.filter((p) => p.desc.trim());
        payload.pieces = ps.length ? ps.map((p) => ({ desc: p.desc.trim(), karat: p.karat || null, weight: p.weight === '' ? null : Number(p.weight) })) : null;
        payload.attachment_data = attachment?.dataUrl || null;
        payload.attachment_name = attachment?.name || null;
      } else if (tab === 'return') {
        payload.taken_by = takenBy.trim() || null; // who brought it back
      } else {
        payload.cash_amount = nz(cash);
        payload.settle_kind = tab === 'sold' ? 'sold' : 'cash';
        payload.rate = totalGrams > 0 ? Math.round((nz(cash) / totalGrams) * 100) / 100 : null;
        payload.taken_by = takenBy.trim() || null;
      }
      const saved = await apiPost('/shop-loans/entries', payload);
      showToast(t(`loans.saved.${tab}`), 'success');
      onSaved?.(saved);
      onClose();
    } catch (err) {
      setError(err.message || t('common.failed'));
    } finally {
      setSaving(false);
    }
  }

  const submitLabel = { lend: t('loans.lendGold'), return: t('loans.receiveBack'), settle: t('loans.settleCash'), sold: t('loans.markSold') }[tab];

  return (
    <Modal title={shop ? shop.name : t('loans.title')} onClose={onClose} width={560}>
      <form onSubmit={submit}>
        <div className="sl-tabs" role="tablist">
          {TABS.map((k) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} className={`sl-tab ${tab === k ? 'on' : ''} ${k}`} onClick={() => { setTab(k); setError(''); }}>
              {{ lend: t('loans.tabLend'), return: t('loans.tabReturn'), settle: t('loans.tabSettle'), sold: t('loans.tabSold') }[k]}
            </button>
          ))}
        </div>
        <p className="sl-hint">{t(`loans.hint.${tab}`)}</p>

        {!shopId && (
          <div className="form-field" style={{ marginBottom: 12 }}>
            <label>{t('loans.shop')}</label>
            <select value={sid} onChange={(e) => { setSid(e.target.value); setError(''); }}>
              {shops.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        )}

        <div className="form-field" style={{ marginBottom: 12 }}>
          <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>{t('loans.weightByKarat')}</span>
            {!isLend && <button type="button" className="sl-link" onClick={fillAll}>{t('loans.fillAll')}</button>}
          </label>
          <div className="sl-krows">
            {KARAT_KEYS.map((k) => {
              const have = out[k.bal] || 0;
              const bad = !isLend && nz(w[k.bal]) > have + 0.0005;
              return (
                <div key={k.bal} className={`sl-krow ${nz(w[k.bal]) > 0 ? 'on' : ''}`}>
                  <span className="sl-kk">{k.k === 'Silver' ? t('common.silver') : k.k}</span>
                  <input type="number" inputMode="decimal" min="0" step="0.001" placeholder="0.00" value={w[k.bal]} onChange={(e) => setKey(k.bal, e.target.value)} className={bad ? 'bad' : ''} />
                  <span className="sl-unit">g</span>
                  {!isLend && <span className={`sl-have ${have > 0 ? '' : 'z'}`}>{tf('loans.outstanding', { g: fmtG2(have) })}</span>}
                </div>
              );
            })}
          </div>
        </div>

        {isCashIn && (
          <div className="form-field" style={{ marginBottom: 12 }}>
            <label>{tab === 'sold' ? t('loans.saleAmount') : t('loans.cashReceived')}</label>
            <div className="sl-krow on" style={{ gridTemplateColumns: '1fr auto' }}>
              <input type="number" inputMode="decimal" min="0" step="0.01" placeholder="0.00" value={cash} onChange={(e) => { setCash(e.target.value); setError(''); }} />
              <span className="sl-unit">SAR</span>
            </div>
            {totalGrams > 0 && nz(cash) > 0 && <div className="sl-sub">{tf('loans.avgRate', { r: fmtMoney(nz(cash) / totalGrams) })}</div>}
          </div>
        )}

        {isLend && (
          <>
            <div className="sl-two">
              <div className="form-field"><label>{t('loans.expectedBy')}</label><input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></div>
              <div className="form-field"><label>{t('loans.takenBy')}</label><input value={takenBy} onChange={(e) => setTakenBy(e.target.value)} placeholder={t('loans.takenByPh')} /></div>
            </div>
            <div className="form-field" style={{ marginBottom: 12 }}>
              <label>{t('loans.pieces')}</label>
              {pieces.map((p, i) => (
                <div key={i} className="sl-piece">
                  <input value={p.desc} placeholder={t('loans.pieceDesc')} onChange={(e) => setPieces((a) => a.map((x, j) => (j === i ? { ...x, desc: e.target.value } : x)))} />
                  <select value={p.karat} onChange={(e) => setPieces((a) => a.map((x, j) => (j === i ? { ...x, karat: e.target.value } : x)))}>
                    <option value="">—</option><option>24K</option><option>21K</option><option>18K</option><option value="Silver">{t('common.silver')}</option>
                  </select>
                  <input type="number" min="0" step="0.001" placeholder="g" value={p.weight} onChange={(e) => setPieces((a) => a.map((x, j) => (j === i ? { ...x, weight: e.target.value } : x)))} />
                  <button type="button" className="btn ghost sm" onClick={() => setPieces((a) => a.filter((_, j) => j !== i))} aria-label={t('common.close')}><IconX size={13} /></button>
                </div>
              ))}
              <button type="button" className="sl-add" onClick={() => setPieces((a) => [...a, { desc: '', karat: '', weight: '' }])}>＋ {t('loans.addPiece')}</button>
            </div>
            <div className="form-field" style={{ marginBottom: 12 }}>
              <label>{t('entry.attachment')}</label>
              {!attachment ? (
                <label className="btn ghost sm attachment-pick-btn" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <IconPaperclip size={14} /> {t('entry.attachAdd')}
                  <input type="file" accept="image/*" onChange={pickFile} style={{ display: 'none' }} />
                </label>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <img src={attachment.dataUrl} alt="" style={{ height: 44, borderRadius: 6, border: '1px solid var(--line)' }} />
                  <span style={{ fontSize: 12.5, color: 'var(--cream-dim)' }}>{attachment.name}</span>
                  <button type="button" className="btn ghost sm" onClick={() => setAttachment(null)}><IconX size={13} /></button>
                </div>
              )}
            </div>
          </>
        )}

        {!isLend && (
          <div className="form-field" style={{ marginBottom: 12 }}>
            <label>{tab === 'return' ? t('loans.broughtBy') : t('loans.paidBy')}</label>
            <input value={takenBy} onChange={(e) => setTakenBy(e.target.value)} placeholder={t('loans.takenByPh')} />
          </div>
        )}

        <div className="form-field" style={{ marginBottom: 14 }}>
          <label>{t('loans.note')}</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('loans.notePh')} />
        </div>

        <div className={`sl-sum ${isLend ? 'debit' : 'credit'}`}>
          <div>
            <small>{isLend ? t('loans.debitTo') : t('loans.creditTo')}</small>
            <b style={LTR}>{fmtG2(totalEq)} g</b>
            {totalSilver > 0 && <span className="sl-sub" style={LTR}> + {fmtG2(totalSilver)} g {t('common.silver')}</span>}
          </div>
          <div className="sl-newbal">
            <small>{t('loans.newBalance')}</small>
            <b style={LTR}>{fmtG2(Math.max(0, newEq))} g</b>
          </div>
        </div>
        {overLimit && (
          <div className="sl-limitwarn">
            <IconAlertTriangle size={14} />
            <span>{tf('loans.limitWarn', { name: shop.name, after: fmtG2(newEq), limit: fmtG2(limit) })}{!isAdmin && ` ${t('loans.limitNeedAdmin')}`}</span>
            {isAdmin && <label className="sl-approve"><input type="checkbox" checked={approve} onChange={(e) => setApprove(e.target.checked)} /> {t('loans.limitAdminOk')}</label>}
          </div>
        )}
        {isCashIn && nz(cash) > 0 && <div className="sl-sub" style={{ marginTop: 6 }}>{tf('loans.cashInNote', { amt: fmtMoney(nz(cash)) })}</div>}

        {error && <div className="login-err" style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '12px 0 0' }}><IconAlertTriangle size={14} /> {error}</div>}
        {over && !error && <div className="login-err" style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '12px 0 0' }}><IconAlertTriangle size={14} /> {tf('loans.overOutstanding', { name: shop.name, have: Number(out[over.bal]).toString(), k: over.k === 'Silver' ? t('common.silver') : over.k, want: String(over.v) })}</div>}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
          <button type="button" className="btn ghost" onClick={onClose}>{t('common.cancel')}</button>
          <button type="submit" className="btn gold" disabled={saving || !shop || !!over || (overLimit && !(isAdmin && approve))}>{saving ? t('common.saving') : submitLabel}</button>
        </div>
      </form>
    </Modal>
  );
}
