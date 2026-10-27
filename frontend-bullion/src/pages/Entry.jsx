import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { apiGet, apiPost, apiPut } from '../lib/api';
import { todayLocalStr } from '../lib/dateUtils';
import { useAuth } from '../context/AuthContext.jsx';
import { useLanguage } from '../context/LanguageContext.jsx';
import DateField from '../components/DateField.jsx';
import { IconAlertTriangle, IconPaperclip, IconX, IconSaudiRiyal } from '../components/Icons.jsx';
import AttachmentPreview from '../components/AttachmentPreview.jsx';
import SalesmanSelect from '../components/SalesmanSelect.jsx';
import { Typewriter } from '../components/ui/typewriter.tsx';

const MAX_ATTACHMENT_BYTES = 1_500_000; // ~1.5MB, matches the chat attachment limit

const CATEGORIES = [
  {
    key: 'sale', labelKey: 'entry.sale', hasKarat: true, contactKey: 'entry.customer',
    iconClass: 'entry-launcher-icon-sale',
    icon: <><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" /><path d="M3 6h18" /><path d="M16 10a4 4 0 0 1-8 0" /></>,
  },
  {
    key: 'purchase_jewelry', labelKey: 'entry.purchaseJewelry', hasKarat: true, contactKey: 'entry.supplier',
    iconClass: 'entry-launcher-icon-pj',
    icon: <><circle cx="12" cy="15" r="6" /><path d="M9 9 11 4h2l2 5" /><path d="M9 9h6l-3 4.5Z" /></>,
  },
  {
    key: 'purchase_scrap', labelKey: 'entry.purchaseScrap', hasKarat: true, contactKey: 'entry.supplier',
    iconClass: 'entry-launcher-icon-ps',
    icon: <><path d="M16 16l3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z" /><path d="M2 16l3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z" /><path d="M7 21h10" /><path d="M12 3v18" /><path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2" /></>,
  },
  {
    key: 'supplier_payment', labelKey: 'entry.supplierPayment', hasKarat: true, contactKey: 'entry.supplier',
    iconClass: 'entry-launcher-icon-sp',
    icon: <><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" /><path d="M3 5v14a2 2 0 0 0 2 2h16v-5" /><path d="M18 12a2 2 0 0 0 0 4h4v-4Z" /></>,
  },
  {
    key: 'expense', labelKey: 'entry.expense', hasKarat: false, contactKey: null,
    iconClass: 'entry-launcher-icon-exp',
    icon: <><path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z" /><path d="M16 8h-6" /><path d="M14 12H8" /><path d="M8 16h6" /></>,
  },
  {
    key: 'cash_adjustment', labelKey: 'entry.addCash', hasKarat: false, contactKey: null,
    iconClass: 'entry-launcher-icon-cash',
    icon: <><circle cx="12" cy="12" r="9" /><path d="M12 8v8M8.5 10a2 2 0 0 1 2-2h1a2 2 0 1 1 0 4h-2a2 2 0 1 0 0 4h1a2 2 0 0 0 2-2" /></>,
  },
];

// Entry types that record who handled the deal (Sale + both Purchase types)
// Accent colour + short-description key per launcher card
const CAT_META = {
  sale:             { color: '#2A7A5A', descKey: 'entry.d.sale' },
  purchase_jewelry: { color: '#C04840', descKey: 'entry.d.purchase_jewelry' },
  purchase_scrap:   { color: '#B8901F', descKey: 'entry.d.purchase_scrap' },
  supplier_payment: { color: '#1D5C8C', descKey: 'entry.d.supplier_payment' },
  expense:          { color: '#A8503A', descKey: 'entry.d.expense' },
  cash_adjustment:  { color: '#2F8F83', descKey: 'entry.d.cash_adjustment' },
};

const SALESMAN_CATEGORIES = ['sale', 'purchase_jewelry', 'purchase_scrap'];

const KARATS = [
  { key: '21k', label: '21K' },
  { key: '18k', label: '18K' },
  { key: '24k', label: '24K' },
  { key: 'silver', labelKey: 'common.silver' },
];

const emptyKaratState = () => ({
  weight_21k: '', amount_21k: '',
  weight_18k: '', amount_18k: '',
  weight_24k: '', amount_24k: '',
  weight_silver: '', amount_silver: '',
});

export default function Entry() {
  const navigate = useNavigate();
  const { id } = useParams();
  const { user, can } = useAuth();
  const { t, tf, lang } = useLanguage();
  const isEdit = Boolean(id);

  const [category, setCategory] = useState(null);
  const [contacts, setContacts] = useState([]);
  const [salesmen, setSalesmen] = useState([]);
  const [salesmanId, setSalesmanId] = useState('');
  // Salesman already saved on the invoice being edited — kept as a dropdown
  // option even if that name was removed from the active list since.
  const [savedSalesman, setSavedSalesman] = useState(null);
  const [closedDates, setClosedDates] = useState(new Set());
  const [showLargeConfirm, setShowLargeConfirm] = useState(false);
  const LARGE_AMOUNT_THRESHOLD = 50000;
  const [invoiceNo, setInvoiceNo] = useState('');
  const [date, setDate] = useState(() => todayLocalStr());
  const [contactId, setContactId] = useState('');
  const [description, setDescription] = useState('');
  const [paymentSource, setPaymentSource] = useState('main');
  const [attachment, setAttachment] = useState(null); // { dataUrl, name } | null
  const [showAttachmentPreview, setShowAttachmentPreview] = useState(false);
  const [karat, setKarat] = useState(emptyKaratState());
  const [cash, setCash] = useState('');
  const [card, setCard] = useState('');
  const [editNote, setEditNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [loadingExisting, setLoadingExisting] = useState(isEdit);
  const [error, setError] = useState('');
  const [errors, setErrors] = useState([]);
  const [fieldErrors, setFieldErrors] = useState({});
  const [dupWarning, setDupWarning] = useState('');

  function clearFieldError(name) {
    setFieldErrors(prev => (prev[name] ? { ...prev, [name]: false } : prev));
  }

  function handleAttachmentPick(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX_ATTACHMENT_BYTES) {
      setErrors([t('entry.attachmentTooLarge')]);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setAttachment({ dataUrl: reader.result, name: file.name });
    reader.readAsDataURL(file);
  }

  // /entry/:id (edit mode) previously had NO permission gate at App.jsx's
  // route level — a cashier could navigate straight to the URL and see the
  // edit form, even though the backend would ultimately reject the save.
  // Redirecting here closes that gap at the UI layer too.
  useEffect(() => {
    if (isEdit && !can('invoice.edit')) {
      navigate('/history', { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEdit]);

  useEffect(() => {
    apiGet('/contacts').then(setContacts).catch(() => {});
    apiGet('/salesmen').then(setSalesmen).catch(() => {});
    apiGet('/reconciliations').then(rows => {
      setClosedDates(new Set((rows || []).map(r => r.reconciliation_date)));
    }).catch(() => {});
  }, []);

  // Clicking "New Entry" in the sidebar while already mid-category-form
  // used to do nothing (React Router doesn't remount on a same-path nav).
  // Layout.jsx dispatches this event on that click; only act on it when
  // we're not in edit mode (editing an existing invoice shouldn't be
  // interrupted by an unrelated sidebar click elsewhere).
  useEffect(() => {
    function onReset() {
      if (!isEdit) { setCategory(null); resetForm(); }
    }
    window.addEventListener('sg:reset-entry', onReset);
    return () => window.removeEventListener('sg:reset-entry', onReset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEdit]);

  // Edit mode: load the existing invoice and prefill everything.
  useEffect(() => {
    if (!isEdit) return;
    apiGet(`/invoices/${id}`).then(inv => {
      setCategory(inv.category);
      setInvoiceNo(inv.invoice_no);
      setDate(inv.invoice_date);
      setContactId(inv.contact_id || '');
      setSalesmanId(inv.salesman_id ? String(inv.salesman_id) : '');
      setSavedSalesman(inv.salesman_id && inv.salesman_name ? { id: inv.salesman_id, name: inv.salesman_name } : null);
      setDescription(inv.description || '');
      setPaymentSource(inv.payment_source || 'main');
      setAttachment(inv.attachment_data ? { dataUrl: inv.attachment_data, name: inv.attachment_name || 'attachment' } : null);
      setKarat({
        weight_21k: inv.weight_21k || '', amount_21k: inv.amount_21k || '',
        weight_18k: inv.weight_18k || '', amount_18k: inv.amount_18k || '',
        weight_24k: inv.weight_24k || '', amount_24k: inv.amount_24k || '',
        weight_silver: inv.weight_silver || '', amount_silver: inv.amount_silver || '',
      });
      setCash(inv.cash_amount || '');
      setCard(inv.card_amount || '');
    }).catch(err => setError(err.message))
      .finally(() => setLoadingExisting(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const cat = CATEGORIES.find(c => c.key === category);

  const karatTotal = KARATS.reduce((sum, k) => sum + (Number(karat[`amount_${k.key}`]) || 0), 0);
  const totalWeightEntered = KARATS.reduce((sum, k) => sum + (Number(karat[`weight_${k.key}`]) || 0), 0);
  const total = (['purchase_scrap', 'purchase_jewelry', 'supplier_payment'].includes(category) && karatTotal <= 0)
    ? (Number(cash) || 0) + (Number(card) || 0)
    : cat?.hasKarat ? karatTotal : (Number(cash) || 0) + (Number(card) || 0);
  // Live split feedback — lets the cashier see a mismatch WHILE typing
  // instead of only discovering it after clicking Save.
  const allocated = (Number(cash) || 0) + (Number(card) || 0);
  const splitRemaining = karatTotal - allocated;

  // Live 24K-equivalent conversion note, matching the original's convNote —
  // helps at a glance compare mixed-purity entries on a common scale.
  // 24K is bullion's own purity, so it's the natural common unit (no
  // conversion needed for the 24K leg itself).
  const toK24 = (w, k) => w * (k / 24);
  const conv21 = cat?.hasKarat
    ? toK24(Number(karat.weight_21k) || 0, 21)
      + toK24(Number(karat.weight_18k) || 0, 18)
      + (Number(karat.weight_24k) || 0)
    : 0;

  function resetForm() {
    setInvoiceNo(''); setDate(todayLocalStr());
    setContactId(''); setSalesmanId(''); setDescription(''); setPaymentSource('main'); setKarat(emptyKaratState());
    setCash(''); setCard(''); setError(''); setErrors([]); setFieldErrors({});
    setAttachment(null);
  }

  // Launcher stats: today's non-cancelled invoices per category (count + total)
  const [todayStats, setTodayStats] = useState(null);
  useEffect(() => {
    if (isEdit || category) return;
    let alive = true;
    apiGet(`/invoices?invoice_date=${todayLocalStr()}&limit=500`).then(res => {
      if (!alive) return;
      const list = Array.isArray(res) ? res : res?.items || [];
      const acc = {};
      list.filter(e => e.status !== 'canceled').forEach(e => {
        const a = acc[e.category] || (acc[e.category] = { n: 0, total: 0 });
        a.n += 1; a.total += Number(e.total_amount || 0);
      });
      setTodayStats(acc);
    }).catch(() => { if (alive) setTodayStats({}); });
    return () => { alive = false; };
  }, [isEdit, category]);

  // Keys 1-6 jump straight to a category from the launcher
  useEffect(() => {
    if (isEdit || category) return;
    function onKey(e) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const tag = (e.target?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target?.isContentEditable) return;
      const i = '123456'.indexOf(e.key);
      if (e.key.length === 1 && i >= 0 && CATEGORIES[i]) openCategory(CATEGORIES[i].key);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEdit, category]);

  async function openCategory(key) {
    setCategory(key);
    resetForm();
    try {
      const suggestion = await apiGet(`/invoices/next-number?category=${key}`);
      if (suggestion?.invoice_no) setInvoiceNo(suggestion.invoice_no);
    } catch (_) {
      // silent — suggestion is a convenience, not required
    }
  }

  async function checkDuplicate() {
    if (!invoiceNo.trim() || !category) { setDupWarning(''); return; }
    try {
      const matches = await apiGet(`/invoices?search=${encodeURIComponent(invoiceNo.trim())}&category=${category}&limit=10`);
      const list = Array.isArray(matches) ? matches : matches?.items || [];
      const dup = list.find(m => m.invoice_no === invoiceNo.trim() && String(m.id) !== String(id));
      setDupWarning(dup ? `⚠ Invoice #${invoiceNo.trim()} already exists for this category (created ${dup.invoice_date})` : '');
    } catch (_) {
      // silent — this is just a helpful heads-up, not a hard validation
    }
  }

  function quickSplit(mode) {
    if (mode === 'cash') { setCash(total); setCard(0); }
    else if (mode === 'card') { setCash(0); setCard(total); }
    else if (mode === 'half') { setCash((total / 2).toFixed(2)); setCard((total / 2).toFixed(2)); }
    else { setCash(''); setCard(''); }
  }

  async function saveEntry(e, skipLargeCheck = false) {
    e?.preventDefault();
    setError('');
    setErrors([]);
    setFieldErrors({});

    // Never actually block on a missing invoice number — it's auto-filled
    // when the category is opened, but if it somehow ended up blank (user
    // cleared it, or the initial suggestion failed), fetch one now instead
    // of making the cashier type one by hand.
    let finalInvoiceNo = invoiceNo.trim();
    if (!finalInvoiceNo) {
      try {
        const suggestion = await apiGet(`/invoices/next-number?category=${category}`);
        finalInvoiceNo = suggestion?.invoice_no || String(Date.now()).slice(-8);
      } catch (_) {
        finalInvoiceNo = String(Date.now()).slice(-8);
      }
      setInvoiceNo(finalInvoiceNo);
    }

    // ── Mandatory-field validation ───────────────────────────────────
    // The old check only looked at invoiceNo — a form could be saved with
    // every amount at 0 (cash+card both blank, or a weight typed with no
    // rate) because 0 == 0 "matched". These checks close that hole and
    // paint the offending fields red instead of silently accepting it.
    const newErrors = [];
    const newFieldErrors = {};

    // invoiceNo is auto-suggested and never actually required from the
    // cashier's side — if it's somehow empty, handleSubmit fills it in
    // right before saving instead of blocking the form here.
    if (!date) { newErrors.push(t('val.datereq')); newFieldErrors.date = true; }
    else if (date > todayLocalStr()) {
      newErrors.push(t('val.futureDate'));
      newFieldErrors.date = true;
    }
    else if (closedDates.has(date)) {
      newErrors.push(t('val.dayClosed'));
      newFieldErrors.date = true;
    }
    if (isEdit && user?.role === 'supervisor' && !editNote.trim()) {
      newErrors.push(t('val.editnotereq'));
      newFieldErrors.editNote = true;
    }

    if (cat?.hasKarat) {
      const allowsGoldWithoutAmount = ['purchase_scrap', 'purchase_jewelry', 'supplier_payment'].includes(category);
      const hasSomeGold = allowsGoldWithoutAmount && (totalWeightEntered > 0 || karatTotal > 0);
      const skipGoldRequirement = allowsGoldWithoutAmount && !hasSomeGold; // pure-cash entry, no gold at all
      if (karatTotal <= 0 && totalWeightEntered <= 0 && !allowsGoldWithoutAmount) {
        newErrors.push(t('val.noamount'));
        KARATS.forEach(k => { newFieldErrors[`amount_${k.key}`] = true; });
      } else if (!skipGoldRequirement) {
        KARATS.forEach(k => {
          const w = Number(karat[`weight_${k.key}`]) || 0;
          const a = Number(karat[`amount_${k.key}`]) || 0;
          // For these categories, weight without an amount is valid on its
          // own (gold given/received without assigning a SAR value at
          // entry time) — only flag amount-without-weight as a mismatch.
          if (w > 0 && a <= 0 && !allowsGoldWithoutAmount) { newFieldErrors[`amount_${k.key}`] = true; }
          if (a > 0 && w <= 0) { newFieldErrors[`weight_${k.key}`] = true; }
        });
        if (KARATS.some(k => newFieldErrors[`amount_${k.key}`] || newFieldErrors[`weight_${k.key}`])) {
          newErrors.push(t('val.pairmismatch'));
        }
        const allocated = (Number(cash) || 0) + (Number(card) || 0);
        const skipMatchCheck = allowsGoldWithoutAmount && (allocated <= 0 || karatTotal <= 0);
        if (!skipMatchCheck && Math.abs(karatTotal - allocated) >= 0.01) {
          newErrors.push(tf('val.splitmismatch', { alloc: allocated.toLocaleString(), total: karatTotal.toLocaleString() }));
          newFieldErrors.cash = true; newFieldErrors.card = true;
        }
      }
      if (allowsGoldWithoutAmount && totalWeightEntered <= 0 && (Number(cash) || 0) + (Number(card) || 0) <= 0) {
        newErrors.push(t('val.nopay'));
        newFieldErrors.cash = true; newFieldErrors.card = true;
      }
      if (category === 'supplier_payment') {
        if (!description.trim()) {
          newErrors.push(t('val.descreq'));
          newFieldErrors.description = true;
        } else if (description.trim().length < 5) {
          newErrors.push(t('val.descTooShort'));
          newFieldErrors.description = true;
        }
      }
    } else {
      if ((Number(cash) || 0) + (Number(card) || 0) <= 0) {
        newErrors.push(t('val.nopay'));
        newFieldErrors.cash = true; newFieldErrors.card = true;
      }
      if (!description.trim()) {
        newErrors.push(t('val.descreq'));
        newFieldErrors.description = true;
      } else if (description.trim().length < 5) {
        newErrors.push(t('val.descTooShort'));
        newFieldErrors.description = true;
      }
    }

    if (newErrors.length) {
      setErrors(newErrors);
      setFieldErrors(newFieldErrors);
      return;
    }

    // A typo (extra zero) on a big transaction is exactly the kind of
    // mistake that's expensive to catch later — pause once for a human
    // sanity-check before anything this large actually gets saved.
    const totalForCheck = total;
    if (totalForCheck >= LARGE_AMOUNT_THRESHOLD && !skipLargeCheck) {
      setShowLargeConfirm(true);
      return;
    }

    setSaving(true);
    try {
      // "Add Cash" with destination=Cash Deposit is really a deposit into
      // that separate account, not a Main-balance cash adjustment.
      const effectiveCategory = (category === 'cash_adjustment' && paymentSource === 'cash_deposit')
        ? 'cash_deposit' : category;
      const payload = {
        invoice_no: finalInvoiceNo,
        invoice_date: date,
        category: effectiveCategory,
        contact_id: contactId ? Number(contactId) : null,
        salesman_id: SALESMAN_CATEGORIES.includes(category) && salesmanId ? Number(salesmanId) : null,
        weight_21k: Number(karat.weight_21k) || 0,
        weight_18k: Number(karat.weight_18k) || 0,
        weight_24k: Number(karat.weight_24k) || 0,
        weight_silver: Number(karat.weight_silver) || 0,
        amount_21k: Number(karat.amount_21k) || 0,
        amount_18k: Number(karat.amount_18k) || 0,
        amount_24k: Number(karat.amount_24k) || 0,
        amount_silver: Number(karat.amount_silver) || 0,
        cash_amount: Number(cash) || 0,
        card_amount: Number(card) || 0,
        total_amount: total,
        description: description || null,
        attachment_data: attachment?.dataUrl || null,
        attachment_name: attachment?.name || null,
        payment_source: category === 'expense' ? paymentSource : 'main',
      };
      if (isEdit) {
        payload.note = editNote.trim();
        await apiPut(`/invoices/${id}`, payload);
      } else {
        await apiPost('/invoices', payload);
      }
      // Brief "Saved!" confirmation beat before navigating — makes the save
      // feel immediate and deliberate rather than an abrupt page jump.
      setJustSaved(true);
      setSaving(false);
      setTimeout(() => {
        navigate('/history', { state: { flashInvoice: finalInvoiceNo } });
      }, 420);
      return;
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (loadingExisting) return <div className="page-subtitle">{t('entry.loadingInvoice')}</div>;

  if (!category) {
    return (
      <section className="view active">
        <div className="topbar">
          <div>
            <div className="page-title">{t('entry.title')}</div>
            <div className="page-subtitle">
              <Typewriter
                text={
                  lang === 'ar'
                    ? ['سجل عملية بيع أو شراء أو دفعة أو مصروف', 'اختر فئة أدناه للبدء', 'كل إدخال يُحدث دفتر اليوم فوراً']
                    : ['Record a sale, purchase, payment or expense', 'Pick a category below to get started', 'Every entry updates the day ledger instantly']
                }
                speed={40}
                waitTime={2200}
                deleteSpeed={18}
              />
            </div>
          </div>
        </div>
        <div className="entry-bento">
          {CATEGORIES.map((c, i) => {
            const meta = CAT_META[c.key];
            const st = todayStats?.[c.key];
            return (
              <div
                key={c.key}
                className="entry-bento-card"
                style={{ '--c': meta.color, animationDelay: `${i * 50}ms` }}
                role="button"
                tabIndex={0}
                onClick={() => openCategory(c.key)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openCategory(c.key); } }}
              >
                <span className="entry-bento-key">{i + 1}</span>
                <div className="entry-bento-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{c.icon}</svg>
                </div>
                <div className="entry-bento-title">{t(c.labelKey)}</div>
                <div className="entry-bento-desc">{t(meta.descKey)}</div>
                <div className="entry-bento-stat">
                  <span className="entry-bento-count">
                    {todayStats == null ? '\u00A0' : tf('entry.statCount', { n: st?.n || 0 })}
                  </span>
                  <span className="entry-bento-total">
                    {todayStats == null ? '' : <><IconSaudiRiyal size={13} /> {(st?.total || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}</>}
                  </span>
                </div>
                <i className="ri-arrow-left-line entry-bento-arrow" aria-hidden="true" />
              </div>
            );
          })}
        </div>
      </section>
    );
  }

  return (
    <section className="view active">
      <div className="topbar">
        <div>
          <div className="page-title">{isEdit ? t('entry.editTitle') : t('entry.title')}</div>
          <div className="page-subtitle">{t(cat.labelKey)}</div>
        </div>
      </div>
      {!isEdit && (
        <div className="entry-breadcrumb">
          <span onClick={() => setCategory(null)} style={{ cursor: 'pointer' }}>← {t('entry.title')}</span>
          <span className="entry-breadcrumb-sep"> / </span>
          <span>{t(cat.labelKey)}</span>
        </div>
      )}

      <form className="panel entry-form-panel" onSubmit={saveEntry}>
        {errors.length > 0 && (
          <div className="form-error-summary">
            <div className="alert warn" style={{ padding: 10, borderRadius: 8 }}>
              <span className="alert-icon">⚠</span>
              <div>{errors.map((msg, i) => <div key={i}>• {msg}</div>)}</div>
            </div>
          </div>
        )}
        {isEdit && (
          <div className="form-field" style={{ marginBottom: 18 }}>
            <label className={user?.role === 'supervisor' ? 'req' : ''}>{t('entry.editNote')} {user?.role === 'supervisor' && '(required)'}</label>
            <input
              className={fieldErrors.editNote ? 'input-error' : ''}
              value={editNote}
              onChange={e => { setEditNote(e.target.value); clearFieldError('editNote'); }}
              placeholder={t('entry.editNotePlaceholder')}
            />
          </div>
        )}

        <div className="form-grid" style={{ marginBottom: 18 }}>
          <div className="form-field">
            <label>{t('entry.invoiceNo')}</label>
            <input
              className={fieldErrors.invoiceNo ? 'input-error' : ''}
              value={invoiceNo}
              onChange={e => { setInvoiceNo(e.target.value); clearFieldError('invoiceNo'); }}
              onBlur={checkDuplicate}
              placeholder={t('entry.invoiceNoPlaceholder')}
            />
          </div>
          <div className="form-field">
            <label className="req">{t('common.date')}</label>
            <DateField
              className={fieldErrors.date ? 'input-error' : ''}
              value={date}
              onChange={e => { setDate(e.target.value); clearFieldError('date'); }}
              disabled={user?.role === 'cashier'}
            />
            {user?.role === 'cashier' && (
              <div style={{ fontSize: 12, color: 'var(--cream-faint)', marginTop: 4 }}>{t('entry.dateLockedCashier')}</div>
            )}
          </div>
        </div>

        {dupWarning && (
          <div className="alert warn" style={{ padding: 10, borderRadius: 8, marginBottom: 18 }}>{dupWarning}</div>
        )}

        {cat.contactKey && (
          <div className="form-field" style={{ marginBottom: 18 }}>
            <label>{t(cat.contactKey)}</label>
            <select value={contactId} onChange={e => setContactId(e.target.value)}>
              <option value="">— {t('entry.noContactLinked')} —</option>
              {contacts.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        )}

        {SALESMAN_CATEGORIES.includes(category) && (
          <SalesmanSelect
            value={salesmanId}
            onChange={setSalesmanId}
            salesmen={savedSalesman && !salesmen.some(s => s.id === savedSalesman.id) ? [...salesmen, savedSalesman] : salesmen}
            onCreated={s => setSalesmen(prev => [...prev, s].sort((a, b) => a.name.localeCompare(b.name)))}
            canManage={user?.role === 'admin' || user?.role === 'supervisor'}
            onRenamed={u => {
              setSalesmen(prev => prev.map(s => s.id === u.id ? u : s).sort((a, b) => a.name.localeCompare(b.name)));
              setSavedSalesman(prev => (prev && prev.id === u.id ? u : prev));
            }}
            onDeleted={id => {
              setSalesmen(prev => prev.filter(s => s.id !== id));
              setSavedSalesman(prev => (prev && prev.id === id ? null : prev));
            }}
          />
        )}

        {(!cat.hasKarat || category === 'supplier_payment') && (
          <div className="form-field" style={{ marginBottom: 18 }}>
            <label className="req">{t('entry.description')}</label>
            <input
              className={fieldErrors.description ? 'input-error' : ''}
              value={description}
              onChange={e => { setDescription(e.target.value); clearFieldError('description'); }}
              placeholder={t('entry.descPlaceholder')}
            />
          </div>
        )}

        {category === 'expense' && (
          <div className="form-field" style={{ marginBottom: 18 }}>
            <label>{t('entry.payFrom')}</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                className={`btn ${paymentSource === 'main' ? 'gold' : 'ghost'}`}
                style={{ flex: 1 }}
                onClick={() => setPaymentSource('main')}
              >{t('entry.mainBalance')}</button>
              <button
                type="button"
                className={`btn ${paymentSource === 'cash_deposit' ? 'gold' : 'ghost'}`}
                style={{ flex: 1 }}
                onClick={() => setPaymentSource('cash_deposit')}
              >{t('entry.cashDepositBalance')}</button>
            </div>
          </div>
        )}

        {category === 'cash_adjustment' && (
          <div className="form-field" style={{ marginBottom: 18 }}>
            <label>{t('entry.addTo')}</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                className={`btn ${paymentSource === 'main' ? 'gold' : 'ghost'}`}
                style={{ flex: 1 }}
                onClick={() => setPaymentSource('main')}
              >{t('entry.mainBalance')}</button>
              <button
                type="button"
                className={`btn ${paymentSource === 'cash_deposit' ? 'gold' : 'ghost'}`}
                style={{ flex: 1 }}
                onClick={() => setPaymentSource('cash_deposit')}
              >{t('entry.cashDepositBalance')}</button>
            </div>
          </div>
        )}

        {/* Attachment — a photo of the piece, a receipt, a supplier note,
            etc. Available on every category, not just cash-only ones. */}
        <div className="form-field" style={{ marginBottom: 18 }}>
          <label>{t('entry.attachment')}</label>
          {!attachment ? (
            <label className="btn ghost sm attachment-pick-btn">
              <IconPaperclip size={15} />
              {t('entry.attachAdd')}
              <input type="file" accept="image/*,application/pdf" onChange={handleAttachmentPick} style={{ display: 'none' }} />
            </label>
          ) : (
            <div className="attachment-preview">
              {attachment.dataUrl.startsWith('data:image') ? (
                <img
                  src={attachment.dataUrl} alt={attachment.name}
                  className="attachment-lightbox-trigger"
                  onClick={() => setShowAttachmentPreview(true)}
                />
              ) : (
                <div
                  className="attachment-preview-file attachment-lightbox-trigger"
                  onClick={() => setShowAttachmentPreview(true)}
                >
                  <IconPaperclip size={16} /> {attachment.name}
                </div>
              )}
              <button type="button" className="attachment-remove-btn" onClick={() => setAttachment(null)} aria-label={t('entry.attachRemove')}>
                <IconX size={13} />
              </button>
            </div>
          )}
        </div>

        {showAttachmentPreview && attachment && (
          <AttachmentPreview
            src={attachment.dataUrl}
            name={attachment.name}
            onClose={() => setShowAttachmentPreview(false)}
          />
        )}

        {cat.hasKarat && (
          <div className="karat-table-c">
            <div className="karat-table-c-head">
              <span></span>
              <span>{t('entry.weight')}</span>
              <span>{t('entry.amount')}</span>
            </div>
            {KARATS.map(k => {
              const dataKarat = k.key === 'silver' ? 'S' : k.key.replace('k', '');
              const icons = {
                '21': <><circle cx="12" cy="12" r="9" /><path d="M12 7v10M8.5 9.5h5a2 2 0 1 1 0 4h-4a2 2 0 1 0 0 4h5" /></>,
                '18': <><circle cx="12" cy="12" r="9" /><path d="M9 8v8M15 8v8M9 12h6" /></>,
                '24': <><path d="M12 2l2.5 5.5L20 8l-4 4 1 6-5-3-5 3 1-6-4-4 5.5-.5Z" /></>,
                'S': <><circle cx="12" cy="12" r="9" /><path d="M9 9h3.5a2 2 0 1 1 0 4H9m0 0h4a2 2 0 1 1 0 4H9" /></>,
              };
              return (
                <div className="karat-table-c-row" data-karat={dataKarat} key={k.key}>
                  <div className="karat-table-c-label">
                    <div className="karat-table-c-icon">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        {icons[dataKarat]}
                      </svg>
                    </div>
                    <span className="karat-table-c-name">{k.label || t(k.labelKey)}</span>
                  </div>
                  <div className="karat-input-group">
                    <label className="karat-input-mobile-label">{t('entry.weight')}</label>
                    <input
                      type="number" min="0" step="0.001" placeholder="0"
                      className={fieldErrors[`weight_${k.key}`] ? 'input-error' : ''}
                      value={karat[`weight_${k.key}`]}
                      onChange={e => { setKarat(s => ({ ...s, [`weight_${k.key}`]: e.target.value })); clearFieldError(`weight_${k.key}`); }}
                    />
                  </div>
                  <div className="karat-input-group">
                    <label className="karat-input-mobile-label">{t('entry.amount')}</label>
                    <input
                      type="number" min="0" step="0.01" placeholder="0"
                      className={fieldErrors[`amount_${k.key}`] ? 'input-error' : ''}
                      value={karat[`amount_${k.key}`]}
                      onChange={e => { setKarat(s => ({ ...s, [`amount_${k.key}`]: e.target.value })); clearFieldError(`amount_${k.key}`); }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div id="paySplit">
        <div className="form-grid wide">
          <div className="form-field">
            <label>{t('entry.cash')}</label>
            <input
              type="number" min="0" step="0.01" placeholder="0"
              className={fieldErrors.cash ? 'input-error' : ''}
              value={cash}
              onChange={e => {
                const val = e.target.value;
                setCash(val);
                clearFieldError('cash'); clearFieldError('card');
                // Convenience: for karat entries (where the total is already
                // fixed by weight×rate), typing Cash auto-fills Card with
                // whatever's left — the cashier doesn't have to do the
                // subtraction themselves. Still fully editable afterward.
                if (cat?.hasKarat && karatTotal > 0) {
                  const remaining = karatTotal - (Number(val) || 0);
                  setCard(remaining > 0 ? String(Math.round(remaining * 100) / 100) : '0');
                }
              }}
            />
          </div>
          <div className="form-field">
            <label>{t('entry.card')}</label>
            <input
              type="number" min="0" step="0.01" placeholder="0"
              className={fieldErrors.card ? 'input-error' : ''}
              value={card}
              onChange={e => {
                const val = e.target.value;
                setCard(val);
                clearFieldError('card'); clearFieldError('cash');
                if (cat?.hasKarat && karatTotal > 0) {
                  const remaining = karatTotal - (Number(val) || 0);
                  setCash(remaining > 0 ? String(Math.round(remaining * 100) / 100) : '0');
                }
              }}
            />
          </div>
        </div>
        {cat.hasKarat && (
          <div className="pay-quick-actions" >
            <button type="button" className="btn ghost sm" onClick={() => quickSplit('cash')}>{t('entry.allCash')}</button>
            <button type="button" className="btn ghost sm" onClick={() => quickSplit('card')}>{t('entry.allCard')}</button>
            <button type="button" className="btn ghost sm" onClick={() => quickSplit('half')}>{t('entry.split5050')}</button>
            <button type="button" className="btn ghost sm" onClick={() => quickSplit('clear')}>{t('entry.clearSplit')}</button>
          </div>
        )}
        </div>


        {cat.hasKarat && karatTotal > 0 && (allocated > 0 || Math.abs(splitRemaining) >= 0.01) && (
          <div className="alert" style={{
            padding: 10, borderRadius: 8, marginBottom: 16,
            ...(Math.abs(splitRemaining) < 0.01
              ? { background: 'rgba(62,112,85,.12)', color: 'var(--accent-green)', border: '1px solid rgba(62,112,85,.3)' }
              : splitRemaining > 0
                ? { background: 'rgba(201,162,39,.08)', color: 'var(--gold-24)', border: '1px solid rgba(201,162,39,.2)' }
                : { background: 'rgba(181,83,61,.12)', color: 'var(--accent-red)', border: '1px solid rgba(181,83,61,.3)' }),
          }}>
            {Math.abs(splitRemaining) < 0.01
              ? `✓ ${t('split.full')}`
              : splitRemaining > 0
                ? `ℹ ${tf('split.remaining', { amt: splitRemaining.toLocaleString(undefined, { maximumFractionDigits: 2 }) })}`
                : `⚠ ${tf('split.over', { amt: Math.abs(splitRemaining).toLocaleString(undefined, { maximumFractionDigits: 2 }) })}`}
          </div>
        )}

        <div className="form-total">
          <div>
            <div className="form-total-label">{t('entry.totalAmount')}</div>
            <div className="form-total-value">{total.toLocaleString('en-US', { maximumFractionDigits: 2 })}</div>
            {cat?.hasKarat && conv21 > 0 && (
              <div className="form-total-sub">◆ {tf('entry.k21EquivSub', { g: conv21.toFixed(2) })}</div>
            )}
          </div>
        </div>

        {error && <div className="login-err" style={{ display: 'block', marginTop: 12 }}>⚠ {error}</div>}

        <div style={{ display: 'flex', gap: 10, marginTop: 24, flexWrap: 'wrap' }}>
          <button className={`btn gold ${justSaved ? 'btn-saved-pop' : ''}`} type="submit" disabled={saving || justSaved}>
            {justSaved ? `✓ ${t('common.saved')}` : saving ? <><i className="ri-loader-4-line animate-spin" /> {t('common.saving')}</> : (isEdit ? t('entry.update') : t('entry.save'))}
          </button>
          {!isEdit && <button className="btn" type="button" onClick={resetForm}>{t('entry.clearForm')}</button>}
          <button className="btn ghost" type="button" style={{ marginLeft: 'auto' }} onClick={() => navigate('/history')}>{t('common.cancel')}</button>
        </div>
      </form>

      {showLargeConfirm && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(4,6,13,.6)', overflowY: 'auto', padding: '24px 16px' }}
          onClick={e => { if (e.target === e.currentTarget) setShowLargeConfirm(false); }}
        >
          <div className="panel" style={{ width: 420, maxWidth: '92vw', margin: 'auto' }}>
            <div className="panel-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <IconAlertTriangle size={18} style={{ color: 'var(--gold-21)' }} /> {t('val.largeAmountTitle')}
            </div>
            <p style={{ color: 'var(--cream-dim)', fontSize: 14, margin: '12px 0 20px' }}>
              {tf('val.largeAmountBody', { amt: total.toLocaleString() })}
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" className="btn ghost" onClick={() => setShowLargeConfirm(false)}>{t('common.cancel')}</button>
              <button
                type="button" className="btn gold"
                onClick={() => { setShowLargeConfirm(false); saveEntry(null, true); }}
              >
                {t('val.largeAmountConfirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
