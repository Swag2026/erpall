// PDF + Excel exports for the Daily Ledger report. Both are always in English (jsPDF's built-in fonts
// have no Arabic glyphs, and finance/audit copies are easier to share when they're one language).
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { SUPPLIER_METAL_DEDUCTION_CUTOVER } from './ledger.js';

const NAVY = [27, 35, 64];
const GOLD = [196, 154, 30];
const ZEBRA = [250, 248, 241];
const RED = [192, 72, 64];
const GREY = [110, 116, 130];

const f2 = (n) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const f0 = (n) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
const weekday = (d) => new Date(d + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short' });
const stamp = (d = new Date()) => d.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function statusText(r) {
  if (!r.closed) return 'Open';
  const v = r.variance || 0;
  return Math.abs(v) < 0.005 ? 'Closed' : `Closed (${v > 0 ? '+' : ''}${f2(v)})`;
}

function rowNotes(r) {
  const n = [];
  if (r.explicitOpening) n.push('Opening set manually');
  if (!r.supplier.deducted && (r.supplier.goldPaid > 0 || r.supplier.silverPaid > 0)) {
    n.push(`Supplier metal not deducted (before ${SUPPLIER_METAL_DEDUCTION_CUTOVER})`);
  }
  return n.join('; ');
}

/* ─────────────────────────────── PDF ─────────────────────────────── */
export function exportLedgerPDF(rows, sum, meta) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 32;

  // header band
  doc.setFillColor(...NAVY); doc.rect(0, 0, W, 64, 'F');
  doc.setFillColor(...GOLD); doc.rect(0, 64, W, 3, 'F');
  doc.setTextColor(212, 170, 48); doc.setFont('helvetica', 'bold'); doc.setFontSize(19);
  doc.text('SWAG GOLD', M, 30);
  doc.setTextColor(255, 255, 255); doc.setFontSize(11); doc.setFont('helvetica', 'normal');
  doc.text('Daily Ledger Report  -  Opening balance, movements and closing balance by day', M, 48);
  doc.setFontSize(9.5);
  doc.text(`Period: ${meta.from} to ${meta.to}   |   ${sum.days} day${sum.days === 1 ? '' : 's'}`, W - M, 28, { align: 'right' });
  doc.text(`Generated ${stamp()}${meta.user ? '  by ' + meta.user : ''}`, W - M, 44, { align: 'right' });

  // summary cards
  const cards = [
    ['Opening Cash (SAR)', f2(sum.openCash)],
    ['Total Sales (SAR)', f2(sum.sales.total)],
    ['Total Purchases (SAR)', f2(sum.purchases.total)],
    ['Closing Cash (SAR)', f2(sum.closeCash), sum.closeCash < 0],
    ['Closing Gold (24K-eq g)', f2(sum.closeGold), sum.closeGold < 0],
    ['Closing Silver (g)', f2(sum.closeSilver), sum.closeSilver < 0],
  ];
  const gap = 8, cw = (W - M * 2 - gap * (cards.length - 1)) / cards.length;
  cards.forEach((c, i) => {
    const x = M + i * (cw + gap), y = 80;
    doc.setFillColor(247, 245, 238); doc.setDrawColor(228, 222, 205);
    doc.roundedRect(x, y, cw, 44, 4, 4, 'FD');
    doc.setFillColor(...GOLD); doc.rect(x, y + 6, 2.5, 32, 'F');
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...GREY);
    doc.text(c[0].toUpperCase(), x + 10, y + 16);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(...(c[2] ? RED : NAVY));
    doc.text(c[1], x + 10, y + 35);
  });

  const common = {
    theme: 'grid',
    margin: { left: M, right: M, top: 40, bottom: 34 },
    styles: { font: 'helvetica', fontSize: 8, cellPadding: 3.4, lineColor: [226, 221, 205], lineWidth: 0.4, textColor: [30, 34, 50], overflow: 'linebreak' },
    headStyles: { fillColor: NAVY, textColor: 255, fontStyle: 'bold', halign: 'center', valign: 'middle' },
    footStyles: { fillColor: [236, 230, 210], textColor: NAVY, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: ZEBRA },
  };
  const sectionTitle = (text, y) => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.setTextColor(...NAVY);
    doc.text(text, M, y);
    doc.setDrawColor(...GOLD); doc.setLineWidth(1.2); doc.line(M, y + 4, M + 34, y + 4);
  };

  // ── Table 1: cash ledger
  sectionTitle('CASH LEDGER (SAR)', 146);
  const cashBody = rows.map((r) => [
    `${r.date}  ${weekday(r.date)}`, f2(r.openCash), f2(r.sales.total), f2(r.sales.card), f2(r.sales.cash), f2(r.cashAdded),
    f2(r.purchases.cash), f2(r.supplier.cash), f2(r.expenses.cash), f2(r.closeCash), statusText(r),
  ]);
  const cashFoot = [[
    'PERIOD', f2(sum.openCash), f2(sum.sales.total), f2(sum.sales.card), f2(sum.sales.cash), f2(sum.cashAdded),
    f2(sum.purchases.cash), f2(sum.supplier.cash), f2(sum.expenses.cash), f2(sum.closeCash),
    `${sum.closedDays}/${sum.days} closed`,
  ]];
  const num = (i) => ({ [i]: { halign: 'right' } });
  autoTable(doc, {
    ...common,
    startY: 152,
    head: [['Date', 'Opening', 'Sales Total', 'of which Card', 'Cash Sales', 'Cash Added', 'Purchases (cash)', 'Supplier Pay (cash)', 'Expenses', 'Closing Cash', 'Day Status']],
    body: cashBody,
    foot: cashFoot,
    showFoot: 'lastPage',
    columnStyles: { 0: { cellWidth: 74 }, ...[1, 2, 3, 4, 5, 6, 7, 8, 9].reduce((a, i) => ({ ...a, ...num(i) }), {}), 10: { halign: 'center', cellWidth: 70 } },
    didParseCell: (d) => {
      if (d.section === 'body') {
        const r = rows[d.row.index];
        if (d.column.index === 9) { d.cell.styles.fontStyle = 'bold'; if (r.closeCash < 0) d.cell.styles.textColor = RED; }
        if (d.column.index === 3) d.cell.styles.textColor = GREY;
        if (d.column.index === 10) d.cell.styles.textColor = r.closed ? [42, 122, 90] : GREY;
      }
      if (d.section === 'foot' && d.column.index !== 0 && d.column.index !== 10) d.cell.styles.halign = 'right';
    },
  });

  // ── Table 2: metals
  let y2 = doc.lastAutoTable.finalY + 26;
  if (y2 > H - 150) { doc.addPage(); y2 = 60; }
  sectionTitle('GOLD (24K-EQUIVALENT g) & SILVER (g) LEDGER', y2);
  const metalBody = rows.map((r) => [
    `${r.date}  ${weekday(r.date)}`,
    f2(r.openGold), f2(r.sales.gold), f2(r.supplier.gold), f2(r.purchases.gold), f2(r.closeGold),
    f2(r.openSilver), f2(r.sales.silver), f2(r.supplier.silver), f2(r.purchases.silver), f2(r.closeSilver),
  ]);
  const metalFoot = [[
    'PERIOD', f2(sum.openGold), f2(sum.sales.gold), f2(sum.supplier.gold), f2(sum.purchases.gold), f2(sum.closeGold),
    f2(sum.openSilver), f2(sum.sales.silver), f2(sum.supplier.silver), f2(sum.purchases.silver), f2(sum.closeSilver),
  ]];
  autoTable(doc, {
    ...common,
    startY: y2 + 6,
    head: [
      [{ content: 'Date', rowSpan: 2 }, { content: 'GOLD (24K-eq g)', colSpan: 5 }, { content: 'SILVER (g)', colSpan: 5 }],
      ['Opening', 'Sold', 'Paid to Supplier', 'Purchased', 'Closing', 'Opening', 'Sold', 'Paid to Supplier', 'Purchased', 'Closing'],
    ],
    body: metalBody,
    foot: metalFoot,
    showFoot: 'lastPage',
    columnStyles: { 0: { cellWidth: 74 }, ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].reduce((a, i) => ({ ...a, ...num(i) }), {}) },
    didParseCell: (d) => {
      if (d.section === 'body') {
        const r = rows[d.row.index];
        if (d.column.index === 5) { d.cell.styles.fontStyle = 'bold'; if (r.closeGold < 0) d.cell.styles.textColor = RED; }
        if (d.column.index === 10) { d.cell.styles.fontStyle = 'bold'; if (r.closeSilver < 0) d.cell.styles.textColor = RED; }
      }
      if (d.section === 'foot' && d.column.index !== 0) d.cell.styles.halign = 'right';
    },
  });

  // ── Table 3 (only when shop loans exist in the period)
  if (sum.loan && sum.loan.count > 0) {
    let y3 = doc.lastAutoTable.finalY + 26;
    if (y3 > H - 150) { doc.addPage(); y3 = 60; }
    sectionTitle('SHOP LOANS (gold/silver lent to other shops)', y3);
    const loanRows = rows.filter((r) => r.loan.count > 0);
    autoTable(doc, {
      ...common,
      startY: y3 + 6,
      head: [['Date', 'Gold lent out (24K-eq g)', 'Gold returned in (24K-eq g)', 'Gold settled for cash (24K-eq g)', 'Cash received (SAR)', 'Silver lent (g)', 'Silver returned (g)', 'Silver settled (g)']],
      body: loanRows.map((r) => [`${r.date}  ${weekday(r.date)}`, f2(r.loan.lentGold), f2(r.loan.returnedGold), f2(r.loan.settledGold), f2(r.loan.settledCash), f2(r.loan.lentSilver), f2(r.loan.returnedSilver), f2(r.loan.settledSilver)]),
      foot: [['PERIOD', f2(sum.loan.lentGold), f2(sum.loan.returnedGold), f2(sum.loan.settledGold), f2(sum.loan.settledCash), f2(sum.loan.lentSilver), f2(sum.loan.returnedSilver), f2(sum.loan.settledSilver)]],
      showFoot: 'lastPage',
      columnStyles: { 0: { cellWidth: 74 }, ...[1, 2, 3, 4, 5, 6, 7].reduce((a, i) => ({ ...a, ...num(i) }), {}) },
      didParseCell: (d) => { if (d.section === 'foot' && d.column.index !== 0) d.cell.styles.halign = 'right'; },
    });
  }

  // notes
  let ny = doc.lastAutoTable.finalY + 16;
  const notes = [
    'Closing = Opening + Cash Sales + Cash Added - Purchases - Supplier Payments - Expenses (cash legs only; card/transfer sales are shown separately and never enter the drawer).',
    'Metal closing = Opening - Sold - Paid to Supplier + Purchased - Lent to shops + Returned by shops. Gold is shown as 24K-equivalent grams. A day without a manual opening inherits the previous day\'s closing.',
  ];
  if (sum.loan && sum.loan.count > 0) notes.push('Shop loans: gold lent to other shops leaves the gold balance and comes back when returned. Cash a shop pays for gold it keeps is added to Closing Cash (it is included in the closing figures above).');
  if (sum.hasPreCutoverSupplierMetal) {
    notes.push(`Supplier-payment gold/silver on days before ${SUPPLIER_METAL_DEDUCTION_CUTOVER} is not deducted from the metal balance (it was settled manually before this rule existed).`);
  }
  doc.setFont('helvetica', 'italic'); doc.setFontSize(7.5); doc.setTextColor(...GREY);
  notes.forEach((n) => {
    const lines = doc.splitTextToSize(n, W - M * 2);
    if (ny + lines.length * 10 > H - 40) { doc.addPage(); ny = 50; }
    doc.text(lines, M, ny); ny += lines.length * 10 + 3;
  });

  // page footers
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setDrawColor(220, 214, 196); doc.setLineWidth(0.5); doc.line(M, H - 26, W - M, H - 26);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...GREY);
    doc.text('SWAG Gold - Daily Ledger Report  |  Confidential', M, H - 14);
    doc.text(`Page ${i} of ${pages}`, W - M, H - 14, { align: 'right' });
    if (i > 1) {
      doc.setFont('helvetica', 'bold'); doc.setTextColor(...NAVY); doc.setFontSize(8);
      doc.text(`SWAG GOLD  -  Daily Ledger  (${meta.from} to ${meta.to})`, M, 24);
      doc.setDrawColor(...GOLD); doc.setLineWidth(1); doc.line(M, 29, W - M, 29);
    }
  }
  doc.save(`swag-gold-daily-ledger_${meta.from}_to_${meta.to}.pdf`);
}

/* ────────────────────────────── Excel ────────────────────────────── */
export async function exportLedgerExcel(rows, sum, meta) {
  const ExcelJS = (await import('exceljs')).default || (await import('exceljs'));
  const wb = new ExcelJS.Workbook();
  wb.creator = meta.user || 'SWAG Gold';
  wb.created = new Date();

  const NAVY_HEX = 'FF1B2340', GOLD_HEX = 'FFD4AA30', ZEBRA_HEX = 'FFFAF8F1', TOTAL_HEX = 'FFECE6D2', SUB_HEX = 'FF2C3760';
  const thin = { style: 'thin', color: { argb: 'FFE2DDCD' } };
  const border = { top: thin, left: thin, bottom: thin, right: thin };
  const MONEY = '#,##0.00;[Red]-#,##0.00;0.00';
  const COUNT = '#,##0';

  /* ---- sheet 1: Daily Ledger ---- */
  const ws = wb.addWorksheet('Daily Ledger', {
    views: [{ state: 'frozen', xSplit: 2, ySplit: 6, showGridLines: false }],
    pageSetup: { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  const cols = [
    ['Date', 12], ['Day', 6],
    ['Cash (SAR)', 14], ['Gold (24K-eq g)', 14], ['Silver (g)', 12],                       // opening C-E
    ['Invoices', 9], ['Total (SAR)', 14], ['Cash (SAR)', 14], ['Card (SAR)', 14], ['Gold (24K-eq g)', 14], ['Silver (g)', 12], // sales F-K
    ['Invoices', 9], ['Total (SAR)', 14], ['Cash (SAR)', 14], ['Gold (24K-eq g)', 14], ['Silver (g)', 12],                      // purchases L-P
    ['Cash (SAR)', 14], ['Gold (24K-eq g)', 14], ['Silver (g)', 12],                         // supplier Q-S
    ['Expenses (SAR)', 14], ['Cash Added (SAR)', 15],                                        // T-U
    ['Cash (SAR)', 15], ['Gold (24K-eq g)', 15], ['Silver (g)', 13],                         // closing V-X
    ['Status', 18], ['Counted Cash (SAR)', 16], ['Variance (SAR)', 14], ['Notes', 46],       // Y-AB
  ];
  ws.columns = cols.map(([, w]) => ({ width: w }));
  const LAST = cols.length;

  ws.mergeCells(1, 1, 1, 12);
  ws.getCell('A1').value = 'SWAG GOLD  -  Daily Ledger Report';
  ws.getCell('A1').font = { name: 'Calibri', size: 18, bold: true, color: { argb: NAVY_HEX } };
  ws.mergeCells(2, 1, 2, 12);
  ws.getCell('A2').value = `Period: ${meta.from} to ${meta.to}   |   ${sum.days} day(s)   |   Opening balance, daily movements and closing balance`;
  ws.getCell('A2').font = { size: 11, color: { argb: 'FF555B6E' } };
  ws.mergeCells(3, 1, 3, 12);
  ws.getCell('A3').value = `Generated ${stamp()}${meta.user ? ' by ' + meta.user : ''}`;
  ws.getCell('A3').font = { size: 9.5, italic: true, color: { argb: 'FF8A90A2' } };
  ws.getRow(1).height = 28;

  // group header (row 5) + sub header (row 6)
  const groups = [
    [1, 1, 'Date'], [2, 2, 'Day'], [3, 5, 'OPENING BALANCE'], [6, 11, 'SALES'], [12, 16, 'PURCHASES'],
    [17, 19, 'SUPPLIER PAYMENTS'], [20, 20, 'EXPENSES'], [21, 21, 'CASH ADDED'], [22, 24, 'CLOSING BALANCE'],
    [25, 27, 'DAY CLOSE'], [28, 28, 'NOTES'],
  ];
  groups.forEach(([a, b, text]) => {
    if (a !== b) ws.mergeCells(5, a, 5, b);
    const c = ws.getCell(5, a);
    c.value = text;
    c.font = { bold: true, color: { argb: NAVY_HEX }, size: 10.5 };
    c.alignment = { horizontal: 'center', vertical: 'middle' };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GOLD_HEX } };
    for (let k = a; k <= b; k++) ws.getCell(5, k).border = border;
  });
  // rows 5-6 for Date/Day/Notes are visually one tall header
  [[1], [2], [28]].forEach(([k]) => { ws.mergeCells(5, k, 6, k); });
  cols.forEach(([label], i) => {
    const c = ws.getCell(6, i + 1);
    if ([1, 2, 28].includes(i + 1)) return;
    c.value = label;
    c.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY_HEX } };
    c.border = border;
  });
  ws.getRow(5).height = 22; ws.getRow(6).height = 30;

  const START = 7;
  rows.forEach((r, i) => {
    const row = ws.getRow(START + i);
    row.values = [
      r.date, weekday(r.date),
      r.openCash, r.openGold, r.openSilver,
      r.sales.count, r.sales.total, r.sales.cash, r.sales.card, r.sales.gold, r.sales.silver,
      r.purchases.count, r.purchases.total, r.purchases.cash, r.purchases.gold, r.purchases.silver,
      r.supplier.cash, r.supplier.gold, r.supplier.silver,
      r.expenses.cash, r.cashAdded,
      r.closeCash, r.closeGold, r.closeSilver,
      statusText(r), r.counted, r.variance, rowNotes(r),
    ];
    row.eachCell({ includeEmpty: true }, (c, col) => {
      c.border = border;
      c.font = { size: 10, bold: col >= 22 && col <= 24 };
      if (i % 2 === 1) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ZEBRA_HEX } };
      if (col === 1 || col === 2 || col === 25) c.alignment = { horizontal: 'center', vertical: 'middle' };
      else if (col === 28) c.alignment = { horizontal: 'left', wrapText: true, vertical: 'middle' };
      else c.alignment = { horizontal: 'right', vertical: 'middle' };
      if (col === 6 || col === 12) c.numFmt = COUNT;
      else if (col >= 3 && col <= 27 && col !== 25) c.numFmt = MONEY;
    });
    const st = row.getCell(25);
    st.font = { size: 10, bold: true, color: { argb: r.closed ? 'FF2A7A5A' : 'FF8A90A2' } };
  });

  const END = START + rows.length - 1;
  const T = END + 1;
  // keep the formula (so Excel stays live) AND a cached result (so previewers that don't recalculate show real numbers)
  const colSum = (c) => rows.reduce((a, _r, i) => a + (Number(ws.getRow(START + i).getCell(c).value) || 0), 0);
  const sumF = (col, c) => ({ formula: `SUM(${col}${START}:${col}${END})`, result: colSum(c) });
  const letter = (n) => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
  const tot = ws.getRow(T);
  tot.getCell(1).value = 'PERIOD TOTAL';
  ws.mergeCells(T, 1, T, 2);
  tot.getCell(3).value = rows[0]?.openCash || 0;      // opening of first day
  tot.getCell(4).value = rows[0]?.openGold || 0;
  tot.getCell(5).value = rows[0]?.openSilver || 0;
  [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21].forEach((c) => { tot.getCell(c).value = sumF(letter(c), c); });
  tot.getCell(22).value = rows[rows.length - 1]?.closeCash || 0;   // closing of last day
  tot.getCell(23).value = rows[rows.length - 1]?.closeGold || 0;
  tot.getCell(24).value = rows[rows.length - 1]?.closeSilver || 0;
  tot.getCell(25).value = `${sum.closedDays}/${sum.days} closed`;
  tot.getCell(27).value = sumF('AA', 27);
  tot.getCell(28).value = 'Opening = first day, Closing = last day; other columns are sums.';
  for (let col = 1; col <= LAST; col++) {
    const c = tot.getCell(col);
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TOTAL_HEX } };
    c.font = { bold: true, size: 10.5, color: { argb: NAVY_HEX } };
    c.border = { top: { style: 'medium', color: { argb: GOLD_HEX } }, bottom: { style: 'medium', color: { argb: GOLD_HEX } }, left: thin, right: thin };
    c.alignment = { horizontal: col === 1 || col === 25 ? 'center' : col === 28 ? 'left' : 'right' };
    if (col === 6 || col === 12) c.numFmt = COUNT;
    else if (col >= 3 && col <= 27 && col !== 25) c.numFmt = MONEY;
  }
  tot.getCell(28).font = { italic: true, size: 9, color: { argb: 'FF555B6E' } };
  tot.height = 22;
  ws.autoFilter = { from: { row: 6, column: 1 }, to: { row: END, column: LAST } };

  /* ---- sheet 2: Summary ---- */
  const s2 = wb.addWorksheet('Summary', { views: [{ showGridLines: false }] });
  s2.columns = [{ width: 38 }, { width: 20 }, { width: 20 }, { width: 20 }, { width: 20 }];
  s2.mergeCells('A1:E1');
  s2.getCell('A1').value = 'SWAG GOLD  -  Period Summary';
  s2.getCell('A1').font = { size: 18, bold: true, color: { argb: NAVY_HEX } };
  s2.getCell('A2').value = `Period: ${meta.from} to ${meta.to}   |   ${sum.days} day(s)   |   ${sum.entries} entries`;
  s2.getCell('A2').font = { size: 11, color: { argb: 'FF555B6E' } };
  s2.getCell('A3').value = `Generated ${stamp()}${meta.user ? ' by ' + meta.user : ''}`;
  s2.getCell('A3').font = { size: 9.5, italic: true, color: { argb: 'FF8A90A2' } };
  s2.getRow(1).height = 28;

  const head = (r, labels) => {
    labels.forEach((l, i) => {
      const c = s2.getCell(r, i + 1);
      c.value = l;
      c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY_HEX } };
      c.alignment = { horizontal: i === 0 ? 'left' : 'center' };
      c.border = border;
    });
  };
  const line = (r, vals, opts = {}) => {
    vals.forEach((v, i) => {
      const c = s2.getCell(r, i + 1);
      c.value = v;
      c.border = border;
      c.font = { size: 10.5, bold: !!opts.bold };
      if (opts.fill) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: opts.fill } };
      if (i > 0) { c.alignment = { horizontal: 'right' }; c.numFmt = MONEY; }
    });
  };
  head(5, ['BALANCES', 'Cash (SAR)', 'Gold (24K-eq g)', 'Silver (g)']);
  line(6, ['Opening (start of period)', sum.openCash, sum.openGold, sum.openSilver]);
  line(7, ['Closing (end of period)', sum.closeCash, sum.closeGold, sum.closeSilver], { bold: true, fill: TOTAL_HEX });
  line(8, ['Net change', sum.closeCash - sum.openCash, sum.closeGold - sum.openGold, sum.closeSilver - sum.openSilver]);

  head(10, ['MOVEMENTS', 'Invoices', 'Total (SAR)', 'Cash (SAR)', 'Card (SAR)']);
  line(11, ['Sales', sum.sales.count, sum.sales.total, sum.sales.cash, sum.sales.card]);
  line(12, ['Purchases', sum.purchases.count, sum.purchases.total, sum.purchases.cash, null]);
  line(13, ['Supplier payments', sum.supplier.count, null, sum.supplier.cash, null]);
  line(14, ['Expenses', sum.expenses.count, null, sum.expenses.cash, null]);
  line(15, ['Cash added', null, null, sum.cashAdded, null]);
  [11, 12, 13, 14].forEach((r) => { s2.getCell(r, 2).numFmt = COUNT; });

  head(17, ['METAL MOVEMENT', 'Gold (24K-eq g)', 'Silver (g)']);
  line(18, ['Sold', sum.sales.gold, sum.sales.silver]);
  line(19, ['Purchased', sum.purchases.gold, sum.purchases.silver]);
  line(20, ['Paid to suppliers (deducted)', sum.supplier.gold, sum.supplier.silver]);

  head(22, ['DAY CLOSE', 'Value']);
  line(23, ['Days closed', `${sum.closedDays} of ${sum.days}`]);
  line(24, ['Total cash variance (SAR)', sum.totalVariance]);
  s2.getCell('B23').alignment = { horizontal: 'right' };

  const nrow = 26;
  const noteList = [
    'Closing cash = Opening + Cash Sales + Cash Added - Purchases - Supplier Payments - Expenses (cash legs only).',
    'Metal closing = Opening - Sold - Paid to Supplier + Purchased. A day with no manual opening inherits the previous day\'s closing.',
  ];
  if (sum.loan && sum.loan.count > 0) noteList.push(`Shop loans in this period: gold lent ${sum.loan.lentGold.toFixed(2)} g, returned ${sum.loan.returnedGold.toFixed(2)} g (24K-eq), silver lent ${sum.loan.lentSilver.toFixed(2)} g, returned ${sum.loan.returnedSilver.toFixed(2)} g, cash received for gold kept SAR ${sum.loan.settledCash.toFixed(2)}. These are included in the closing balances (see the Shop Loans sheet).`);
  if (sum.hasPreCutoverSupplierMetal) noteList.push(`Supplier-payment gold/silver before ${SUPPLIER_METAL_DEDUCTION_CUTOVER} is not deducted (settled manually before the rule existed).`);
  noteList.forEach((n, i) => {
    s2.mergeCells(nrow + i, 1, nrow + i, 5);
    const c = s2.getCell(nrow + i, 1);
    c.value = n; c.font = { italic: true, size: 9.5, color: { argb: 'FF6E7482' } };
    c.alignment = { wrapText: true, vertical: 'top' };
    s2.getRow(nrow + i).height = 26;
  });

  /* ---- sheet 3: Shop Loans (only when the period has any) ---- */
  if (sum.loan && sum.loan.count > 0) {
    const s3 = wb.addWorksheet('Shop Loans', { views: [{ showGridLines: false }] });
    s3.columns = [{ width: 14 }, { width: 8 }, { width: 22 }, { width: 22 }, { width: 24 }, { width: 18 }, { width: 16 }, { width: 18 }, { width: 18 }];
    s3.getCell('A1').value = 'SWAG GOLD  -  Shop Loans';
    s3.getCell('A1').font = { size: 18, bold: true, color: { argb: NAVY_HEX } };
    s3.getCell('A2').value = `Period: ${meta.from} to ${meta.to}. Gold lent leaves the gold balance; returned gold comes back; cash received for gold a shop keeps enters Closing Cash.`;
    s3.getCell('A2').font = { size: 10.5, color: { argb: 'FF555B6E' } };
    const hdr = ['Date', 'Day', 'Gold lent out (24K-eq g)', 'Gold returned in (24K-eq g)', 'Gold settled for cash (24K-eq g)', 'Cash received (SAR)', 'Silver lent (g)', 'Silver returned (g)', 'Silver settled (g)'];
    hdr.forEach((h, i) => {
      const c = s3.getCell(4, i + 1);
      c.value = h; c.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY_HEX } };
      c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; c.border = border;
    });
    s3.getRow(4).height = 32;
    const lrows = rows.filter((r) => r.loan.count > 0);
    lrows.forEach((r, i) => {
      const row = s3.getRow(5 + i);
      row.values = [r.date, weekday(r.date), r.loan.lentGold, r.loan.returnedGold, r.loan.settledGold, r.loan.settledCash, r.loan.lentSilver, r.loan.returnedSilver, r.loan.settledSilver];
      row.eachCell({ includeEmpty: true }, (c, col) => {
        c.border = border; c.font = { size: 10 };
        c.alignment = { horizontal: col <= 2 ? 'center' : 'right' };
        if (col > 2) c.numFmt = MONEY;
        if (i % 2 === 1) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ZEBRA_HEX } };
      });
    });
    const tr = s3.getRow(5 + lrows.length);
    tr.values = ['PERIOD TOTAL', '', sum.loan.lentGold, sum.loan.returnedGold, sum.loan.settledGold, sum.loan.settledCash, sum.loan.lentSilver, sum.loan.returnedSilver, sum.loan.settledSilver];
    tr.eachCell({ includeEmpty: true }, (c, col) => {
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TOTAL_HEX } };
      c.font = { bold: true, size: 10.5, color: { argb: NAVY_HEX } };
      c.border = border; c.alignment = { horizontal: col <= 2 ? 'center' : 'right' };
      if (col > 2) c.numFmt = MONEY;
    });
  }

  const buf = await wb.xlsx.writeBuffer();
  download(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `swag-gold-daily-ledger_${meta.from}_to_${meta.to}.xlsx`);
}
