// Printable documents for Shop Loans: the lend slip and the shop account statement.
// jsPDF's built-in fonts cannot draw Arabic, so any text with non-Latin characters
// (shop names, notes, piece descriptions) is rendered by the browser onto a canvas and
// placed in the PDF as an image. Latin text stays real, selectable PDF text.
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { balanceChips, entryChips, fmtG, fmtG2, fmtMoney } from './loans.js';

const NAVY = [17, 17, 19];   // rich black
const GOLD = [201, 162, 39];
const GREY = [110, 116, 130];
const RED = [192, 72, 64];
const GREEN = [30, 138, 92];
const INK = [30, 34, 50];

const needsImg = (s) => /[^\u0000-ÿ–—‘’“”]/.test(String(s || ''));
const rgb = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;

function textImage(text, pt, { bold = false, color = INK, maxW = 0 } = {}) {
  const S = 3; // render at 3x for a crisp print
  const cv = document.createElement('canvas');
  const ctx = cv.getContext('2d');
  const font = `${bold ? 'bold ' : ''}${pt * S}px "Segoe UI", Tahoma, Arial, sans-serif`;
  ctx.font = font;
  let str = String(text);
  const limit = maxW ? maxW * S : Infinity;
  if (ctx.measureText(str).width > limit) {
    while (str.length > 1 && ctx.measureText(`${str}…`).width > limit) str = str.slice(0, -1);
    str += '…';
  }
  const w = Math.ceil(ctx.measureText(str).width) + 4;
  const h = Math.ceil(pt * S * 1.4);
  cv.width = w; cv.height = h;
  ctx.font = font;
  ctx.fillStyle = rgb(color);
  ctx.textBaseline = 'middle';
  ctx.direction = /[؀-ۿ]/.test(str) ? 'rtl' : 'ltr';
  ctx.textAlign = ctx.direction === 'rtl' ? 'right' : 'left';
  ctx.fillText(str, ctx.direction === 'rtl' ? w - 2 : 2, h / 2);
  return { data: cv.toDataURL('image/png'), w: w / S, h: h / S };
}

// Draw text at a baseline position; falls back to an image for non-Latin text.
function put(doc, text, x, y, { size = 10, bold = false, color = INK, align = 'left', maxW = 0 } = {}) {
  const str = String(text ?? '');
  if (!str) return;
  if (needsImg(str)) {
    const im = textImage(str, size, { bold, color, maxW });
    const px = align === 'right' ? x - im.w : align === 'center' ? x - im.w / 2 : x;
    doc.addImage(im.data, 'PNG', px, y - size * 0.95, im.w, im.h);
    return;
  }
  doc.setFont('helvetica', bold ? 'bold' : 'normal');
  doc.setFontSize(size);
  doc.setTextColor(...color);
  doc.text(str, x, y, { align, maxWidth: maxW || undefined });
}

const pad = (n) => String(n).padStart(2, '0');
const fmtDate = (iso) => { const d = new Date(iso); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const fmtTime = (iso) => { const d = new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const chipsText = (chips) => chips.map(([k, w]) => `${k} ${fmtG(w)}g`).join(', ');
const typeName = (e) => (e.entry_type === 'settle' && e.settle_kind === 'sold' ? 'Sold' : { lend: 'Lent', return: 'Returned', settle: 'Cash settle' }[e.entry_type]);

function header(doc, W, title, sub) {
  doc.setFillColor(...NAVY); doc.rect(0, 0, W, 64, 'F');
  doc.setFillColor(...GOLD); doc.rect(0, 64, W, 3, 'F');
  put(doc, 'SWAG GOLD', 36, 32, { size: 17, bold: true, color: [255, 255, 255] });
  put(doc, sub, 36, 50, { size: 8.5, color: [200, 205, 220] });
  put(doc, title, W - 36, 40, { size: 13, bold: true, color: [232, 200, 110], align: 'right' });
}

function footers(doc, W, H, label) {
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    put(doc, label, 36, H - 18, { size: 7.5, color: GREY });
    put(doc, `Page ${i} of ${n}`, W - 36, H - 18, { size: 7.5, color: GREY, align: 'right' });
  }
}

// ── Lend slip (A5) ─────────────────────────────────────────────────────────
export function buildLendSlip(entry, shop) {
  const doc = new jsPDF({ unit: 'pt', format: 'a5' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 32;
  header(doc, W, 'GOLD LENT SLIP', `Slip no. LN-${entry.id}`);

  let y = 96;
  put(doc, 'Lent to', M, y, { size: 8, color: GREY });
  put(doc, shop?.name || entry.shop_name || '', M, y + 18, { size: 16, bold: true, color: NAVY, maxW: W - M * 2 });
  put(doc, `${fmtDate(entry.occurred_at)}  ${fmtTime(entry.occurred_at)}`, W - M, y, { size: 9, color: INK, align: 'right' });
  if (entry.expected_return_time) put(doc, `Return by ${entry.expected_return_time}`, W - M, y + 14, { size: 9, bold: true, color: RED, align: 'right' });

  y += 40;
  const chips = entryChips(entry);
  autoTable(doc, {
    startY: y,
    margin: { left: M, right: M },
    theme: 'grid',
    head: [['Item', 'Weight (g)']],
    body: [
      ...chips.map(([k, w]) => [k === 'Silver' ? 'Silver' : `Gold ${k}`, fmtG2(w)]),
      ...(entry.weight_21k_eq > 0 && chips.some(([k]) => k !== 'Silver' && k !== '24K') ? [['Total gold (21K-equivalent)', fmtG2(entry.weight_21k_eq)]] : []),
    ],
    styles: { font: 'helvetica', fontSize: 10, cellPadding: 6, lineColor: [226, 221, 205], lineWidth: 0.4, textColor: INK },
    headStyles: { fillColor: NAVY, textColor: 255, fontStyle: 'bold' },
    columnStyles: { 1: { halign: 'right', fontStyle: 'bold' } },
  });
  y = doc.lastAutoTable.finalY + 16;

  if (entry.pieces?.length) {
    put(doc, 'Pieces', M, y, { size: 8, color: GREY });
    y += 13;
    entry.pieces.slice(0, 8).forEach((p) => {
      const meta = [p.karat, p.weight != null ? `${fmtG(p.weight)}g` : ''].filter(Boolean).join(' · ');
      put(doc, `•  ${p.desc}`, M, y, { size: 9.5, maxW: W - M * 2 - 90 });
      if (meta) put(doc, meta, W - M, y, { size: 9.5, color: GREY, align: 'right' });
      y += 14;
    });
    y += 4;
  }
  if (entry.taken_by) { put(doc, 'Taken by', M, y, { size: 8, color: GREY }); put(doc, entry.taken_by, M + 52, y, { size: 10, bold: true, maxW: W - M * 2 - 52 }); y += 16; }
  if (entry.note) { put(doc, 'Note', M, y, { size: 8, color: GREY }); put(doc, entry.note, M + 52, y, { size: 9.5, maxW: W - M * 2 - 52 }); y += 16; }

  const terms = 'The gold above remains the property of SWAG and is lent on trust for the day. It must be returned, or settled in cash, by the time shown.';
  const lines = doc.setFont('helvetica', 'normal').setFontSize(8).splitTextToSize(terms, W - M * 2);
  const sy = H - 120;
  put(doc, lines.join(' '), M, Math.max(y + 18, sy - 40), { size: 8, color: GREY, maxW: W - M * 2 });

  doc.setDrawColor(...GREY); doc.setLineWidth(0.6);
  doc.line(M, sy + 30, M + 150, sy + 30);
  doc.line(W - M - 150, sy + 30, W - M, sy + 30);
  put(doc, 'Given by (SWAG)', M, sy + 43, { size: 8, color: GREY });
  put(doc, entry.created_by_name || '', M, sy + 24, { size: 9, maxW: 150 });
  put(doc, 'Received by (shop)', W - M - 150, sy + 43, { size: 8, color: GREY });
  footers(doc, W, H, `Slip LN-${entry.id}`);
  return doc;
}

// ── Shop account statement (A4) ────────────────────────────────────────────
export function buildStatement(shop, entries) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 36;
  const today = new Date().toLocaleDateString('en-CA');
  header(doc, W, 'ACCOUNT STATEMENT', `Generated ${today}`);

  put(doc, 'Shop', M, 94, { size: 8, color: GREY });
  put(doc, shop.name, M, 114, { size: 17, bold: true, color: NAVY, maxW: W - M * 2 - 160 });
  if (shop.phone) put(doc, shop.phone, W - M, 114, { size: 10, color: GREY, align: 'right' });

  // balance tiles
  const bal = shop.balance || {};
  const tiles = [['24K', fmtG(bal.w24)], ['21K', fmtG(bal.w21)], ['18K', fmtG(bal.w18)], ['Silver', fmtG(bal.silver)], ['Total 21K-eq', fmtG2(shop.balance_21k_eq)]];
  const gap = 8, cw = (W - M * 2 - gap * (tiles.length - 1)) / tiles.length;
  put(doc, 'STILL WITH THE SHOP (g)', M, 140, { size: 7.5, color: GREY });
  tiles.forEach(([k, v], i) => {
    const x = M + i * (cw + gap), y = 148, last = i === tiles.length - 1;
    doc.setFillColor(last ? 247 : 250, last ? 240 : 248, last ? 214 : 241); doc.setDrawColor(228, 222, 205);
    doc.roundedRect(x, y, cw, 42, 4, 4, 'FD');
    put(doc, k, x + 9, y + 15, { size: 8, color: GREY });
    put(doc, `${v} g`, x + 9, y + 33, { size: 12.5, bold: true, color: last ? RED : NAVY });
  });

  // movements, oldest first with a running balance; canceled entries are left out
  const asc = [...entries].filter((e) => e.status === 'active')
    .sort((a, b) => (a.occurred_at || '').localeCompare(b.occurred_at || '') || a.id - b.id);
  let run = 0;
  const imgCells = new Map();
  const body = asc.map((e, ri) => {
    run += (e.entry_type === 'lend' ? 1 : -1) * (e.weight_21k_eq || 0);
    const parts = [e.pieces?.length ? e.pieces.map((p) => p.desc).join(', ') : '', e.taken_by, e.note].filter(Boolean);
    const detail = parts.join(' · ');
    if (needsImg(detail)) imgCells.set(`${ri}:5`, parts); // drawn as one image per part (the browser draws Arabic)
    return [
      `${fmtDate(e.occurred_at)}  ${fmtTime(e.occurred_at)}`,
      typeName(e),
      chipsText(entryChips(e)),
      e.cash_amount > 0 ? fmtMoney(e.cash_amount) : '',
      fmtG2(run),
      needsImg(detail) ? '' : detail,
    ];
  });
  autoTable(doc, {
    startY: 208,
    margin: { left: M, right: M, bottom: 36 },
    theme: 'grid',
    head: [['Date', 'Type', 'Gold / silver', 'Cash (SAR)', 'Balance (21K-eq g)', 'Details']],
    body: body.length ? body : [['', '', 'No movements yet', '', '', '']],
    styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 4, lineColor: [226, 221, 205], lineWidth: 0.4, textColor: INK, overflow: 'linebreak' },
    headStyles: { fillColor: NAVY, textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [250, 248, 241] },
    columnStyles: { 0: { cellWidth: 82 }, 1: { cellWidth: 56 }, 2: { cellWidth: 92 }, 3: { halign: 'right', cellWidth: 58 }, 4: { halign: 'right', cellWidth: 72, fontStyle: 'bold' } },
    didParseCell: (d) => {
      if (d.section !== 'body') return;
      const e = asc[d.row.index];
      if (!e) return;
      if (d.column.index === 1) d.cell.styles.textColor = e.entry_type === 'lend' ? RED : GREEN;
      if (imgCells.has(`${d.row.index}:5`) && d.column.index === 5) d.cell.styles.minCellHeight = imgCells.get(`${d.row.index}:5`).length * 13 + 6;
    },
    didDrawCell: (d) => {
      const parts = d.section === 'body' && d.column.index === 5 ? imgCells.get(`${d.row.index}:5`) : null;
      if (!parts) return;
      parts.forEach((txt, i) => {
        const im = textImage(txt, 8.5, { maxW: d.cell.width - 8 });
        doc.addImage(im.data, 'PNG', d.cell.x + 4, d.cell.y + 3 + i * 13, im.w, im.h);
      });
    },
  });

  const y = doc.lastAutoTable.finalY + 16;
  const owes = balanceChips(bal);
  put(doc, owes.length ? `Balance still with the shop: ${chipsText(owes)} (${fmtG2(shop.balance_21k_eq)} g in 21K-equivalent).` : 'This account is clear: nothing is outstanding.', M, y, { size: 9.5, bold: true, color: owes.length ? RED : GREEN, maxW: W - M * 2 });
  put(doc, 'Lend and return entries only. 21K-equivalent = 21K + 24K × 24/21 + 18K × 18/21. Canceled entries are not shown.', M, y + 14, { size: 7.5, color: GREY, maxW: W - M * 2 });
  footers(doc, W, H, `${shop.name} · statement ${today}`);
  return doc;
}

export function statementWhatsAppText(shop, entries, balanceLine) {
  const act = entries.filter((e) => e.status === 'active')
    .sort((a, b) => (a.occurred_at || '').localeCompare(b.occurred_at || '') || a.id - b.id).slice(-10);
  const rows = act.map((e) => `${fmtDate(e.occurred_at)} ${fmtTime(e.occurred_at)} · ${typeName(e)} · ${chipsText(entryChips(e))}${e.cash_amount > 0 ? ` · SAR ${fmtMoney(e.cash_amount)}` : ''}`);
  return `Swag Gold — account statement\n${shop.name}\n\n${rows.join('\n') || '—'}\n\n${balanceLine}`;
}

export function openPdf(doc) {
  const url = doc.output('bloburl');
  const w = window.open(url, '_blank');
  if (!w) doc.save('document.pdf'); // popup blocked: download instead
}

export function pdfFile(doc, name) {
  return new File([doc.output('blob')], name, { type: 'application/pdf' });
}
