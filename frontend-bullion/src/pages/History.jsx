import { useEffect, useMemo, useRef, useState } from 'react';
import { DownloadButton } from '../components/ui/download-animation.tsx';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import { apiGet, apiPost, apiDelete } from '../lib/api';
import { todayLocalStr, toLocalDateStr } from '../lib/dateUtils';
import { useAuth } from '../context/AuthContext.jsx';
import { useLanguage } from '../context/LanguageContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { SkeletonTable } from '../components/Skeleton.jsx';
import CopyableText from '../components/CopyableText.jsx';
import DateField from '../components/DateField.jsx';
import { IconPrinter, IconDownload, IconX, IconAlertTriangle, IconShare, IconSaudiRiyal, IconPaperclip } from '../components/Icons.jsx';
import AttachmentPreview from '../components/AttachmentPreview.jsx';
import InvoiceHoverPreview from '../components/InvoiceHoverPreview.jsx';

// invoice_no and description are free-text fields staff can type anything
// into. printSingleInvoice() below builds an HTML string via document.write
// — without escaping, a value like `<script>...</script>` typed into an
// invoice's description would EXECUTE the next time anyone prints that
// invoice, in a window that shares this app's origin (and so can read
// localStorage, including the auth token). This escapes the five HTML
// metacharacters that matter before any user-typed value is interpolated.
// Remember the last loaded list for this login, so coming back to History shows the
// rows at once (and refreshes quietly) instead of a blank skeleton for 1-2 seconds.
let HIST_CACHE = null; // { token, entries }
const histCacheFor = () => {
  const tok = localStorage.getItem('sg_token');
  return HIST_CACHE && tok && HIST_CACHE.token === tok ? HIST_CACHE.entries : null;
};

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

const CATEGORY_KEYS = {
  sale: 'entry.sale',
  purchase_jewelry: 'entry.purchaseJewelry',
  purchase_scrap: 'entry.purchaseScrap',
  supplier_payment: 'entry.supplierPayment',
  expense: 'entry.expense',
  cash_adjustment: 'entry.addCash',
  cash_deposit: 'entry.cashDepositEntry',
};

// Row/chip colours follow the kind of money movement, so the page can be read by colour alone.
const CAT_COLOR = {
  sale: '#1E8A5C', purchase_jewelry: '#C23B32', purchase_scrap: '#C23B32', supplier_payment: '#1D5C8C',
  expense: '#B0592F', cash_adjustment: '#2F8F83', cash_deposit: '#6B5BC0',
};
// Direction of the movement from the till's point of view (only shown when the amount is non-zero).
const CAT_SIGN = { sale: '+', cash_adjustment: '+', purchase_jewelry: '−', purchase_scrap: '−', supplier_payment: '−', expense: '−' };
const catInk = (c) => `color-mix(in srgb, ${CAT_COLOR[c] || '#7b84a3'} 82%, var(--heading-text))`;

export default function History() {
  const { showToast } = useToast();
  const { user } = useAuth();
  const { t, tf, lang } = useLanguage();
  const catLabel = (cat) => t(CATEGORY_KEYS[cat]) || cat;
  const location = useLocation();
  const navigate = useNavigate();
  const [flashInvoice, setFlashInvoice] = useState(location.state?.flashInvoice || null);
  const [detailEntry, setDetailEntry] = useState(null);
  const [justCreatedNo, setJustCreatedNo] = useState(location.state?.flashInvoice || null);
  const [previewAttachment, setPreviewAttachment] = useState(null);
  const [pendingCancel, setPendingCancel] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);

  // Hover preview: shows after the mouse rests on a row for a moment; mouse only (no touch), hidden while a modal is open.
  const [hover, setHover] = useState(null);
  const hoverTimer = useRef(null);
  const canHover = typeof window !== 'undefined' && window.matchMedia?.('(hover: hover)').matches;
  const hoverIn = (entry) => (ev) => {
    if (!canHover) return;
    clearTimeout(hoverTimer.current);
    const r = ev.currentTarget.getBoundingClientRect();
    const a = { x: ev.clientX, rowTop: r.top, rowBottom: r.bottom };
    hoverTimer.current = setTimeout(() => setHover({ entry, anchor: a }), 350);
  };
  const hoverOut = () => { clearTimeout(hoverTimer.current); setHover(null); };
  useEffect(() => () => clearTimeout(hoverTimer.current), []);

  // Lock the page's own scroll while any modal is open — without this, the
  // background table can still scroll (or the browser auto-scrolls to bring
  // the clicked button into view) at the same time the modal is trying to
  // center itself, which reads as the whole page jumping up and down.
  useEffect(() => {
    const anyModalOpen = detailEntry || pendingCancel || pendingDelete;
    const mainEl = document.querySelector('.main');
    if (anyModalOpen && mainEl) {
      const prevOverflow = mainEl.style.overflow;
      mainEl.style.overflow = 'hidden';
      return () => { mainEl.style.overflow = prevOverflow; };
    }
  }, [detailEntry, pendingCancel, pendingDelete]);
  const [deleting, setDeleting] = useState(false);
  const [cancelNote, setCancelNote] = useState('');
  const [cancelError, setCancelError] = useState('');
  const [entries, setEntries] = useState(() => histCacheFor() || []);
  const [loading, setLoading] = useState(() => !histCacheFor());
  const haveRowsRef = useRef(!!histCacheFor());
  const listTopRef = useRef(null);
  const [error, setError] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [category, setCategory] = useState('all');
  const [status, setStatus] = useState('all');
  const [salesman, setSalesman] = useState('all');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('date_desc');
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;
  // Odoo-style "1-20" range box — typing a custom range like "1-5" jumps
  // straight to showing exactly those records, instead of the box being a
  // page NUMBER you jump by whole pages with.
  const [rangeInput, setRangeInput] = useState('');
  const [customRange, setCustomRange] = useState(null);

  // After the first load, refreshes (after an edit, cancel, undo…) happen quietly in the
  // background: the table stays where it is instead of flashing to a skeleton and losing scroll.
  async function load() {
    if (!haveRowsRef.current) setLoading(true);
    setError('');
    try {
      const data = await apiGet('/invoices?limit=2000');
      const list = Array.isArray(data) ? data : data.items || [];
      setEntries(list);
      haveRowsRef.current = true;
      HIST_CACHE = { token: localStorage.getItem('sg_token'), entries: list };
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  // Every filter except the category chip. Used for the filtered list below AND for the per-category
  // counts on the chips, so a chip's number is exactly how many rows you get when you click it.
  const matchBase = (e) => {
    if (from && e.invoice_date < from) return false;
    if (to && e.invoice_date > to) return false;
    if (status !== 'all' && e.status !== status) return false;
    if (salesman !== 'all' && (e.salesman_name || '') !== salesman) return false;
    if (search) {
      const q = search.toLowerCase();
      const hay = [e.invoice_no, e.salesman_name, e.contact_name, e.note];
      if (!hay.some(v => String(v ?? '').toLowerCase().includes(q))) return false;
    }
    return true;
  };

  const salesmen = useMemo(() => [...new Set(entries.map(e => e.salesman_name).filter(Boolean))].sort(), [entries]);

  const catCounts = useMemo(() => {
    const c = { all: 0 };
    entries.forEach(e => {
      if (!matchBase(e)) return;
      c.all += 1;
      c[e.category] = (c[e.category] || 0) + 1;
    });
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, from, to, status, salesman, search]);

  const filtered = useMemo(() => {
    const list = entries.filter(e => {
      if (category !== 'all' && e.category !== category) return false;
      return matchBase(e);
    });
    const sorted = [...list];
    switch (sort) {
      case 'date_asc': sorted.sort((a, b) => a.invoice_date.localeCompare(b.invoice_date)); break;
      case 'amount_desc': sorted.sort((a, b) => Number(b.total_amount) - Number(a.total_amount)); break;
      case 'amount_asc': sorted.sort((a, b) => Number(a.total_amount) - Number(b.total_amount)); break;
      case 'inv_desc': sorted.sort((a, b) => String(b.invoice_no).localeCompare(String(a.invoice_no), undefined, { numeric: true })); break;
      case 'inv_asc': sorted.sort((a, b) => String(a.invoice_no).localeCompare(String(b.invoice_no), undefined, { numeric: true })); break;
      default: sorted.sort((a, b) => b.invoice_date.localeCompare(a.invoice_date)); // date_desc
    }
    return sorted;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, from, to, category, status, salesman, search, sort]);

  // Any filter/sort change snaps back to page 1, and pagination keeps a
  // heavy invoice history from rendering hundreds of rows into one page.
  useEffect(() => { setPage(1); setCustomRange(null); }, [from, to, category, status, salesman, search, sort]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(Math.max(1, page), totalPages);
  // customRange (e.g. {start:1, end:5} from typing "1-5") takes priority
  // over the page-based slice below — Prev/Next clear it and fall back to
  // normal whole-page navigation.
  const rangeStart = customRange ? customRange.start : (safePage - 1) * PAGE_SIZE + 1;
  const rangeEnd = customRange ? Math.min(customRange.end, filtered.length) : Math.min(safePage * PAGE_SIZE, filtered.length);
  const pageItems = useMemo(
    () => filtered.slice(rangeStart - 1, rangeEnd),
    [filtered, rangeStart, rangeEnd]
  );

  // After saving an entry, make it impossible to miss: if the current
  // filters/sort hide it, clear them once; then jump to whichever page it
  // actually lands on and flash its row gold for a couple of seconds.
  useEffect(() => {
    if (!flashInvoice || loading) return;
    const idx = filtered.findIndex(e => String(e.invoice_no) === String(flashInvoice));
    if (idx === -1) {
      // Not visible under the current filters — clear them once and retry.
      if (from || to || category !== 'all' || status !== 'all' || salesman !== 'all' || search) {
        setFrom(''); setTo(''); setCategory('all'); setStatus('all'); setSalesman('all'); setSearch('');
        return;
      }
      // Genuinely not found (e.g. failed silently) — give up quietly.
      setFlashInvoice(null);
      navigate(location.pathname, { replace: true, state: {} });
      return;
    }
    const targetPage = Math.floor(idx / PAGE_SIZE) + 1;
    if (targetPage !== safePage) { setPage(targetPage); return; }
    const row = document.getElementById(`hist-row-${filtered[idx].id}`);
    if (row) {
      row.classList.add('row-flash');
      row.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => row.classList.remove('row-flash'), 2600);
    }
    // Auto-open the preview/detail modal for the invoice that was just
    // created, instead of just flashing its row — so the user sees a full
    // confirmation of everything they just entered without an extra click.
    setDetailEntry(filtered[idx]);
    setFlashInvoice(null);
    navigate(location.pathname, { replace: true, state: {} });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flashInvoice, filtered, safePage, loading]);

  const totals = filtered.reduce((acc, e) => {
    if (e.status !== 'canceled') acc.total += Number(e.total_amount) || 0;
    return acc;
  }, { total: 0 });

  // Column sums shown in the table's own footer row — weight/amount per
  // karat, 21K-equivalent, total, cash, card — all respecting whatever
  // filters are currently active, so it always matches what's on screen.
  const footerSums = useMemo(() => {
    const s = { w21: 0, w18: 0, w24: 0, wSilver: 0, conv: 0, total: 0, cash: 0, card: 0 };
    filtered.forEach(e => {
      if (e.status === 'canceled') return;
      s.w21 += Number(e.weight_21k) || 0;
      s.w18 += Number(e.weight_18k) || 0;
      s.w24 += Number(e.weight_24k) || 0;
      s.wSilver += Number(e.weight_silver) || 0;
      s.conv += calcConv(e);
      s.total += Number(e.total_amount) || 0;
      s.cash += Number(e.cash_amount) || 0;
      s.card += Number(e.card_amount) || 0;
    });
    return s;
  }, [filtered]);

  // KPI cards — straight sums of the rows currently matching the filters, cancelled invoices excluded.
  const kpis = useMemo(() => {
    const k = { sales: { n: 0, amt: 0, gold: 0 }, purch: { n: 0, amt: 0, gold: 0 } };
    filtered.forEach(e => {
      if (e.status === 'canceled') return;
      const amt = Number(e.total_amount) || 0;
      if (e.category === 'sale') { k.sales.n += 1; k.sales.amt += amt; k.sales.gold += calcConv(e); }
      else if (e.category === 'purchase_jewelry' || e.category === 'purchase_scrap') { k.purch.n += 1; k.purch.amt += amt; k.purch.gold += calcConv(e); }
    });
    return k;
  }, [filtered]);

  const todayStr = todayLocalStr();
  const dAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return toLocalDateStr(d); };
  const quickRanges = [
    { k: 'today', label: t('hist2.today'), f: todayStr, to: todayStr },
    { k: '7', label: t('hist2.7d'), f: dAgo(6), to: todayStr },
    { k: 'm', label: t('hist2.month'), f: todayStr.slice(0, 8) + '01', to: todayStr },
    { k: 'all', label: t('hist2.allTime'), f: '', to: '' },
  ];
  const anyFilter = from || to || category !== 'all' || status !== 'all' || salesman !== 'all' || search;
  const clearFilters = () => { setFrom(''); setTo(''); setCategory('all'); setStatus('all'); setSalesman('all'); setSearch(''); setSort('date_desc'); };
  const fmtN = (n) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });

  async function cancelEntry(id) {
    if (!cancelNote.trim()) {
      setCancelError(t('hist.cancelReasonRequired'));
      return;
    }
    if (cancelNote.trim().length < 5) {
      setCancelError(t('val.descTooShort'));
      return;
    }
    try {
      const invoiceNo = pendingCancel?.invoice_no;
      await apiPost(`/invoices/${id}/cancel`, { note: cancelNote.trim() });
      setPendingCancel(null);
      setCancelNote('');
      setCancelError('');
      showToast(tf('hist.invoiceCanceledToast', { no: invoiceNo }), 'success', {
        action: {
          label: t('common.undo'),
          onClick: async () => {
            try {
              await apiPost(`/invoices/${id}/reactivate`, {});
              showToast(tf('hist.invoiceRestoredToast', { no: invoiceNo }), 'success');
              load();
            } catch (err) {
              showToast(err.message, 'error');
            }
          },
        },
      });
      load();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function deleteEntry(id) {
    setDeleting(true);
    try {
      const invoiceNo = pendingDelete?.invoice_no;
      await apiDelete(`/invoices/${id}`);
      setPendingDelete(null);
      showToast(tf('hist.invoiceDeletedToast', { no: invoiceNo }), 'success');
      load();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setDeleting(false);
    }
  }

  function exportExcel() {
    const rows = filtered.map(e => ({
      [t('common.category')]: catLabel(e.category),
      [t('common.invoice')]: e.invoice_no,
      [t('common.date')]: e.invoice_date,
      '21K (g)': e.weight_21k, '21K (SAR)': e.amount_21k,
      '18K (g)': e.weight_18k, '18K (SAR)': e.amount_18k,
      '24K (g)': e.weight_24k, '24K (SAR)': e.amount_24k,
      [`${t('common.silver')} (g)`]: e.weight_silver, [`${t('common.silver')} (SAR)`]: e.amount_silver,
      [t('common.total')]: e.total_amount, [t('entry.cash')]: e.cash_amount, [t('entry.card')]: e.card_amount,
      [t('common.status')]: e.status === 'canceled' ? t('opt.canceled') : t('opt.active'), [t('entry.customer')]: e.contact_name || '',
      [t('hist.salesman')]: e.salesman_name || '',
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'History');
    XLSX.writeFile(wb, `swag-gold-history-${todayLocalStr()}.xlsx`);
  }

  function exportPDF() {
    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
    doc.setFont('helvetica', 'bold'); doc.setFontSize(16);
    doc.text('Swag Gold — History', 30, 30);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(110);
    doc.text(`${filtered.length} invoices · Total ${totals.total.toLocaleString('en-US', { maximumFractionDigits: 2 })} SAR · Exported ${new Date().toLocaleString()}`, 30, 46);

    const headers = ['Category', 'Invoice', 'Date', 'Total', 'Cash', 'Card', 'Status'];
    const colX = [30, 170, 240, 310, 380, 440, 500];
    let y = 70;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(30);
    headers.forEach((h, i) => doc.text(h, colX[i], y));
    y += 6;
    doc.setDrawColor(200); doc.line(30, y, 780, y); y += 14;

    doc.setFont('helvetica', 'normal');
    filtered.forEach(e => {
      if (y > 560) { doc.addPage(); y = 40; }
      const row = [
        catLabel(e.category),
        String(e.invoice_no),
        e.invoice_date,
        Number(e.total_amount || 0).toLocaleString(),
        Number(e.cash_amount || 0).toLocaleString(),
        Number(e.card_amount || 0).toLocaleString(),
        e.status,
      ];
      row.forEach((val, i) => doc.text(String(val), colX[i], y));
      y += 16;
    });

    doc.save(`swag-gold-history-${todayLocalStr()}.pdf`);
  }

  function toK24(w, k) { return w * (k / 24); }
  function calcConv(e) {
    return toK24(Number(e.weight_21k) || 0, 21)
      + toK24(Number(e.weight_18k) || 0, 18)
      + (Number(e.weight_24k) || 0);
  }

  function shareWhatsApp(e) {
    const conv = calcConv(e);
    const msg = `*Swag Gold — ${catLabel(e.category)}*\n`
      + `${t('common.invoice')}: ${e.invoice_no} | ${t('common.date')}: ${e.invoice_date}\n`
      + `${t('common.status')}: ${e.status === 'canceled' ? t('opt.canceled') : t('opt.active')}\n`
      + `${t('common.total')}: SAR ${Number(e.total_amount || 0).toLocaleString()}\n`
      + `${t('entry.cash')}: ${Number(e.cash_amount || 0).toLocaleString()} | ${t('entry.card')}: ${Number(e.card_amount || 0).toLocaleString()}\n`
      + (conv > 0 ? `${t('hist.k21equiv')}: ${conv.toFixed(2)}g\n` : '');
    window.open('https://wa.me/?text=' + encodeURIComponent(msg), '_blank');
  }

  function printSingleInvoice(e) {
    const conv = calcConv(e);
    const isRtl = lang === 'ar';
    const SVG_RIYAL = '<svg viewBox="0 0 1256 1256" width="12" height="12" fill="currentColor" style="display:inline-block;vertical-align:-1px"><path d="M0,0M750,1119 C730,1163,716,1211,711,1262 C711,1262,1136,1172,1136,1172 C1156,1127,1169,1079,1174,1028 C1174,1028,750,1119,750,1119Z M1136,901 C1136,901,1136,901,1136,901 C1156,857,1169,809,1174,758 C1174,758,843,828,843,828 C843,828,843,693,843,693 C843,693,1136,631,1136,631 C1156,587,1169,538,1174,488 C1174,488,843,558,843,558 C843,558,843,72,843,72 C793,100,748,138,711,183 C711,183,711,586,711,586 C711,586,579,614,579,614 C579,614,579,6,579,6 C528,34,483,72,447,117 C447,117,447,642,447,642 C447,642,151,705,151,705 C131,750,117,798,112,849 C112,849,447,777,447,777 C447,777,447,948,447,948 C447,948,88,1024,88,1024 C68,1068,55,1117,50,1167 C50,1167,425,1088,425,1088 C456,1081,482,1063,499,1038 C499,1038,568,936,568,936 C568,936,568,936,568,936 C575,926,579,913,579,899 C579,899,579,749,579,749 C579,749,711,721,711,721 C711,721,711,992,711,992 C711,992,1136,901,1136,901Z"/></svg>';
    const win = window.open('', '_blank', 'width=380,height=680');
    win.document.write(`
      <html dir="${isRtl ? 'rtl' : 'ltr'}"><head><title>${t('common.invoice')} #${escapeHtml(e.invoice_no)}</title>
      <link rel="preconnect" href="https://fonts.googleapis.com">
      <link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700&family=Inter:wght@400;500;700&display=swap" rel="stylesheet">
      <style>
        body{font-family:${isRtl ? "'Tajawal'" : "'Inter'"},monospace;padding:24px;max-width:380px;margin:auto;color:#111;}
        .brand-row{display:flex;align-items:center;gap:10px;margin-bottom:2px;}
        .brand-row img{width:38px;height:38px;object-fit:contain;}
        h2{font-family:serif;margin:0;font-size:20px;}
        .sub{font-size:12px;color:#666;margin-bottom:16px;}
        .row{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #eee;font-size:14px;}
        .row:last-child{font-weight:700;font-size:16px;border-bottom:none;margin-top:6px;}
        hr{border:none;border-top:1px dashed #bbb;margin:10px 0;}
      </style></head><body>
      <div class="brand-row"><img src="${window.location.origin}/logo.png" onerror="this.style.display='none'" /><h2>Swag Gold</h2></div>
      <div class="sub">${catLabel(e.category)}${e.status === 'canceled' ? ' — ' + t('opt.canceled').toUpperCase() : ''}</div>
      <hr>
      <div class="row"><span>${t('common.invoice')}</span><span>${escapeHtml(e.invoice_no)}</span></div>
      <div class="row"><span>${t('common.date')}</span><span>${e.invoice_date}</span></div>
      ${e.salesman_name ? `<div class="row"><span>${t('hist.salesman')}</span><span>${escapeHtml(e.salesman_name)}</span></div>` : ''}
      ${e.description ? `<div class="row"><span>${t('entry.description')}</span><span>${escapeHtml(e.description)}</span></div>` : ''}
      <hr>
      ${e.weight_21k ? `<div class="row"><span>21K</span><span>${e.weight_21k}g — ${SVG_RIYAL} ${Number(e.amount_21k || 0).toLocaleString()}</span></div>` : ''}
      ${e.weight_18k ? `<div class="row"><span>18K</span><span>${e.weight_18k}g — ${SVG_RIYAL} ${Number(e.amount_18k || 0).toLocaleString()}</span></div>` : ''}
      ${e.weight_24k ? `<div class="row"><span>24K</span><span>${e.weight_24k}g — ${SVG_RIYAL} ${Number(e.amount_24k || 0).toLocaleString()}</span></div>` : ''}
      ${e.weight_silver ? `<div class="row"><span>${t('common.silver')}</span><span>${e.weight_silver}g — ${SVG_RIYAL} ${Number(e.amount_silver || 0).toLocaleString()}</span></div>` : ''}
      ${conv > 0 ? `<div class="row"><span>${t('hist.k21equiv')}</span><span>${conv.toFixed(2)}g</span></div>` : ''}
      <hr>
      <div class="row"><span>${t('entry.cash')}</span><span>${SVG_RIYAL} ${Number(e.cash_amount || 0).toLocaleString()}</span></div>
      <div class="row"><span>${t('entry.card')}</span><span>${SVG_RIYAL} ${Number(e.card_amount || 0).toLocaleString()}</span></div>
      <div class="row"><span>${t('common.total')}</span><span>${SVG_RIYAL} ${Number(e.total_amount || 0).toLocaleString()}</span></div>
      </body></html>
    `);
    win.document.close();
    setTimeout(() => win.print(), 200);
  }

  if (loading) return <SkeletonTable rows={8} cols={7} />;

  // Next/Previous at the bottom of the list: bring the top of the new page into view
  // (otherwise the new rows appear while you are still parked at the bottom).
  function toListTop() {
    requestAnimationFrame(() => {
      const el = listTopRef.current;
      if (el && el.getBoundingClientRect().top < 0) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  function PagerBar() {
    if (filtered.length <= PAGE_SIZE) return null;
    return (
      <div className="hist-pager" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button
          className="btn sm" disabled={rangeStart <= 1}
          onClick={() => { setCustomRange(null); setPage(Math.max(1, Math.ceil(rangeStart / PAGE_SIZE) - 1)); toListTop(); }}
        >{t('pg.prev')}</button>

        {/* Odoo-style editable range — click the numbers, type a custom
            range like "1-5", press Enter, and exactly those records
            show, independent of the fixed page size. */}
        <span className="hist-pager-info" style={{ fontSize: 14, color: 'var(--cream-dim)', fontFamily: "'IBM Plex Mono', monospace", display: 'flex', alignItems: 'center', gap: 4 }}>
          <input
            type="text"
            defaultValue={`${rangeStart}-${rangeEnd}`}
            key={`${rangeStart}-${rangeEnd}`}
            style={{ width: 76, padding: '4px 6px', textAlign: 'center', fontSize: 13, fontFamily: "'IBM Plex Mono', monospace" }}
            onKeyDown={e => {
              if (e.key !== 'Enter') return;
              const m = e.target.value.match(/^\s*(\d+)\s*-\s*(\d+)\s*$/);
              if (!m) { e.target.value = `${rangeStart}-${rangeEnd}`; return; }
              let s = Math.max(1, parseInt(m[1], 10));
              let en = Math.min(filtered.length, parseInt(m[2], 10));
              if (en < s) [s, en] = [en, s];
              setCustomRange({ start: s, end: en });
              e.target.blur();
            }}
            onBlur={e => {
              const m = e.target.value.match(/^\s*(\d+)\s*-\s*(\d+)\s*$/);
              if (!m) return;
              let s = Math.max(1, parseInt(m[1], 10));
              let en = Math.min(filtered.length, parseInt(m[2], 10));
              if (en < s) [s, en] = [en, s];
              if (s !== rangeStart || en !== rangeEnd) setCustomRange({ start: s, end: en });
            }}
          />
          {tf('pg.ofTotalRecords', { n: filtered.length })}
        </span>

        <button
          className="btn sm" disabled={rangeEnd >= filtered.length}
          onClick={() => { setCustomRange(null); setPage(Math.floor((rangeEnd) / PAGE_SIZE) + 1); toListTop(); }}
        >{t('pg.next')}</button>
      </div>
    );
  }

  return (
    <section className="view active" id="view-history">
      <div className="topbar">
        <div>
          <div className="page-title">{t('hist.title')}</div>
          <div className="page-subtitle">{t('hist.subtitle')}</div>
        </div>
        <div className="topbar-actions">
          <span className="tw-preflight" style={{ display: 'inline-flex' }}>
            <DownloadButton label={t('hist.pdfExport')} color="#1D5C8C" size={36} width={132} onDownload={() => exportPDF()} />
          </span>
          <span className="tw-preflight" style={{ display: 'inline-flex', marginInlineEnd: 52 }}>
            <DownloadButton label={t('hist.excelExport')} color="#C49A1E" size={36} width={146} onDownload={() => exportExcel()} />
          </span>
        </div>
      </div>

      <div className="hx-kpis">
        <div className="hx-kpi" style={{ '--c': CAT_COLOR.sale }}>
          <small>{t('hist2.sales')}</small>
          <b className="hx-ltr">{fmtN(kpis.sales.amt)}</b>
          <span>{kpis.sales.n} {t('hist2.invoices')} · <span className="hx-ltr">{kpis.sales.gold.toFixed(2)}g</span></span>
        </div>
        <div className="hx-kpi" style={{ '--c': CAT_COLOR.purchase_jewelry }}>
          <small>{t('hist2.purchases')}</small>
          <b className="hx-ltr">{fmtN(kpis.purch.amt)}</b>
          <span>{kpis.purch.n} {t('hist2.invoices')} · <span className="hx-ltr">{kpis.purch.gold.toFixed(2)}g</span></span>
        </div>
        <div className="hx-kpi" style={{ '--c': '#B8901F' }}>
          <small>{t('hist2.goldSold')}</small>
          <b className="hx-ltr">{kpis.sales.gold.toFixed(2)}g</b>
          <span>{t('hist.k21equiv')}</span>
        </div>
        <div className="hx-kpi" style={{ '--c': '#1D5C8C' }}>
          <small>{t('hist2.goldBought')}</small>
          <b className="hx-ltr">{kpis.purch.gold.toFixed(2)}g</b>
          <span>{t('hist.k21equiv')}</span>
        </div>
      </div>

      <div className="panel hx-panel" ref={listTopRef} style={{ scrollMarginTop: 76 }}>
        <div className="hx-filters">
          <div className="hx-chips">
            <button type="button" className={`hx-chip${category === 'all' ? ' on' : ''}`} style={{ '--c': '#2b3358' }} onClick={() => setCategory('all')}>
              <i />{t('hist2.all')} <em>{catCounts.all || 0}</em>
            </button>
            {Object.keys(CATEGORY_KEYS).map(k => (
              <button key={k} type="button" className={`hx-chip${category === k ? ' on' : ''}`} style={{ '--c': CAT_COLOR[k] }} onClick={() => setCategory(k)}>
                <i />{catLabel(k)} <em>{catCounts[k] || 0}</em>
              </button>
            ))}
          </div>
          <div className="hx-row2">
            <label className="hx-search">
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder={t('hist2.searchPh')} />
            </label>
            <div className="hx-seg">
              {quickRanges.map(q => (
                <button key={q.k} type="button" className={from === q.f && to === q.to ? 'on' : ''} onClick={() => { setFrom(q.f); setTo(q.to); }}>{q.label}</button>
              ))}
            </div>
            <div className="hx-date"><span>{t('hist.fromDate')}</span><DateField value={from} onChange={e => setFrom(e.target.value)} /></div>
            <div className="hx-date"><span>{t('hist.toDate')}</span><DateField value={to} onChange={e => setTo(e.target.value)} /></div>
            <select className="hx-sel" value={status} onChange={e => setStatus(e.target.value)} aria-label={t('common.status')}>
              <option value="all">{t('common.status')}: {t('hist.allStatus')}</option>
              <option value="active">{t('hist.active')}</option>
              <option value="canceled">{t('hist.canceled')}</option>
            </select>
            <select className="hx-sel" value={salesman} onChange={e => setSalesman(e.target.value)} aria-label={t('hist.salesman')}>
              <option value="all">{t('hist.salesman')}: {t('hist.allStatus')}</option>
              {salesmen.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
            <select className="hx-sel" value={sort} onChange={e => setSort(e.target.value)} aria-label={t('hist.sort')}>
              <option value="date_desc">{t('hsort.datedesc')}</option>
              <option value="date_asc">{t('hsort.dateasc')}</option>
              <option value="amount_desc">{t('hsort.amtdesc')}</option>
              <option value="amount_asc">{t('hsort.amtasc')}</option>
              <option value="inv_desc">{t('hsort.invdesc')}</option>
              <option value="inv_asc">{t('hsort.invasc')}</option>
            </select>
            {anyFilter && <button type="button" className="hx-clear" onClick={clearFilters}>{t('hist2.clear')}</button>}
          </div>
        </div>

        {error && <div className="login-err" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><IconAlertTriangle size={14} /> {error}</div>}

        <div className="hist-summary">
          {tf('hist.summaryLine', { n: filtered.length, total: totals.total.toLocaleString('en-US', { maximumFractionDigits: 2 }) })}
        </div>

        <div style={{ marginBottom: 12 }}><PagerBar /></div>

        <div className="hx-wrap">
          <table className="hx-table">
            <thead>
              <tr>
                <th>{t('common.category')}</th>
                <th>{t('common.invoice')}</th>
                <th>{t('hist2.weights')}</th>
                <th>{t('hist2.payment')}</th>
                <th>{t('common.total')} (SAR)</th>
                <th>{t('common.status')}</th>
                <th>{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map(e => {
                const audit = [];
                if (e.validity === 'Edited' && e.updated_by_name) audit.push(`${t('hist.editedBy')} ${e.updated_by_name} — ${e.updated_at ? new Date(e.updated_at).toLocaleString() : ''}`);
                if (e.note) audit.push(e.note);
                const canceled = e.status === 'canceled';
                const total = Number(e.total_amount || 0);
                const chips = [
                  ['21K', e.weight_21k, e.amount_21k, false],
                  ['18K', e.weight_18k, e.amount_18k, false],
                  ['24K', e.weight_24k, e.amount_24k, false],
                  [t('common.silver'), e.weight_silver, e.amount_silver, true],
                ].filter(c => Number(c[1]) > 0);
                const conv = calcConv(e);
                return (
                <tr key={e.id} className={canceled ? 'canceled-row hx-canceled' : ''} style={{ '--c': CAT_COLOR[e.category] || '#7b84a3' }} data-inv={e.invoice_no} id={`hist-row-${e.id}`} onMouseEnter={hoverIn(e)} onMouseLeave={hoverOut}>
                  <td>
                    <span className="hx-cat" style={{ color: catInk(e.category) }}><i />{catLabel(e.category)}</span>
                    {e.category === 'expense' && e.payment_source === 'cash_deposit' && (
                      <span className="hx-sub" style={{ color: 'var(--gold-21)', fontWeight: 600 }}>{t('entry.cashDepositBalance')}</span>
                    )}
                  </td>
                  <td>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <span className="hx-inv" onClick={() => setDetailEntry(e)}>{e.invoice_no}</span>
                      <CopyableText text={e.invoice_no}>{''}</CopyableText>
                    </span>
                    <span className="hx-sub"><span className="hx-ltr">{e.invoice_date}</span>{e.salesman_name ? ` · ${e.salesman_name}` : ''}</span>
                    {audit.length > 0 && (
                      <span className="hx-sub hx-audit" title={audit.join('\n')} onClick={() => setDetailEntry(e)}>{audit.join(' · ')}</span>
                    )}
                  </td>
                  <td>
                    {chips.length === 0 ? <span className="hx-dash">—</span> : (
                      <div className="hx-chipsrow">
                        {chips.map(([k, w, a, silver]) => (
                          <span key={k} className={`hx-wchip${silver ? ' s' : ''}`} title={`${k}: ${w}g / ${a || 0} SAR`}>{silver ? <>{k} <span className="hx-ltr">{w}g</span></> : <span className="hx-ltr">{k} {w}g</span>}</span>
                        ))}
                      </div>
                    )}
                    {conv > 0 && <span className="hx-sub">{t('hist.k21equiv')} <span className="hx-ltr">{conv.toFixed(2)}g</span></span>}
                  </td>
                  <td className="hx-pay">
                    <div><span className="hx-ltr">{e.cash_amount ? Number(e.cash_amount).toLocaleString() : '0'}</span> <em>{t('common.cash')}</em></div>
                    <div><span className="hx-ltr">{e.card_amount ? Number(e.card_amount).toLocaleString() : '0'}</span> <em>{t('common.card')}</em></div>
                  </td>
                  <td className={`hx-total${canceled ? ' can' : ''}`} style={canceled ? undefined : { color: catInk(e.category) }}>
                    <span className="hx-ltr">{total && CAT_SIGN[e.category] ? CAT_SIGN[e.category] : ''}{total.toLocaleString('en-US', { maximumFractionDigits: 2 })}</span>
                  </td>
                  <td>
                    <span className={`tag status-${canceled ? 'canceled' : 'paid'}`}>{canceled ? t('opt.canceled') : t('opt.active')}</span>
                    {e.validity === 'Edited' && <span className="tag valid-edited" style={{ marginInlineStart: 6 }}>{t('opt.edited')}</span>}
                  </td>
                  <td className="hist-actions-cell"><div className="hx-actions">
                    {!canceled && user?.role !== 'cashier' && (
                      <Link className="btn ghost sm" to={`/entry/${e.id}`}>{t('common.edit')}</Link>
                    )}
                    {!canceled && user?.role !== 'cashier' && (
                      <button className="btn ghost sm" onClick={() => setPendingCancel(e)}>{t('common.cancel')}</button>
                    )}
                    {user?.role === 'admin' && (
                      <button className="btn ghost sm hx-del" title={t('hist.deletePermanently')} aria-label={t('hist.deletePermanently')} onClick={() => setPendingDelete(e)}>
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2m-9 0 1 14h8l1-14M10 10v6M14 10v6" /></svg>
                      </button>
                    )}
                  </div></td>
                </tr>
              );})}
              {filtered.length === 0 && (
                <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--cream-faint)' }}>{t('hist.noEntries')}</td></tr>
              )}
            </tbody>
            {filtered.length > 0 && (
              <tfoot>
                <tr className="hist-table-footer">
                  <td colSpan={2} style={{ fontWeight: 700 }}>{t('hist.footerTotal')}</td>
                  <td style={{ fontWeight: 700 }}>
                    <div className="hx-chipsrow">
                      {footerSums.w21 > 0 && <span className="hx-wchip"><span className="hx-ltr">21K {footerSums.w21.toFixed(2)}g</span></span>}
                      {footerSums.w18 > 0 && <span className="hx-wchip"><span className="hx-ltr">18K {footerSums.w18.toFixed(2)}g</span></span>}
                      {footerSums.w24 > 0 && <span className="hx-wchip"><span className="hx-ltr">24K {footerSums.w24.toFixed(2)}g</span></span>}
                      {footerSums.wSilver > 0 && <span className="hx-wchip s">{t('common.silver')} <span className="hx-ltr">{footerSums.wSilver.toFixed(2)}g</span></span>}
                      {!(footerSums.w21 > 0 || footerSums.w18 > 0 || footerSums.w24 > 0 || footerSums.wSilver > 0) && '—'}
                    </div>
                    <span className="hx-sub" style={{ color: 'var(--gold-21)' }}>{t('hist.k21equiv')} <span className="hx-ltr">{footerSums.conv.toFixed(2)}</span></span>
                  </td>
                  <td style={{ fontWeight: 700 }}>
                    <div><span className="hx-ltr">{footerSums.cash.toLocaleString('en-US', { maximumFractionDigits: 2 })}</span> <em>{t('common.cash')}</em></div>
                    <div><span className="hx-ltr">{footerSums.card.toLocaleString('en-US', { maximumFractionDigits: 2 })}</span> <em>{t('common.card')}</em></div>
                  </td>
                  <td style={{ fontWeight: 700, color: 'var(--gold-21)' }}><span className="hx-ltr">{footerSums.total.toLocaleString('en-US', { maximumFractionDigits: 2 })}</span></td>
                  <td colSpan={2}></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        <div style={{ marginTop: 16 }}><PagerBar /></div>
      </div>

      {hover && !detailEntry && !pendingCancel && !pendingDelete && (
        <InvoiceHoverPreview entry={hover.entry} anchor={hover.anchor} t={t} catLabel={catLabel} />
      )}

      {detailEntry && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(4,6,13,.6)', overflowY: 'auto', padding: '24px 16px' }}
          onClick={e => { if (e.target === e.currentTarget) { setDetailEntry(null); setJustCreatedNo(null); } }}
        >
          <div className="panel" style={{ width: 460, maxWidth: '92vw', maxHeight: '84vh', overflowY: 'auto' }}>
            {justCreatedNo && String(justCreatedNo) === String(detailEntry.invoice_no) && (
              <div style={{
                background: 'rgba(45,143,94,.15)', border: '1px solid var(--accent-green)', color: 'var(--accent-green)',
                borderRadius: 8, padding: '8px 12px', marginBottom: 12, fontSize: 13, fontWeight: 600,
                display: 'flex', alignItems: 'center', gap: 6,
              }}>
                ✓ {t('hist.justSaved')}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <div className="panel-title">
                <CopyableText text={detailEntry.invoice_no}>#{detailEntry.invoice_no}</CopyableText>
              </div>
              <button className="btn ghost sm" onClick={() => { setDetailEntry(null); setJustCreatedNo(null); }}><IconX size={15} /></button>
            </div>
            <div style={{ color: 'var(--cream-dim)', fontSize: 13, marginBottom: 16 }}>
              {catLabel(detailEntry.category)} · {detailEntry.invoice_date} · {detailEntry.status === 'canceled' ? t('opt.canceled') : t('opt.active')}
            </div>

            {detailEntry.category === 'expense' && (
              <div style={{
                background: detailEntry.payment_source === 'cash_deposit' ? 'rgba(212,175,55,.12)' : 'rgba(90,130,255,.10)',
                border: `1px solid ${detailEntry.payment_source === 'cash_deposit' ? 'var(--gold-21)' : 'var(--accent-blue, #5a82ff)'}`,
                borderRadius: 8, padding: '8px 12px', marginBottom: 16, fontSize: 13, fontWeight: 600,
              }}>
                {t('entry.payFrom')}: {detailEntry.payment_source === 'cash_deposit' ? t('entry.cashDepositBalance') : t('entry.mainBalance')}
              </div>
            )}

            {(detailEntry.weight_21k || detailEntry.weight_18k || detailEntry.weight_24k || detailEntry.weight_silver) ? (
              <div className="table-wrap" style={{ marginBottom: 16 }}>
                <table>
                  <thead><tr><th>{t('hist.purity')}</th><th>{t('entry.weight')}</th><th>{t('entry.amount')}</th></tr></thead>
                  <tbody>
                    {detailEntry.weight_21k > 0 && <tr><td>21K</td><td>{detailEntry.weight_21k}</td><td>{Number(detailEntry.amount_21k || 0).toLocaleString()}</td></tr>}
                    {detailEntry.weight_18k > 0 && <tr><td>18K</td><td>{detailEntry.weight_18k}</td><td>{Number(detailEntry.amount_18k || 0).toLocaleString()}</td></tr>}
                    {detailEntry.weight_24k > 0 && <tr><td>24K</td><td>{detailEntry.weight_24k}</td><td>{Number(detailEntry.amount_24k || 0).toLocaleString()}</td></tr>}
                    {detailEntry.weight_silver > 0 && <tr><td>{t('common.silver')}</td><td>{detailEntry.weight_silver}</td><td>{Number(detailEntry.amount_silver || 0).toLocaleString()}</td></tr>}
                  </tbody>
                </table>
              </div>
            ) : (
              <p style={{ color: 'var(--cream-dim)', fontSize: 13.5, marginBottom: 16 }}>{detailEntry.description || 'No description'}</p>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderTop: '1px solid var(--line)', fontWeight: 700 }}>
              <span>{t('common.total')}</span><span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><IconSaudiRiyal /> {Number(detailEntry.total_amount || 0).toLocaleString()}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 13.5, color: 'var(--cream-dim)' }}>
              <span>{t('hist.cashCard')}</span><span>{Number(detailEntry.cash_amount || 0).toLocaleString()} / {Number(detailEntry.card_amount || 0).toLocaleString()}</span>
            </div>
            {detailEntry.contact_name && (
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 13.5, color: 'var(--cream-dim)' }}>
                <span>{t('entry.customer')}</span><span>{detailEntry.contact_name}</span>
              </div>
            )}
            {detailEntry.salesman_name && (
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 13.5, color: 'var(--cream-dim)' }}>
                <span>{t('hist.salesman')}</span><span>{detailEntry.salesman_name}</span>
              </div>
            )}
            {(detailEntry.note || (detailEntry.validity === 'Edited' && detailEntry.updated_by_name)) && (
              <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 8, background: 'var(--surface-2)', border: '1px solid var(--line)', fontSize: 13, color: 'var(--cream-dim)', lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                <div style={{ fontSize: 12, color: 'var(--cream-faint)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 }}>{t('hist.audit')}</div>
                {detailEntry.validity === 'Edited' && detailEntry.updated_by_name && (
                  <div>{t('hist.editedBy')} {detailEntry.updated_by_name} — {detailEntry.updated_at ? new Date(detailEntry.updated_at).toLocaleString() : ''}</div>
                )}
                {detailEntry.note && <div>{detailEntry.note}</div>}
              </div>
            )}
            {detailEntry.attachment_data && (
              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 12.5, color: 'var(--cream-faint)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.04em' }}>{t('entry.attachment')}</div>
                {detailEntry.attachment_data.startsWith('data:image') ? (
                  <img
                    src={detailEntry.attachment_data} alt={detailEntry.attachment_name || 'attachment'}
                    className="attachment-lightbox-trigger"
                    style={{ maxWidth: '100%', maxHeight: 220, borderRadius: 8, display: 'block', border: '1px solid var(--line)' }}
                    onClick={() => setPreviewAttachment({ src: detailEntry.attachment_data, name: detailEntry.attachment_name })}
                  />
                ) : (
                  <button
                    type="button" className="btn ghost sm"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                    onClick={() => setPreviewAttachment({ src: detailEntry.attachment_data, name: detailEntry.attachment_name })}
                  >
                    <IconPaperclip size={14} /> {detailEntry.attachment_name || t('entry.attachment')}
                  </button>
                )}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button className="btn" onClick={() => printSingleInvoice(detailEntry)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><IconPrinter size={14} /> {t('hist.printSlip')}</button>
              <button className="btn gold" onClick={() => shareWhatsApp(detailEntry)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><IconShare size={14} /> {t('hist.shareWhatsApp')}</button>
            </div>
          </div>
        </div>
      )}

      {previewAttachment && (
        <AttachmentPreview
          src={previewAttachment.src}
          name={previewAttachment.name}
          onClose={() => setPreviewAttachment(null)}
        />
      )}

      {pendingCancel && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(4,6,13,.6)', overflowY: 'auto', padding: '24px 16px' }}
          onClick={e => { if (e.target === e.currentTarget) { setPendingCancel(null); setCancelNote(''); setCancelError(''); } }}
        >
          <div className="panel" style={{ width: 420, maxWidth: '92vw', margin: 'auto', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
              <div className="panel-title">{t('hist.cancelInvoice')}</div>
              <button className="btn ghost sm" onClick={() => { setPendingCancel(null); setCancelNote(''); setCancelError(''); }}><IconX size={15} /></button>
            </div>
            <p style={{ color: 'var(--cream-dim)', fontSize: 14, marginBottom: 14 }}>
              {tf('hist.cancelConfirm', { no: pendingCancel.invoice_no })}
            </p>
            <div className="form-field" style={{ marginBottom: 14 }}>
              <label>{t('hist.reason')} {user?.role === 'supervisor' && `(${t('common.required')})`}</label>
              <input value={cancelNote} onChange={e => setCancelNote(e.target.value)} placeholder={t('hist.cancelReasonPlaceholder')} />
            </div>
            {cancelError && <div className="login-err" style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}><IconAlertTriangle size={14} /> {cancelError}</div>}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button className="btn ghost" onClick={() => { setPendingCancel(null); setCancelNote(''); setCancelError(''); }}>{t('hist.keepInvoice')}</button>
              <button className="btn danger" onClick={() => cancelEntry(pendingCancel.id)}>{t('hist.cancelInvoice')}</button>
            </div>
          </div>
        </div>
      )}

      {pendingDelete && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(4,6,13,.6)', overflowY: 'auto', padding: '24px 16px' }}
          onClick={e => { if (e.target === e.currentTarget) setPendingDelete(null); }}
        >
          <div className="panel" style={{ width: 420, maxWidth: '92vw', margin: 'auto', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
              <div className="panel-title">{t('hist.deletePermanently')}</div>
              <button className="btn ghost sm" onClick={() => setPendingDelete(null)}><IconX size={15} /></button>
            </div>
            <p style={{ color: 'var(--cream-dim)', fontSize: 14, marginBottom: 8 }}>
              {tf('hist.deleteConfirm', { no: pendingDelete.invoice_no })}
            </p>
            <p style={{ color: 'var(--accent-red)', fontSize: 13, marginBottom: 14 }}>
              <IconAlertTriangle size={14} style={{ verticalAlign: 'middle', marginInlineEnd: 4 }} /> {t('hist.deleteWarning')}
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button className="btn ghost" onClick={() => setPendingDelete(null)}>{t('common.cancel')}</button>
              <button className="btn danger" disabled={deleting} onClick={() => deleteEntry(pendingDelete.id)}>
                {deleting ? t('common.saving') : t('hist.deletePermanently')}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
