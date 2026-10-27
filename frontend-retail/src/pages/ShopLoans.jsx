import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiGet, apiPost, apiPut, apiDelete } from '../lib/api';
import { useAuth } from '../context/AuthContext.jsx';
import { useLanguage } from '../context/LanguageContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { todayLocalStr } from '../lib/dateUtils';
import { balanceChips, entryChips, isOverdue, fmtG, fmtG2, fmtMoney, k21eq, loanFlows } from '../lib/loans.js';
import { buildLendSlip, buildStatement, statementWhatsAppText, openPdf, pdfFile } from '../lib/loanDocs.js';
import LoanFormModal from '../components/LoanFormModal.jsx';
import Modal from '../components/Modal.jsx';
import { SkeletonTable } from '../components/Skeleton.jsx';
import { IconAlertTriangle, IconSaudiRiyal } from '../components/Icons.jsx';

const LTR = { direction: 'ltr', unicodeBidi: 'isolate', display: 'inline-block' };
const TYPE_COLOR = { lend: '#C04840', return: '#1E8A5C', settle: '#2F8F83', sold: '#1D5C8C' };

const timeOf = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '');
const dateOf = (iso) => (iso ? new Date(iso).toLocaleDateString('en-CA') : '');

function waNumber(phone) {
  let d = String(phone || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('0')) d = '966' + d.slice(1); // Saudi local format
  return d;
}

export default function ShopLoans() {
  const { t, tf, lang } = useLanguage();
  const { can } = useAuth();
  const { showToast } = useToast();
  const canManage = can('loans.manage');

  const [shops, setShops] = useState([]);
  const [today, setToday] = useState({});
  const [entries, setEntries] = useState([]);
  const [entriesShop, setEntriesShop] = useState(null); // which shop `entries` belongs to (so we never show another shop's rows)
  const reqRef = useRef(0);
  const [selId, setSelId] = useState(null);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [form, setForm] = useState(null);        // { tab, shopId }
  const [shopForm, setShopForm] = useState(null); // { id?, name, phone }
  const [slipFor, setSlipFor] = useState(null);   // a lend entry just saved (or picked) → print slip
  const [cancelFor, setCancelFor] = useState(null);
  const [cancelNote, setCancelNote] = useState('');
  const [cancelErr, setCancelErr] = useState('');
  const [now, setNow] = useState(new Date());

  const todayStr = todayLocalStr();

  const load = useCallback(async () => {
    try {
      const [sh, sum] = await Promise.all([apiGet('/shop-loans/shops'), apiGet('/shop-loans/daily-summary')]);
      setShops(sh || []);
      setToday((sum || {})[todayStr] || {});
      setError('');
      return sh || [];
    } catch (e) {
      setError(e.message);
      return [];
    } finally {
      setLoading(false);
    }
  }, [todayStr]);

  const loadEntries = useCallback(async (id) => {
    const req = ++reqRef.current;
    if (!id) { setEntries([]); setEntriesShop(null); return; }
    try {
      const list = await apiGet(`/shop-loans/entries?shop_id=${id}&limit=2000`);
      if (req !== reqRef.current) return; // a newer click already asked for another shop
      setEntries(list);
      setEntriesShop(id);
    } catch (e) { if (req === reqRef.current) setError(e.message); }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { const i = setInterval(() => setNow(new Date()), 60000); return () => clearInterval(i); }, []);
  // pick a shop automatically: the one that owes the most, else the first
  useEffect(() => {
    if (selId && shops.some((s) => s.id === selId)) return;
    const owing = [...shops].sort((a, b) => b.balance_21k_eq - a.balance_21k_eq)[0];
    setSelId(owing?.id ?? null);
  }, [shops, selId]);
  useEffect(() => { loadEntries(selId); }, [selId, loadEntries]);

  const sel = shops.find((s) => s.id === selId) || null;
  const owing = useMemo(() => shops.filter((s) => s.balance_21k_eq > 0.0005 || s.balance.silver > 0.0005), [shops]);
  const overdue = useMemo(() => owing.filter((s) => isOverdue(s, todayStr)), [owing, todayStr]);
  const totalOutEq = owing.reduce((a, s) => a + s.balance_21k_eq, 0);
  const flows = loanFlows(today);

  // "evening" = past the latest promised return time (default 18:00) while someone still owes gold
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const dueMin = Math.max(18 * 60, ...owing.map((s) => (s.expected_return_time ? Number(s.expected_return_time.slice(0, 2)) * 60 + Number(s.expected_return_time.slice(3)) : 0)));
  const eveningNow = owing.length > 0 && nowMin >= dueMin;
  const showBanner = owing.length > 0 && (eveningNow || overdue.length > 0);
  const bannerShops = eveningNow ? owing : overdue;

  const filtered = shops.filter((s) => !q.trim() || s.name.toLowerCase().includes(q.trim().toLowerCase()));

  // chronological running balance (21K-eq grams still with the shop) for the selected shop
  const entriesReady = entriesShop === selId;
  const rows = useMemo(() => {
    if (!entriesReady) return [];
    const asc = [...entries].sort((a, b) => (a.occurred_at || '').localeCompare(b.occurred_at || '') || a.id - b.id);
    let bal = 0;
    const out = asc.map((e) => {
      if (e.status === 'active') bal += (e.entry_type === 'lend' ? 1 : -1) * e.weight_21k_eq;
      return { e, bal };
    });
    return out.reverse();
  }, [entries, entriesReady]);

  const typeKey = (e) => (e.entry_type === 'settle' && e.settle_kind === 'sold' ? 'sold' : e.entry_type);
  const typeLabel = (e) => t(`loans.type.${typeKey(e)}`);

  function remind(shop) {
    const lines = balanceChips(shop.balance).map(([k, w]) => `${k === 'Silver' ? t('common.silver') : k}: ${fmtG(w)}g`).join(' — ');
    const msg = tf('loans.waMsg', { name: shop.name, lines });
    const num = waNumber(shop.phone);
    window.open(`https://wa.me/${num}?text=${encodeURIComponent(msg)}`, '_blank', 'noopener');
  }

  function printSlip(entry) {
    try { openPdf(buildLendSlip(entry, shops.find((s) => s.id === entry.shop_id) || sel)); } catch (err) { showToast(err.message || t('common.failed'), 'error'); }
  }

  function statementPdf() {
    try { openPdf(buildStatement(sel, entries)); } catch (err) { showToast(err.message || t('common.failed'), 'error'); }
  }

  async function statementWhatsApp() {
    try {
      const doc = buildStatement(sel, entries);
      const name = `${sel.name.replace(/[^\w\u0600-\u06FF-]+/g, '_')}_statement_${todayStr}.pdf`;
      const balLine = balanceChips(sel.balance).length
        ? tf('loans.stmtBalLine', { lines: balanceChips(sel.balance).map(([k, w]) => `${k === 'Silver' ? t('common.silver') : k}: ${fmtG(w)}g`).join(' — ') })
        : t('loans.stmtClear');
      const text = statementWhatsAppText(sel, entries, balLine);
      const file = pdfFile(doc, name);
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], text });
        return;
      }
      doc.save(name); // desktop: save the PDF, open WhatsApp with the summary; attach the file there
      window.open(`https://wa.me/${waNumber(sel.phone)}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
      showToast(t('loans.stmtDownloaded'), 'success');
    } catch (err) {
      if (err?.name !== 'AbortError') showToast(err.message || t('common.failed'), 'error');
    }
  }

  async function saveShop(e) {
    e.preventDefault();
    const sf = shopForm;
    if (!sf.name.trim()) return;
    try {
      const cl = Number(sf.credit_limit);
      const body = { name: sf.name.trim(), phone: sf.phone.trim() || null, credit_limit: cl > 0 ? cl : null };
      const res = sf.id ? await apiPut(`/shop-loans/shops/${sf.id}`, body) : await apiPost('/shop-loans/shops', body);
      showToast(t('loans.shopSaved'), 'success');
      setShopForm(null);
      await load();
      setSelId(res.id);
    } catch (err) { setShopForm({ ...sf, err: err.message }); }
  }

  async function removeShop(s) {
    try {
      await apiDelete(`/shop-loans/shops/${s.id}`);
      showToast(t('loans.shopRemoved'), 'success');
      setShopForm(null);
      setSelId(null);
      await load();
    } catch (err) { setShopForm((f) => ({ ...f, err: err.message })); }
  }

  async function doCancel() {
    setCancelErr('');
    try {
      await apiPost(`/shop-loans/entries/${cancelFor.id}/cancel`, { note: cancelNote.trim() || null });
      showToast(t('loans.entryCanceled'), 'success');
      setCancelFor(null); setCancelNote('');
      await load(); await loadEntries(selId);
    } catch (err) { setCancelErr(err.message); }
  }

  async function onSaved(saved) {
    if (saved?.entry_type === 'lend') setSlipFor(saved);
    await load();
    if (saved?.shop_id) setSelId(saved.shop_id);
    await loadEntries(saved?.shop_id || selId);
  }

  if (loading) return <SkeletonTable rows={6} cols={4} />;

  return (
    <section className="view active">
      <div className="topbar">
        <div>
          <div className="page-title">{t('loans.title')}</div>
          <div className="page-subtitle">{t('loans.subtitle')}</div>
        </div>
        {canManage && (
          <div className="topbar-actions sl-topbar-actions">
            <button className="btn small" onClick={() => setShopForm({ name: '', phone: '', credit_limit: '' })}>＋ {t('loans.addShop')}</button>
            <button className="btn gold small" disabled={!shops.length} onClick={() => setForm({ tab: 'lend', shopId: sel?.id })}>{t('loans.lendGold')}</button>
          </div>
        )}
      </div>

      {error && <div className="login-err" style={{ display: 'block', marginBottom: 12 }}>⚠ {error}</div>}

      {showBanner && (
        <div className="sl-banner">
          <div className="sl-banner-text">
            <IconAlertTriangle size={16} />
            <span>
              <b>{tf(eveningNow ? 'loans.bannerEvening' : 'loans.bannerOverdue', { n: bannerShops.length })}</b>
              {' — '}{bannerShops.map((s) => s.name).join('، ').slice(0, 120)}
            </span>
          </div>
          <div className="sl-banner-actions">
            {bannerShops.slice(0, 4).map((s) => (
              <button key={s.id} className="btn small" onClick={() => remind(s)} title={s.phone ? '' : t('loans.noPhone')}>
                {t('loans.remind')} · {s.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="cards-grid sl-kpis">
        <div className="card sl-k out"><div className="card-label">{t('loans.lentToday')}</div><div className="card-value"><span style={LTR}>{fmtG2(flows.lentGold)}</span><em>g</em></div><div className="card-hint">{t('card.21keq')}</div></div>
        <div className="card sl-k back"><div className="card-label">{t('loans.returnedToday')}</div><div className="card-value"><span style={LTR}>{fmtG2(flows.returnedGold + flows.settledGold)}</span><em>g</em></div><div className="card-hint">{flows.settledCash > 0 ? tf('loans.ofWhichCash', { amt: fmtMoney(flows.settledCash) }) : t('card.21keq')}</div></div>
        <div className="card sl-k late"><div className="card-label">{t('loans.outNow')}</div><div className="card-value"><span style={LTR}>{fmtG2(totalOutEq)}</span><em>g</em></div><div className="card-hint">{t('card.21keq')}</div></div>
        <div className="card sl-k shops"><div className="card-label">{t('loans.shopsOwing')}</div><div className="card-value"><span style={LTR}>{owing.length}</span><em>/ {shops.length}</em></div><div className="card-hint">{overdue.length ? tf('loans.overdueN', { n: overdue.length }) : t('loans.noneOverdue')}</div></div>
      </div>

      {shops.length === 0 ? (
        <div className="panel sl-empty">
          <div className="panel-title">{t('loans.emptyTitle')}</div>
          <p>{t('loans.emptyBody')}</p>
          {canManage && <button className="btn gold" onClick={() => setShopForm({ name: '', phone: '' })}>＋ {t('loans.addShop')}</button>}
        </div>
      ) : (
        <div className="sl-grid">
          <div className="panel sl-list">
            <div className="panel-title" style={{ marginBottom: 10 }}>{t('loans.shops')}</div>
            <div className="hx-search" style={{ marginBottom: 10 }}>
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('loans.searchShop')} />
            </div>
            {filtered.map((s) => {
              const chips = balanceChips(s.balance);
              const state = chips.length === 0 ? 'clear' : isOverdue(s, todayStr) ? 'late' : 'out';
              return (
                <button key={s.id} type="button" className={`sl-shop ${state} ${s.id === selId ? 'sel' : ''}`} onClick={() => setSelId(s.id)}>
                  <span className="sl-shop-top">
                    <b>{s.name}</b>
                    <span className={`sl-st ${state}`}>
                      {state === 'clear' ? t('loans.cleared') : state === 'late' ? t('loans.overdue') : (s.expected_return_time ? tf('loans.dueAt', { time: s.expected_return_time }) : t('loans.out'))}
                    </span>
                  </span>
                  <span className="sl-chips">
                    {chips.length ? chips.map(([k, w]) => <span key={k} className="sl-chip" style={LTR}>{k === 'Silver' ? t('common.silver') : k} <b>{fmtG(w)}g</b></span>) : <span className="sl-chip z">{t('loans.nothingPending')}</span>}
                  </span>
                </button>
              );
            })}
            {filtered.length === 0 && <div className="sl-sub" style={{ padding: 8 }}>{t('loans.noMatch')}</div>}
          </div>

          <div className="panel sl-detail">
            {sel && (
              <>
                <div className="sl-dh">
                  <div>
                    <div className="sl-dname">{sel.name}</div>
                    <div className="sl-sub">
                      {sel.last_activity ? tf('loans.lastActivity', { when: `\u2066${dateOf(sel.last_activity)} ${timeOf(sel.last_activity)}\u2069` }) : t('loans.noActivity')}
                      {sel.phone ? <> · <span style={LTR}>{sel.phone}</span></> : null}
                    </div>
                  </div>
                  {canManage && (
                    <div className="sl-actions">
                      <button className="btn sl-b lend" onClick={() => setForm({ tab: 'lend', shopId: sel.id })}>− {t('loans.lendGold')}</button>
                      <button className="btn sl-b back" disabled={!balanceChips(sel.balance).length} onClick={() => setForm({ tab: 'return', shopId: sel.id })}>+ {t('loans.receiveBack')}</button>
                      <button className="btn sl-b cash" disabled={!balanceChips(sel.balance).length} onClick={() => setForm({ tab: 'settle', shopId: sel.id })}>{t('loans.settleCash')}</button>
                      <button className="btn sl-b" disabled={!balanceChips(sel.balance).length} onClick={() => setForm({ tab: 'sold', shopId: sel.id })}>{t('loans.markSold')}</button>
                      <button className="btn ghost small" onClick={() => setShopForm({ id: sel.id, name: sel.name, phone: sel.phone || '', credit_limit: sel.credit_limit || '' })} title={t('loans.editShop')}>✎</button>
                    </div>
                  )}
                </div>
                <div className="sl-docs">
                  <button className="btn ghost small" onClick={statementPdf}>📄 {t('loans.statement')}</button>
                  <button className="btn ghost small" onClick={statementWhatsApp}>💬 {t('loans.sendStatement')}</button>
                </div>

                <div className="sl-bal">
                  {[['21K', sel.balance.w21], ['18K', sel.balance.w18], ['24K', sel.balance.w24], [t('common.silver'), sel.balance.silver]].map(([k, w]) => (
                    <div key={k} className={w > 0.0005 ? 'on' : ''}><small>{k}</small><b style={LTR}>{fmtG(w)} g</b></div>
                  ))}
                  <div className="tot"><small>{t('loans.totalEq')}</small><b style={LTR}>{fmtG2(sel.balance_21k_eq)} g</b></div>
                </div>

                {sel.credit_limit > 0 && (() => {
                  const used = sel.balance_21k_eq, pct = Math.min(100, (used / sel.credit_limit) * 100);
                  return (
                    <div className={`sl-limit ${used > sel.credit_limit + 0.0005 ? 'over' : pct >= 80 ? 'warn' : ''}`}>
                      <div className="sl-limit-top"><span>{t('loans.creditLimit')}</span><b style={LTR}>{tf('loans.limitUsed', { used: fmtG2(used), limit: fmtG2(sel.credit_limit) })}</b></div>
                      <div className="sl-limit-bar"><i style={{ width: `${pct}%` }} /></div>
                    </div>
                  );
                })()}

                <div className="table-wrap">
                  <table className="sl-table">
                    <thead>
                      <tr>
                        <th>{t('loans.when')}</th><th>{t('loans.type')}</th><th>{t('loans.gold')}</th><th>{t('loans.cash')}</th><th>{t('loans.balanceEq')}</th><th>{t('loans.by')}</th><th />
                      </tr>
                    </thead>
                    <tbody key={entriesReady ? `r${selId}` : 'loading'} className="sl-tbody">
                      {!entriesReady && [0, 1, 2].map((i) => (
                        <tr key={`sk${i}`} className="sl-skel"><td colSpan={7}><span /></td></tr>
                      ))}
                      {rows.map(({ e, bal }) => {
                        const k = typeKey(e);
                        const canceled = e.status === 'canceled';
                        return (
                          <tr key={e.id} className={canceled ? 'canceled' : ''} style={{ '--c': TYPE_COLOR[k] }}>
                            <td><span style={LTR} className="mono">{dateOf(e.occurred_at).slice(5)} {timeOf(e.occurred_at)}</span></td>
                            <td><span className="sl-dot" />{typeLabel(e)}{canceled && <span className="sl-cx">{t('opt.canceled')}</span>}{e.entry_type === 'lend' && !canceled && <button type="button" className="sl-slipbtn" title={t('loans.printSlip')} aria-label={t('loans.printSlip')} onClick={() => printSlip(e)}>🖨</button>}</td>
                            <td>
                              {entryChips(e).map(([kk, w]) => <span key={kk} className="sl-chip" style={LTR}>{kk === 'Silver' ? t('common.silver') : kk} <b>{fmtG(w)}g</b></span>)}
                              {e.pieces?.length > 0 && <div className="sl-sub">{e.pieces.map((p) => p.desc).join('، ')}</div>}
                              {e.note && <div className="sl-sub">{e.note}</div>}
                              {e.has_attachment && <span className="sl-sub">📎</span>}
                            </td>
                            <td>{e.cash_amount > 0 ? <span style={LTR} className="mono sl-cashv"><IconSaudiRiyal size={12} /> {fmtMoney(e.cash_amount)}</span> : '—'}</td>
                            <td>{canceled ? '—' : <b style={LTR} className="mono">{fmtG2(bal)}</b>}</td>
                            <td>{e.created_by_name}{e.taken_by ? <div className="sl-sub">{e.taken_by}</div> : null}</td>
                            <td>{canManage && !canceled && <button className="btn ghost small" onClick={() => { setCancelFor(e); setCancelNote(''); setCancelErr(''); }}>{t('common.cancel')}</button>}</td>
                          </tr>
                        );
                      })}
                      {entriesReady && rows.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--cream-faint)' }}>{t('loans.noEntries')}</td></tr>}
                    </tbody>
                  </table>
                </div>
                <div className="sl-auto">{t('loans.autoNote')}</div>
              </>
            )}
          </div>
        </div>
      )}

      {form && <LoanFormModal shops={shops} shopId={form.shopId} initialTab={form.tab} onClose={() => setForm(null)} onSaved={onSaved} />}

      {shopForm && (
        <Modal title={shopForm.id ? t('loans.editShop') : t('loans.addShop')} onClose={() => setShopForm(null)} width={420}>
          <form onSubmit={saveShop}>
            <div className="form-field" style={{ marginBottom: 12 }}><label>{t('loans.shopName')}</label><input autoFocus value={shopForm.name} onChange={(e) => setShopForm({ ...shopForm, name: e.target.value, err: '' })} /></div>
            <div className="form-field" style={{ marginBottom: 12 }}><label>{t('loans.phone')}</label><input value={shopForm.phone} onChange={(e) => setShopForm({ ...shopForm, phone: e.target.value })} placeholder="05xxxxxxxx" style={{ direction: 'ltr' }} /></div>
            <div className="form-field" style={{ marginBottom: 12 }}>
              <label>{t('loans.creditLimit')}</label>
              <input type="number" inputMode="decimal" min="0" step="0.001" value={shopForm.credit_limit ?? ''} onChange={(e) => setShopForm({ ...shopForm, credit_limit: e.target.value })} placeholder={t('loans.noLimit')} style={{ direction: 'ltr' }} />
              <div className="sl-sub">{t('loans.creditLimitHint')}</div>
            </div>
            {shopForm.err && <div className="login-err" style={{ display: 'block', marginBottom: 10 }}>⚠ {shopForm.err}</div>}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between' }}>
              <div>{shopForm.id && <button type="button" className="btn danger small" onClick={() => removeShop(sel)}>{t('loans.removeShop')}</button>}</div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button type="button" className="btn ghost" onClick={() => setShopForm(null)}>{t('common.cancel')}</button>
                <button type="submit" className="btn gold">{t('common.save')}</button>
              </div>
            </div>
          </form>
        </Modal>
      )}

      {slipFor && (
        <Modal title={t('loans.slipTitle')} onClose={() => setSlipFor(null)} width={400}>
          <p style={{ color: 'var(--cream-dim)', fontSize: 14, marginBottom: 16 }}>{tf('loans.slipAsk', { shop: slipFor.shop_name })}</p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button className="btn ghost" onClick={() => setSlipFor(null)}>{t('loans.notNow')}</button>
            <button className="btn gold" onClick={() => { printSlip(slipFor); setSlipFor(null); }}>🖨 {t('loans.printSlip')}</button>
          </div>
        </Modal>
      )}

      {cancelFor && (
        <Modal title={t('loans.cancelEntry')} onClose={() => setCancelFor(null)} width={420}>
          <p style={{ color: 'var(--cream-dim)', fontSize: 14, marginBottom: 14 }}>{tf('loans.cancelConfirm', { type: typeLabel(cancelFor), shop: cancelFor.shop_name })}</p>
          <div className="form-field" style={{ marginBottom: 14 }}>
            <label>{t('hist.reason')}</label>
            <input value={cancelNote} onChange={(e) => setCancelNote(e.target.value)} placeholder={t('hist.cancelReasonPlaceholder')} />
          </div>
          {cancelErr && <div className="login-err" style={{ display: 'block', marginBottom: 10 }}>⚠ {cancelErr}</div>}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button className="btn ghost" onClick={() => setCancelFor(null)}>{t('loans.keepEntry')}</button>
            <button className="btn danger" onClick={doCancel}>{t('loans.cancelEntry')}</button>
          </div>
        </Modal>
      )}
    </section>
  );
}
