from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload, selectinload
from typing import List, Optional
from datetime import date
from ..core.database import get_db
from ..core.security import get_current_user
from ..core.permissions import has_permission, require_any_permission
from ..models.day_reconciliation import DayReconciliation
from ..models.invoice import Invoice, InvoiceItem
from ..models.activity_log import ActivityLog
from ..models.salesman import Salesman
from ..schemas.invoice import InvoiceCreate, InvoiceUpdate, InvoiceResponse, CancelRequest

router = APIRouter(prefix="/api/invoices", tags=["invoices"])

# _build_response() reads inv.items, inv.contact, inv.created_by, and
# inv.updated_by for every single invoice — without eager loading, each of
# those is a separate lazy-loaded query PER ROW. Listing 300+ invoices was
# silently issuing 1000+ queries. This one .options(...) block collapses
# it back down to a handful of queries total (2 joins + 2 batched
# selectinloads), which is where the real slowdown was coming from.
INVOICE_EAGER_LOAD = (
    joinedload(Invoice.contact),
    joinedload(Invoice.salesman),
    joinedload(Invoice.created_by),
    joinedload(Invoice.updated_by),
    selectinload(Invoice.items),
)


def _build_response(inv: Invoice) -> InvoiceResponse:
    from ..schemas.invoice import InvoiceItemResponse
    items = [
        InvoiceItemResponse(
            id=item.id,
            invoice_id=item.invoice_id,
            metal_type=item.metal_type,
            purity=item.purity,
            weight_grams=item.weight_grams,
            rate_per_gram=item.rate_per_gram,
            line_amount=item.line_amount,
            remarks=item.remarks,
        )
        for item in (inv.items or [])
    ]
    return InvoiceResponse(
        id=inv.id,
        invoice_no=inv.invoice_no,
        invoice_date=inv.invoice_date,
        category=inv.category,
        contact_id=inv.contact_id,
        salesman_id=inv.salesman_id,
        weight_21k=inv.weight_21k,
        weight_18k=inv.weight_18k,
        weight_24k=inv.weight_24k,
        weight_silver=inv.weight_silver,
        amount_21k=inv.amount_21k,
        amount_18k=inv.amount_18k,
        amount_24k=inv.amount_24k,
        amount_silver=inv.amount_silver,
        cash_amount=inv.cash_amount,
        card_amount=inv.card_amount,
        total_amount=inv.total_amount,
        note=inv.note,
        description=inv.description,
        attachment_data=inv.attachment_data,
        attachment_name=inv.attachment_name,
        payment_source=inv.payment_source or "main",
        status=inv.status,
        validity=inv.validity,
        created_by_id=inv.created_by_id,
        updated_by_id=inv.updated_by_id,
        created_at=inv.created_at,
        updated_at=inv.updated_at,
        items=items,
        contact_name=inv.contact.name if inv.contact else None,
        salesman_name=inv.salesman.name if inv.salesman else None,
        created_by_name=inv.created_by.full_name if inv.created_by else None,
        updated_by_name=inv.updated_by.full_name if inv.updated_by else None,
    )


# ── Server-side business rules (the browser enforces these too, but a direct API call must not bypass them) ──
def _money_rules(category, total, cash, card):
    """Sale / expense / cash-added entries are paid in full: cash + card must equal the total."""
    if category in ("sale", "expense", "cash_adjustment"):
        if abs((cash or 0) + (card or 0) - (total or 0)) > 0.011:
            raise HTTPException(
                status_code=400,
                detail=f"Cash ({cash or 0:g}) + card ({card or 0:g}) must equal the total ({total or 0:g}).",
            )


def _ensure_day_editable(db: Session, user, day):
    """Once a day is closed, changing its entries would silently invalidate the counted-cash variance. Only a role
    with the 'day.edit_closed' permission (admin by default) may do it."""
    if user.role and user.role.name == "admin":
        return
    closed = db.query(DayReconciliation.id).filter(DayReconciliation.reconciliation_date == day).first()
    if closed and not has_permission(db, user.role_id, user.role.name, "day.edit_closed"):
        raise HTTPException(
            status_code=400,
            detail=f"{day} is already closed. Only an admin can change entries on a closed day.",
        )


def _deposit_balance(db: Session, exclude_id=None) -> float:
    """Current Cash Deposit account balance (same maths as /cash-deposit/summary)."""
    total = 0.0
    q = db.query(Invoice).filter(Invoice.status == "active")
    for i in q.filter(Invoice.category == "cash_deposit").all():
        if i.id != exclude_id:
            total += i.cash_amount or i.total_amount or 0
    for i in q.filter(Invoice.category == "expense", Invoice.payment_source == "cash_deposit").all():
        if i.id != exclude_id:
            total -= i.cash_amount or i.total_amount or 0
    return total


def _check_deposit_funds(db: Session, category, source, cash, total, exclude_id=None):
    if category == "expense" and source == "cash_deposit":
        need = cash or total or 0
        have = _deposit_balance(db, exclude_id)
        if need > have + 0.005:
            raise HTTPException(
                status_code=400,
                detail=f"The Cash Deposit account only has {have:,.2f} SAR; this expense needs {need:,.2f} SAR.",
            )


@router.get("/count")
def count_invoices(
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    """Lightweight total count — lets the frontend warn when the number of
    invoices is approaching the amount it loads at once, without needing to
    fetch all the data just to find out."""
    return {"total": db.query(Invoice).count()}


# One short prefix per category so a glance at the invoice number alone
# tells you what kind of entry it is — e.g. "SL-2026-0007" is obviously a
# sale, not a supplier payment. Sequence resets each calendar year.
CATEGORY_PREFIX = {
    "sale": "SL",
    "purchase_jewelry": "PJ",
    "purchase_scrap": "PS",
    "supplier_payment": "SP",
    "expense": "EX",
    "cash_adjustment": "CA",
    "cash_deposit": "CD",
}


@router.get("/next-number")
def next_invoice_number(
    category: str = Query(...),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    """Suggests the next sequential invoice number for this category —
    the field stays editable/optional on the frontend, this is just a
    sensible default so cashiers don't have to invent a number by hand."""
    from datetime import datetime
    year = datetime.now().year
    prefix = CATEGORY_PREFIX.get(category, "INV")
    pattern = f"{prefix}-{year}-"

    existing = (
        db.query(Invoice.invoice_no)
        .filter(Invoice.category == category, Invoice.invoice_no.like(f"{pattern}%"))
        .all()
    )
    max_seq = 0
    for (no,) in existing:
        try:
            seq = int(no.split("-")[-1])
            max_seq = max(max_seq, seq)
        except (ValueError, IndexError):
            continue
    next_seq = max_seq + 1
    return {"invoice_no": f"{pattern}{next_seq:04d}"}


@router.get("/daily-summary")
def daily_summary(
    db: Session = Depends(get_db),
    _=Depends(require_any_permission("page.dashboard.view", "page.reports.view", "page.dayhistory.view")),
):
    """Per-day cash/weight totals by category, computed with SQL GROUP BY
    instead of the frontend fetching every individual invoice (up to 2000
    rows) just to sum them in JavaScript. Dashboard uses this for the
    running closing-cash/gold-per-day calculation across the whole
    history; only the currently VIEWED day still needs its full invoice
    list (fetched separately, filtered by date, which is already cheap)."""
    from sqlalchemy import func
    rows = (
        db.query(
            Invoice.invoice_date,
            Invoice.category,
            Invoice.payment_source,
            func.sum(Invoice.cash_amount).label("cash_sum"),
            func.sum(Invoice.total_amount).label("total_sum"),
            func.count(Invoice.id).label("count"),
            func.sum(Invoice.weight_21k).label("w21_sum"),
            func.sum(Invoice.weight_18k).label("w18_sum"),
            func.sum(Invoice.weight_24k).label("w24_sum"),
            func.sum(Invoice.weight_silver).label("wsilver_sum"),
        )
        .filter(Invoice.status != "canceled")
        .group_by(Invoice.invoice_date, Invoice.category, Invoice.payment_source)
        .all()
    )
    by_day = {}
    for invoice_date, category, payment_source, cash_sum, total_sum, count, w21, w18, w24, wsilver in rows:
        day_str = invoice_date.isoformat()
        # An expense paid FROM the separate Cash Deposit account never
        # touched Main's cash — bucket it separately so Main's
        # closing-balance math (which reads by_day[day]['expense']) isn't
        # thrown off by money that was never Main's to begin with.
        key = category
        if category == "expense" and payment_source == "cash_deposit":
            key = "expense_from_deposit"
        bucket = by_day.setdefault(day_str, {}).setdefault(key, {
            "cash": 0.0, "total": 0.0, "count": 0, "w21": 0.0, "w18": 0.0, "w24": 0.0, "wSilver": 0.0,
        })
        bucket["cash"] += float(cash_sum or 0)
        bucket["total"] += float(total_sum or 0)
        bucket["count"] += int(count or 0)
        bucket["w21"] += float(w21 or 0)
        bucket["w18"] += float(w18 or 0)
        bucket["w24"] += float(w24 or 0)
        bucket["wSilver"] += float(wsilver or 0)
    return by_day


@router.get("", response_model=List[InvoiceResponse])
def list_invoices(
    invoice_date: Optional[date] = Query(None),
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    category: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    contact_id: Optional[int] = Query(None),
    search: Optional[str] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(200, ge=1, le=5000),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    q = db.query(Invoice).options(*INVOICE_EAGER_LOAD)
    if invoice_date:
        q = q.filter(Invoice.invoice_date == invoice_date)
    if date_from:
        q = q.filter(Invoice.invoice_date >= date_from)
    if date_to:
        q = q.filter(Invoice.invoice_date <= date_to)
    if category:
        q = q.filter(Invoice.category == category)
    if status:
        q = q.filter(Invoice.status == status)
    if contact_id:
        q = q.filter(Invoice.contact_id == contact_id)
    if search:
        q = q.filter(Invoice.invoice_no.ilike(f"%{search}%"))
    invoices = q.order_by(Invoice.created_at.desc()).offset(skip).limit(limit).all()
    return [_build_response(inv) for inv in invoices]


@router.post("", response_model=InvoiceResponse, status_code=201)
def create_invoice(
    payload: InvoiceCreate,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    # Cashiers can only ever log today's date — this mirrors the disabled
    # date field in the UI, but enforced here too since a direct API call
    # could otherwise bypass a frontend-only restriction.
    if current_user.role and current_user.role.name == "cashier":
        today_str = date.today().isoformat()
        if str(payload.invoice_date) != today_str:
            raise HTTPException(
                status_code=403,
                detail="Cashiers can only create entries dated today.",
            )

    # A closed day's counted-cash variance would silently become wrong if new entries could still be added to it.
    _ensure_day_editable(db, current_user, payload.invoice_date)

    _money_rules(payload.category, payload.total_amount, payload.cash_amount, payload.card_amount)
    _check_deposit_funds(db, payload.category, payload.payment_source, payload.cash_amount, payload.total_amount)

    # Check duplicate invoice_no within the same category (Sale #100 and
    # Purchase #100 are allowed to coexist — matches frontend behavior)
    existing = (
        db.query(Invoice)
        .filter(Invoice.invoice_no == payload.invoice_no, Invoice.category == payload.category)
        .first()
    )
    if existing:
        raise HTTPException(
            status_code=400,
            detail=f"Invoice number '{payload.invoice_no}' already exists for category '{payload.category}'",
        )

    if payload.salesman_id is not None and not db.query(Salesman).filter(Salesman.id == payload.salesman_id).first():
        raise HTTPException(status_code=400, detail="Selected salesman does not exist")
    data = payload.model_dump(exclude={"items"})
    inv = Invoice(**data, created_by_id=current_user.id, status="active", validity="Original")
    db.add(inv)
    db.flush()

    for item_data in (payload.items or []):
        item = InvoiceItem(**item_data.model_dump(), invoice_id=inv.id)
        db.add(item)

    # Activity log
    log = ActivityLog(
        action_type="add",
        invoice_ref=inv.invoice_no,
        category=inv.category,
        amount=inv.total_amount,
        user_id=current_user.id,
    )
    db.add(log)
    db.commit()
    db.refresh(inv)
    return _build_response(inv)


@router.get("/{invoice_id}", response_model=InvoiceResponse)
def get_invoice(
    invoice_id: int,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    inv = db.query(Invoice).options(*INVOICE_EAGER_LOAD).filter(Invoice.id == invoice_id).first()
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    return _build_response(inv)


@router.put("/{invoice_id}", response_model=InvoiceResponse)
def update_invoice(
    invoice_id: int,
    payload: InvoiceUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    if not has_permission(db, current_user.role_id, current_user.role.name, "invoice.edit"):
        raise HTTPException(status_code=403, detail="You don't have permission to edit invoices")
    if current_user.role.name == "supervisor" and not payload.note:
        raise HTTPException(status_code=422, detail="Supervisors must provide a note when editing")

    inv = db.query(Invoice).filter(Invoice.id == invoice_id).first()
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    if inv.status == "canceled":
        raise HTTPException(status_code=400, detail="Cannot edit a canceled invoice")

    update_data = payload.model_dump(exclude={"items"}, exclude_unset=True)
    _ensure_day_editable(db, current_user, inv.invoice_date)
    if update_data.get("invoice_date") is not None:
        _ensure_day_editable(db, current_user, update_data["invoice_date"])
    m_cat = update_data.get("category", inv.category)
    m_total = update_data.get("total_amount", inv.total_amount)
    m_cash = update_data.get("cash_amount", inv.cash_amount)
    m_card = update_data.get("card_amount", inv.card_amount)
    m_src = update_data.get("payment_source", inv.payment_source)
    if any(k in update_data for k in ("category", "total_amount", "cash_amount", "card_amount")):
        _money_rules(m_cat, m_total, m_cash, m_card)
    _check_deposit_funds(db, m_cat, m_src, m_cash, m_total, exclude_id=inv.id)
    if update_data.get("salesman_id") is not None and not db.query(Salesman).filter(Salesman.id == update_data["salesman_id"]).first():
        raise HTTPException(status_code=400, detail="Selected salesman does not exist")

    new_invoice_no = update_data.get("invoice_no", inv.invoice_no)
    new_category = update_data.get("category", inv.category)
    if new_invoice_no != inv.invoice_no or new_category != inv.category:
        dup = (
            db.query(Invoice)
            .filter(
                Invoice.invoice_no == new_invoice_no,
                Invoice.category == new_category,
                Invoice.id != inv.id,
            )
            .first()
        )
        if dup:
            raise HTTPException(
                status_code=400,
                detail=f"Invoice number '{new_invoice_no}' already exists for category '{new_category}'",
            )

    for field, val in update_data.items():
        setattr(inv, field, val)
    inv.validity = "Edited"
    inv.updated_by_id = current_user.id

    if payload.items is not None:
        db.query(InvoiceItem).filter(InvoiceItem.invoice_id == inv.id).delete()
        for item_data in payload.items:
            item = InvoiceItem(**item_data.model_dump(), invoice_id=inv.id)
            db.add(item)

    log = ActivityLog(
        action_type="edit",
        invoice_ref=inv.invoice_no,
        category=inv.category,
        amount=inv.total_amount,
        note=payload.note,
        user_id=current_user.id,
    )
    db.add(log)
    db.commit()
    db.refresh(inv)
    return _build_response(inv)


@router.post("/{invoice_id}/cancel", response_model=InvoiceResponse)
def cancel_invoice(
    invoice_id: int,
    payload: CancelRequest,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    if not has_permission(db, current_user.role_id, current_user.role.name, "invoice.cancel"):
        raise HTTPException(status_code=403, detail="You don't have permission to cancel invoices")
    if current_user.role.name == "supervisor" and not payload.note:
        raise HTTPException(status_code=422, detail="Supervisors must provide a note when canceling")

    inv = db.query(Invoice).filter(Invoice.id == invoice_id).first()
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    if inv.status == "canceled":
        raise HTTPException(status_code=400, detail="Invoice is already canceled")
    _ensure_day_editable(db, current_user, inv.invoice_date)

    inv.status = "canceled"
    inv.note = payload.note or inv.note
    inv.updated_by_id = current_user.id

    log = ActivityLog(
        action_type="cancel",
        invoice_ref=inv.invoice_no,
        category=inv.category,
        amount=inv.total_amount,
        note=payload.note,
        user_id=current_user.id,
    )
    db.add(log)
    db.commit()
    db.refresh(inv)
    return _build_response(inv)


@router.post("/{invoice_id}/reactivate", response_model=InvoiceResponse)
def reactivate_invoice(
    invoice_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Undo a cancel — powers the "Entry canceled — Undo?" toast on the
    frontend. Same permission tier as cancel itself: a cashier can't cancel,
    so a cashier can't un-cancel either."""
    if not has_permission(db, current_user.role_id, current_user.role.name, "invoice.cancel"):
        raise HTTPException(status_code=403, detail="You don't have permission to reactivate invoices")

    inv = db.query(Invoice).filter(Invoice.id == invoice_id).first()
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    if inv.status != "canceled":
        raise HTTPException(status_code=400, detail="Invoice is not canceled")
    _ensure_day_editable(db, current_user, inv.invoice_date)
    _check_deposit_funds(db, inv.category, inv.payment_source, inv.cash_amount, inv.total_amount, exclude_id=inv.id)

    inv.status = "active"
    inv.updated_by_id = current_user.id

    log = ActivityLog(
        action_type="reactivate",
        invoice_ref=inv.invoice_no,
        category=inv.category,
        amount=inv.total_amount,
        note="Restored via Undo",
        user_id=current_user.id,
    )
    db.add(log)
    db.commit()
    db.refresh(inv)
    return _build_response(inv)


@router.delete("/{invoice_id}", status_code=204)
def delete_invoice(
    invoice_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Permanently removes an invoice from the database. Unlike cancel
    (which just flips a status flag and keeps the record for audit),
    this is irreversible — restricted to admin only, regardless of what
    the Permission Groups matrix says for invoice.edit/cancel."""
    if current_user.role.name != "admin":
        raise HTTPException(status_code=403, detail="Only admins can permanently delete invoices")

    inv = db.query(Invoice).filter(Invoice.id == invoice_id).first()
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")

    log = ActivityLog(
        action_type="delete",
        invoice_ref=inv.invoice_no,
        category=inv.category,
        amount=inv.total_amount,
        note=f"Permanently deleted by {current_user.full_name}",
        user_id=current_user.id,
    )
    db.add(log)
    db.query(InvoiceItem).filter(InvoiceItem.invoice_id == invoice_id).delete()
    db.delete(inv)
    db.commit()
    return None
