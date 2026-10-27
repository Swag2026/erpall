from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import Optional
from datetime import date, timedelta
from ..core.database import get_db
from ..core.security import get_current_user
from ..core.permissions import has_permission
from ..models.invoice import Invoice
from ..models.shop_loan import LoanEntry
from ..core.tenant import to_eq
from fastapi import HTTPException

router = APIRouter(prefix="/api/reports", tags=["reports"])


def _require_reports(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not has_permission(db, current_user.role_id, current_user.role.name, "page.reports.view"):
        raise HTTPException(status_code=403, detail="You don't have permission to view reports")
    return current_user


@router.get("/daily")
def daily_report(
    report_date: date = Query(...),
    db: Session = Depends(get_db),
    _=Depends(_require_reports),
):
    invoices = db.query(Invoice).filter(
        Invoice.invoice_date == report_date,
        Invoice.status == "active",
    ).order_by(Invoice.created_at).all()

    sales = [i for i in invoices if i.category == "sale"]
    purchases = [i for i in invoices if i.category in ("purchase_jewelry", "purchase_scrap")]
    payments = [i for i in invoices if i.category == "supplier_payment"]
    expenses = [i for i in invoices if i.category == "expense"]

    def _sum(items, field):
        return sum(getattr(i, field, 0) or 0 for i in items)

    return {
        "date": str(report_date),
        "summary": {
            "total_revenue": _sum(sales, "total_amount"),
            "total_purchases": _sum(purchases, "total_amount"),
            "total_expenses": _sum(expenses, "total_amount"),
            "total_payments": _sum(payments, "total_amount"),
            "cash_in": _sum(sales, "cash_amount"),
            "card_in": _sum(sales, "card_amount"),
            # Same formula as the Dashboard / Daily Ledger "closing cash" movement, so the two can never disagree:
            # cash sales + cash added + cash received for settled shop loans - cash purchases - cash supplier
            # payments - cash expenses paid from MAIN (expenses paid from the Cash Deposit account never touched it).
            "net_cash": (
                _sum(sales, "cash_amount")
                + _sum([i for i in invoices if i.category == "cash_adjustment"], "cash_amount")
                + (db.query(func.coalesce(func.sum(LoanEntry.cash_amount), 0.0))
                     .filter(LoanEntry.entry_date == report_date, LoanEntry.status == "active", LoanEntry.entry_type == "settle")
                     .scalar() or 0.0)
                - _sum(purchases, "cash_amount")
                - _sum(payments, "cash_amount")
                - _sum([i for i in expenses if (i.payment_source or "main") != "cash_deposit"], "cash_amount")
            ),
        },
        "sales": [
            {
                "invoice_no": i.invoice_no,
                "contact": i.contact.name if i.contact else None,
                "salesman": i.salesman.name if i.salesman else None,
                "total": i.total_amount,
                "cash": i.cash_amount,
                "card": i.card_amount,
                "weight_21k": i.weight_21k,
                "weight_18k": i.weight_18k,
                "weight_24k": i.weight_24k,
                "weight_silver": i.weight_silver,
            }
            for i in sales
        ],
        "purchases": [
            {
                "invoice_no": i.invoice_no,
                "category": i.category,
                "contact": i.contact.name if i.contact else None,
                "salesman": i.salesman.name if i.salesman else None,
                "total": i.total_amount,
            }
            for i in purchases
        ],
        "expenses": [
            {
                "invoice_no": i.invoice_no,
                "description": i.description,
                "total": i.total_amount,
            }
            for i in expenses
        ],
    }


@router.get("/summary")
def summary_report(
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    db: Session = Depends(get_db),
    _=Depends(_require_reports),
):
    q = db.query(Invoice).filter(Invoice.status == "active")
    if start_date:
        q = q.filter(Invoice.invoice_date >= start_date)
    if end_date:
        q = q.filter(Invoice.invoice_date <= end_date)

    invoices = q.all()
    sales = [i for i in invoices if i.category == "sale"]
    purchases = [i for i in invoices if i.category in ("purchase_jewelry", "purchase_scrap")]

    return {
        "period": {"start": str(start_date) if start_date else None, "end": str(end_date) if end_date else None},
        "total_revenue": sum(i.total_amount for i in sales),
        "total_purchases": sum(i.total_amount for i in purchases),
        "total_invoices": len(invoices),
        "sale_invoices": len(sales),
        # Equivalent grams of gold sold (silver excluded), in the app's own unit (Retail 21K-eq / Bullion 24K-eq) —
        # the same unit the Dashboard, History and the Daily Ledger use in that app.
        "total_gold_grams": sum(
            to_eq(i.weight_24k, i.weight_21k, i.weight_18k)
            for i in sales
        ),
    }


def _period_totals(db: Session, start_date: date, end_date: date):
    """Shared helper — one period's revenue/purchase/expense/profit totals,
    used by the comparison endpoint to build both the "current" and
    "previous" side of the comparison from the same logic."""
    invoices = db.query(Invoice).filter(
        Invoice.status == "active",
        Invoice.invoice_date >= start_date,
        Invoice.invoice_date <= end_date,
    ).all()
    sales = [i for i in invoices if i.category == "sale"]
    purchases = [i for i in invoices if i.category in ("purchase_jewelry", "purchase_scrap")]
    expenses = [i for i in invoices if i.category == "expense"]
    revenue = sum(i.total_amount for i in sales)
    purchase_total = sum(i.total_amount for i in purchases)
    expense_total = sum(i.total_amount for i in expenses)
    return {
        "revenue": revenue,
        "purchases": purchase_total,
        "expenses": expense_total,
        "profit": revenue - purchase_total - expense_total,
        "sale_count": len(sales),
    }


@router.get("/comparison")
def comparison_report(
    mode: str = Query("week", description="'week' or 'month'"),
    db: Session = Depends(get_db),
    _=Depends(_require_reports),
):
    """Compares the current week/month-to-date against the same span of the
    immediately preceding week/month, so the person can see at a glance
    whether business is trending up or down — not just raw totals."""
    today = date.today()
    if mode == "month":
        cur_start = today.replace(day=1)
        # Previous month's start/end, handling year rollover
        prev_end = cur_start - timedelta(days=1)
        prev_start = prev_end.replace(day=1)
        cur_end = today
        # Align the previous period to the SAME number of days elapsed so
        # far this month, for a fair day-count comparison rather than
        # comparing a partial month to a full one.
        days_elapsed = (today - cur_start).days
        prev_end = min(prev_start + timedelta(days=days_elapsed), prev_end)
    else:
        # ISO week: Monday start
        cur_start = today - timedelta(days=today.weekday())
        cur_end = today
        days_elapsed = (today - cur_start).days
        prev_start = cur_start - timedelta(days=7)
        prev_end = prev_start + timedelta(days=days_elapsed)

    current = _period_totals(db, cur_start, cur_end)
    previous = _period_totals(db, prev_start, prev_end)

    def pct_change(cur, prev):
        if prev == 0:
            return None if cur == 0 else 100.0
        return round((cur - prev) / abs(prev) * 100, 1)

    return {
        "mode": mode,
        "current_period": {"start": str(cur_start), "end": str(cur_end)},
        "previous_period": {"start": str(prev_start), "end": str(prev_end)},
        "current": current,
        "previous": previous,
        "change_pct": {
            "revenue": pct_change(current["revenue"], previous["revenue"]),
            "purchases": pct_change(current["purchases"], previous["purchases"]),
            "expenses": pct_change(current["expenses"], previous["expenses"]),
            "profit": pct_change(current["profit"], previous["profit"]),
        },
    }


@router.get("/expense-breakdown")
def expense_breakdown(
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    db: Session = Depends(get_db),
    _=Depends(_require_reports),
):
    """Groups expense invoices by their description text so the person can
    see where cash is actually going (salaries, water, tickets, etc.)
    instead of just one lump 'Expenses' total."""
    q = db.query(Invoice).filter(Invoice.status == "active", Invoice.category == "expense")
    if start_date:
        q = q.filter(Invoice.invoice_date >= start_date)
    if end_date:
        q = q.filter(Invoice.invoice_date <= end_date)
    expenses = q.all()

    groups = {}
    for e in expenses:
        # Group by description; blank/missing descriptions bucket together
        # under "Other" rather than each showing as a separate blank slice.
        key = (e.description or "").strip() or "Other"
        groups.setdefault(key, {"description": key, "total": 0.0, "count": 0})
        groups[key]["total"] += e.total_amount or 0
        groups[key]["count"] += 1

    breakdown = sorted(groups.values(), key=lambda g: g["total"], reverse=True)
    grand_total = sum(g["total"] for g in breakdown)
    for g in breakdown:
        g["pct"] = round(g["total"] / grand_total * 100, 1) if grand_total else 0

    return {
        "period": {"start": str(start_date) if start_date else None, "end": str(end_date) if end_date else None},
        "total": grand_total,
        "breakdown": breakdown,
    }


@router.get("/top-customers")
def top_customers(
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    limit: int = Query(5, ge=1, le=50),
    db: Session = Depends(get_db),
    _=Depends(_require_reports),
):
    """Ranks customers by total sale value in the given period — helps spot
    the shop's best customers for relationship/loyalty purposes."""
    q = db.query(Invoice).filter(Invoice.status == "active", Invoice.category == "sale", Invoice.contact_id.isnot(None))
    if start_date:
        q = q.filter(Invoice.invoice_date >= start_date)
    if end_date:
        q = q.filter(Invoice.invoice_date <= end_date)
    sales = q.all()

    by_contact = {}
    for s in sales:
        cid = s.contact_id
        if cid not in by_contact:
            by_contact[cid] = {"contact_id": cid, "name": s.contact.name if s.contact else "—", "total": 0.0, "invoice_count": 0}
        by_contact[cid]["total"] += s.total_amount or 0
        by_contact[cid]["invoice_count"] += 1

    ranked = sorted(by_contact.values(), key=lambda c: c["total"], reverse=True)[:limit]
    return {"top_customers": ranked}


@router.get("/by-salesman")
def by_salesman(
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    db: Session = Depends(get_db),
    _=Depends(_require_reports),
):
    """Sales and purchases grouped by salesman for the period. Entries with
    no salesman selected are grouped under salesman_id = null."""
    q = db.query(Invoice).filter(
        Invoice.status == "active",
        Invoice.category.in_(("sale", "purchase_jewelry", "purchase_scrap")),
    )
    if start_date:
        q = q.filter(Invoice.invoice_date >= start_date)
    if end_date:
        q = q.filter(Invoice.invoice_date <= end_date)

    rows = {}
    for inv in q.all():
        key = inv.salesman_id
        r = rows.setdefault(key, {
            "salesman_id": key,
            "name": inv.salesman.name if inv.salesman else None,
            "sales_total": 0.0, "sales_count": 0,
            "purchase_total": 0.0, "purchase_count": 0,
        })
        if inv.category == "sale":
            r["sales_total"] += inv.total_amount or 0
            r["sales_count"] += 1
        else:
            r["purchase_total"] += inv.total_amount or 0
            r["purchase_count"] += 1

    ranked = sorted(rows.values(), key=lambda r: r["sales_total"] + r["purchase_total"], reverse=True)
    return {"salesmen": ranked}
