// Day-by-day ledger (opening → movements → closing) for cash, gold (24K-equivalent) and silver.
//
// This mirrors the carry-forward logic used by the Dashboard (`closingByDay`) so a report and the
// Dashboard can never disagree: a day with no explicit "opening" inherits the previous day's closing,
// and the whole history is walked in order so multi-day gaps still carry through correctly.

// Supplier-payment gold/silver only counts against the metal balance on/after this date. Older
// supplier payments were handled by hand before the deduction existed, so applying it
// retroactively would double-count them. (Shared with the Dashboard.)
export const SUPPLIER_METAL_DEDUCTION_CUTOVER = '2026-09-30';

const k24 = (w, k) => (Number(w) || 0) * (k / 24);
const goldOf = (c) => (c ? k24(c.w21, 21) + k24(c.w18, 18) + (Number(c.w24) || 0) : 0);
const silverOf = (c) => (c ? Number(c.wSilver) || 0 : 0);
const num = (v) => Number(v) || 0;

/**
 * @param {Object} dailySummary   GET /invoices/daily-summary  ({ 'YYYY-MM-DD': { category: {cash,total,count,w21,w18,w24,wSilver} } })
 * @param {Array}  openings       GET /day-openings
 * @param {Array}  reconciliations GET /reconciliations
 * @param {Object} loans          GET /shop-loans/daily-summary  ({ 'YYYY-MM-DD': { lend|return|settle: {w21,w18,w24,wSilver,cash,count} } }) — optional
 * @returns {Array} one row per day (ascending), covering every day that has activity, an opening or a close
 */
export function computeLedger(dailySummary = {}, openings = [], reconciliations = [], loans = {}) {
  const openMap = {};
  (openings || []).forEach((r) => {
    openMap[r.opening_date] = { cash: num(r.opening_cash), gold: num(r.opening_gold), silver: num(r.opening_silver) };
  });
  const reconMap = {};
  (reconciliations || []).forEach((r) => { reconMap[r.reconciliation_date] = r; });

  const loanMap = loans || {};
  const days = [...new Set([...Object.keys(dailySummary), ...Object.keys(openMap), ...Object.keys(reconMap), ...Object.keys(loanMap)])]
    .filter(Boolean)
    .sort();

  const rows = [];
  let carryCash = 0, carryGold = 0, carrySilver = 0;

  for (const day of days) {
    const explicit = openMap[day];
    const openCash = explicit ? explicit.cash : carryCash;
    const openGold = explicit ? explicit.gold : carryGold;
    const openSilver = explicit ? explicit.silver : carrySilver;

    const d = dailySummary[day] || {};
    const sale = d.sale, pj = d.purchase_jewelry, ps = d.purchase_scrap;
    const sup = d.supplier_payment, exp = d.expense, add = d.cash_adjustment;

    const salesCash = num(sale?.cash);
    const salesTotal = num(sale?.total);
    const purchCash = num(pj?.cash) + num(ps?.cash);
    const purchTotal = num(pj?.total) + num(ps?.total);
    const supCash = num(sup?.cash);
    const expCash = num(exp?.cash);
    const cashAdded = num(add?.cash);
    // Shop loans: metal lent to another shop leaves stock, metal returned comes back; metal the shop
    // keeps and pays for ("settle") never returns, but its cash enters the drawer.
    const ln = loanMap[day] || {};
    const loan = {
      count: num(ln.lend?.count) + num(ln.return?.count) + num(ln.settle?.count),
      lentGold: goldOf(ln.lend), lentSilver: silverOf(ln.lend),
      returnedGold: goldOf(ln.return), returnedSilver: silverOf(ln.return),
      settledGold: goldOf(ln.settle), settledSilver: silverOf(ln.settle), settledCash: num(ln.settle?.cash),
    };
    const closeCash = openCash + salesCash + cashAdded + loan.settledCash - purchCash - supCash - expCash;

    const deducted = day >= SUPPLIER_METAL_DEDUCTION_CUTOVER;
    const supGoldPaid = goldOf(sup), supSilverPaid = silverOf(sup);
    const supGold = deducted ? supGoldPaid : 0;
    const supSilver = deducted ? supSilverPaid : 0;

    const goldSold = goldOf(sale), silverSold = silverOf(sale);
    const goldBought = goldOf(pj) + goldOf(ps), silverBought = silverOf(pj) + silverOf(ps);
    const closeGold = openGold - goldSold - supGold + goldBought - loan.lentGold + loan.returnedGold;
    const closeSilver = openSilver - silverSold - supSilver + silverBought - loan.lentSilver + loan.returnedSilver;

    const rec = reconMap[day];
    rows.push({
      date: day,
      openCash, openGold, openSilver,
      explicitOpening: !!explicit,
      sales: { count: num(sale?.count), total: salesTotal, cash: salesCash, card: salesTotal - salesCash, gold: goldSold, silver: silverSold },
      purchases: { count: num(pj?.count) + num(ps?.count), total: purchTotal, cash: purchCash, gold: goldBought, silver: silverBought },
      supplier: { count: num(sup?.count), cash: supCash, gold: supGold, silver: supSilver, goldPaid: supGoldPaid, silverPaid: supSilverPaid, deducted },
      expenses: { count: num(exp?.count), cash: expCash },
      cashAdded, loan,
      closeCash, closeGold, closeSilver,
      closed: !!rec,
      counted: rec ? num(rec.counted_cash) : null,
      variance: rec ? num(rec.variance) : null,
      closedBy: rec?.reconciled_by_name || null,
      entries: Object.values(d).reduce((s, c) => s + num(c?.count), 0), // invoices only — loan entries are counted in loan.count
    });

    carryCash = closeCash; carryGold = closeGold; carrySilver = closeSilver;
  }
  return rows;
}

/** Totals for a slice of ledger rows (flows are summed; opening = first row's, closing = last row's). */
export function summarizeLedger(rows) {
  const z = () => ({ count: 0, total: 0, cash: 0, card: 0, gold: 0, silver: 0 });
  const s = {
    days: rows.length,
    openCash: rows[0]?.openCash || 0, openGold: rows[0]?.openGold || 0, openSilver: rows[0]?.openSilver || 0,
    closeCash: rows[rows.length - 1]?.closeCash || 0, closeGold: rows[rows.length - 1]?.closeGold || 0, closeSilver: rows[rows.length - 1]?.closeSilver || 0,
    sales: z(), purchases: z(), supplier: { count: 0, cash: 0, gold: 0, silver: 0, goldPaid: 0, silverPaid: 0 },
    expenses: { count: 0, cash: 0 }, cashAdded: 0, entries: 0,
    loan: { count: 0, lentGold: 0, lentSilver: 0, returnedGold: 0, returnedSilver: 0, settledGold: 0, settledSilver: 0, settledCash: 0 },
    closedDays: 0, totalVariance: 0, hasPreCutoverSupplierMetal: false,
  };
  rows.forEach((r) => {
    Object.keys(s.sales).forEach((k) => { s.sales[k] += r.sales[k] || 0; });
    ['count', 'total', 'cash', 'gold', 'silver'].forEach((k) => { s.purchases[k] += r.purchases[k] || 0; });
    ['count', 'cash', 'gold', 'silver', 'goldPaid', 'silverPaid'].forEach((k) => { s.supplier[k] += r.supplier[k] || 0; });
    s.expenses.count += r.expenses.count; s.expenses.cash += r.expenses.cash;
    s.cashAdded += r.cashAdded; s.entries += r.entries;
    Object.keys(s.loan).forEach((k) => { s.loan[k] += r.loan[k] || 0; });
    if (r.closed) { s.closedDays += 1; s.totalVariance += r.variance || 0; }
    if (!r.supplier.deducted && (r.supplier.goldPaid > 0 || r.supplier.silverPaid > 0)) s.hasPreCutoverSupplierMetal = true;
  });
  return s;
}
