"""Gold/silver lent to other shops for the day ("shop loans").

Everything here is additive: its own tables, its own endpoints. Nothing in
invoices/contacts is read or changed. The Dashboard and Daily Ledger pick the
effect up through GET /api/shop-loans/daily-summary (see frontend lib/ledger.js).
"""
import json
from datetime import date
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from ..core.database import get_db
from ..core.permissions import require_permission, require_any_permission
from ..core.security import get_current_user
from ..models.activity_log import ActivityLog
from ..models.shop_loan import LoanShop, LoanEntry
from ..schemas.shop_loan import (
    ShopCreate, ShopResponse, EntryCreate, EntryResponse, CancelPayload, Piece,
)

router = APIRouter(prefix="/api/shop-loans", tags=["shop-loans"])

view_perm = require_permission("page.loans.view")
manage_perm = require_permission("loans.manage")

KEYS = ("weight_24k", "weight_21k", "weight_18k", "weight_silver")
LABEL = {"weight_24k": "24K", "weight_21k": "21K", "weight_18k": "18K", "weight_silver": "Silver"}
EPS = 0.0005
SIGN = {"lend": 1.0, "return": -1.0, "settle": -1.0}


from ..core.tenant import to_eq, eq_karat


def _k24eq(w24, w21, w18):
    """Gold-equivalent grams in the CURRENT app's unit (Retail = 21K-eq, Bullion = 24K-eq)."""
    return to_eq(w24, w21, w18)


def _eq_fields(prefix: str, value: float) -> dict:
    """The frontends read `<prefix>_21k_eq` (Retail) or `<prefix>_24k_eq` (Bullion); fill only the current app's key."""
    return {f"{prefix}_{eq_karat()}k_eq": value}


def _eq(e):
    return round(_k24eq(e.weight_24k, e.weight_21k, e.weight_18k), 3)


def _zero():
    return {k: 0.0 for k in KEYS}


def _balance(entries):
    """grams still with the shop, per metal, from a list of ACTIVE entries."""
    bal = _zero()
    for e in entries:
        s = SIGN[e.entry_type]
        for k in KEYS:
            bal[k] += s * (getattr(e, k) or 0.0)
    return {k: round(v, 3) for k, v in bal.items()}


def _active_entries(db, shop_id, exclude_id=None):
    q = db.query(LoanEntry).filter(LoanEntry.shop_id == shop_id, LoanEntry.status == "active")
    if exclude_id:
        q = q.filter(LoanEntry.id != exclude_id)
    return q.order_by(LoanEntry.created_at, LoanEntry.id).all()


def _shop_response(shop, entries):
    act = [e for e in entries if e.status == "active"]
    act.sort(key=lambda e: (e.created_at, e.id))
    bal = _zero()
    open_since = None
    for e in act:
        s = SIGN[e.entry_type]
        for k in KEYS:
            bal[k] += s * (getattr(e, k) or 0.0)
        owes = any(v > EPS for v in bal.values())
        if owes and open_since is None:
            open_since = e.created_at
        if not owes:
            open_since = None
    bal = {k: round(v, 3) for k, v in bal.items()}
    lends = [e for e in act if e.entry_type == "lend" and e.expected_return_time]
    return ShopResponse(
        id=shop.id, name=shop.name, phone=shop.phone, is_active=shop.is_active, credit_limit=shop.credit_limit,
        balance={"w24": bal["weight_24k"], "w21": bal["weight_21k"], "w18": bal["weight_18k"], "silver": bal["weight_silver"]},
        **_eq_fields("balance", round(_k24eq(bal["weight_24k"], bal["weight_21k"], bal["weight_18k"]), 3)),
        open_since=open_since if any(v > EPS for v in bal.values()) else None,
        last_activity=act[-1].created_at if act else None,
        expected_return_time=lends[-1].expected_return_time if lends else None,
        entry_count=len(act),
    )


def _summary(e, extra=None):
    """Human line for the Activity Log: '21K 5g, 18K 3g | cash 305.00 | user note' (amount column stays cash-only)."""
    parts = [f"{LABEL[k]} {getattr(e, k):g}g" for k in KEYS if (getattr(e, k) or 0) > 0]
    line = ", ".join(parts)
    if e.cash_amount:
        line += f" | cash {e.cash_amount:.2f}"
    if extra:
        line += f" | {extra}"
    return line


def _entry_response(e, with_attachment=False):
    try:
        pieces = [Piece(**p) for p in (json.loads(e.pieces) if e.pieces else [])]
    except Exception:
        pieces = []
    return EntryResponse(
        id=e.id, shop_id=e.shop_id, shop_name=e.shop.name if e.shop else "",
        entry_type=e.entry_type, entry_date=e.entry_date, occurred_at=e.created_at,
        weight_24k=e.weight_24k or 0, weight_21k=e.weight_21k or 0, weight_18k=e.weight_18k or 0,
        weight_silver=e.weight_silver or 0, **_eq_fields("weight", _eq(e)),
        cash_amount=e.cash_amount or 0, rate=e.rate, settle_kind=e.settle_kind,
        expected_return_time=e.expected_return_time, taken_by=e.taken_by, note=e.note,
        pieces=pieces, has_attachment=bool(e.attachment_data),
        attachment_data=e.attachment_data if with_attachment else None,
        attachment_name=e.attachment_name, status=e.status, cancel_note=e.cancel_note,
        created_by_name=e.created_by.full_name if e.created_by else None,
        updated_by_name=e.updated_by.full_name if e.updated_by else None,
    )


def _check_not_negative(bal):
    for k in KEYS:
        if bal[k] < -EPS:
            return k
    return None


# ── Shops ────────────────────────────────────────────────────────────────

@router.get("/shops", response_model=List[ShopResponse])
def list_shops(include_inactive: bool = False, db: Session = Depends(get_db), _=Depends(view_perm)):
    q = db.query(LoanShop)
    if not include_inactive:
        q = q.filter(LoanShop.is_active == True)  # noqa: E712
    shops = q.order_by(func.lower(LoanShop.name)).all()
    by_shop = {}
    for e in db.query(LoanEntry).filter(LoanEntry.shop_id.in_([s.id for s in shops] or [0])).all():
        by_shop.setdefault(e.shop_id, []).append(e)
    return [_shop_response(s, by_shop.get(s.id, [])) for s in shops]


@router.post("/shops", response_model=ShopResponse, status_code=201)
def create_shop(payload: ShopCreate, db: Session = Depends(get_db), _=Depends(manage_perm)):
    existing = db.query(LoanShop).filter(func.lower(LoanShop.name) == payload.name.lower()).first()
    if existing:
        if existing.is_active:
            raise HTTPException(status_code=400, detail=f"Shop '{existing.name}' already exists")
        existing.is_active = True
        if payload.phone:
            existing.phone = payload.phone
        if payload.credit_limit is not None:
            existing.credit_limit = payload.credit_limit
        db.commit()
        db.refresh(existing)
        return _shop_response(existing, db.query(LoanEntry).filter(LoanEntry.shop_id == existing.id).all())
    s = LoanShop(name=payload.name, phone=payload.phone, credit_limit=payload.credit_limit)
    db.add(s)
    db.commit()
    db.refresh(s)
    return _shop_response(s, [])


@router.put("/shops/{shop_id}", response_model=ShopResponse)
def update_shop(shop_id: int, payload: ShopCreate, db: Session = Depends(get_db), _=Depends(manage_perm)):
    s = db.query(LoanShop).filter(LoanShop.id == shop_id).first()
    if not s:
        raise HTTPException(status_code=404, detail="Shop not found")
    clash = db.query(LoanShop).filter(func.lower(LoanShop.name) == payload.name.lower(), LoanShop.id != shop_id).first()
    if clash:
        raise HTTPException(status_code=400, detail=f"Shop '{clash.name}' already exists")
    s.name = payload.name
    s.phone = payload.phone
    s.credit_limit = payload.credit_limit
    db.commit()
    db.refresh(s)
    return _shop_response(s, db.query(LoanEntry).filter(LoanEntry.shop_id == s.id).all())


@router.delete("/shops/{shop_id}", status_code=204)
def deactivate_shop(shop_id: int, db: Session = Depends(get_db), _=Depends(manage_perm)):
    s = db.query(LoanShop).filter(LoanShop.id == shop_id).first()
    if not s:
        raise HTTPException(status_code=404, detail="Shop not found")
    bal = _balance(_active_entries(db, s.id))
    if any(abs(v) > EPS for v in bal.values()):
        raise HTTPException(status_code=400, detail="This shop still has gold or silver outstanding. Settle it first.")
    s.is_active = False  # soft delete — history keeps the name
    db.commit()
    return None


# ── Entries ──────────────────────────────────────────────────────────────

@router.get("/entries", response_model=List[EntryResponse])
def list_entries(
    shop_id: Optional[int] = Query(None),
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    include_canceled: bool = True,
    limit: int = Query(500, ge=1, le=5000),
    db: Session = Depends(get_db),
    _=Depends(view_perm),
):
    q = db.query(LoanEntry).options(
        joinedload(LoanEntry.shop), joinedload(LoanEntry.created_by), joinedload(LoanEntry.updated_by)
    )
    if shop_id:
        q = q.filter(LoanEntry.shop_id == shop_id)
    if date_from:
        q = q.filter(LoanEntry.entry_date >= date_from)
    if date_to:
        q = q.filter(LoanEntry.entry_date <= date_to)
    if not include_canceled:
        q = q.filter(LoanEntry.status == "active")
    rows = q.order_by(LoanEntry.created_at.desc(), LoanEntry.id.desc()).limit(limit).all()
    return [_entry_response(e) for e in rows]


@router.get("/entries/{entry_id}", response_model=EntryResponse)
def get_entry(entry_id: int, db: Session = Depends(get_db), _=Depends(view_perm)):
    e = db.query(LoanEntry).options(
        joinedload(LoanEntry.shop), joinedload(LoanEntry.created_by), joinedload(LoanEntry.updated_by)
    ).filter(LoanEntry.id == entry_id).first()
    if not e:
        raise HTTPException(status_code=404, detail="Entry not found")
    return _entry_response(e, with_attachment=True)


@router.post("/entries", response_model=EntryResponse, status_code=201)
def create_entry(payload: EntryCreate, db: Session = Depends(get_db), current_user=Depends(manage_perm)):
    if current_user.role and current_user.role.name == "cashier" and str(payload.entry_date) != date.today().isoformat():
        raise HTTPException(status_code=403, detail="Cashiers can only create entries dated today.")
    # Lock the shop row so two people entering at the same moment can't both
    # pass the "enough outstanding" check below.
    shop = db.query(LoanShop).filter(LoanShop.id == payload.shop_id).with_for_update().first()
    if not shop or not shop.is_active:
        raise HTTPException(status_code=400, detail="Selected shop does not exist")

    if payload.entry_type in ("return", "settle"):
        bal = _balance(_active_entries(db, shop.id))
        for k in KEYS:
            want = getattr(payload, k)
            if want > bal[k] + EPS:
                have = max(bal[k], 0.0)
                raise HTTPException(
                    status_code=400,
                    detail=f"{shop.name} only has {have:g} g of {LABEL[k]} outstanding (you entered {want:g} g).",
                )

    if payload.entry_type == "lend" and shop.credit_limit:
        bal = _balance(_active_entries(db, shop.id))
        after = _k24eq(bal["weight_24k"] + payload.weight_24k, bal["weight_21k"] + payload.weight_21k,
                       bal["weight_18k"] + payload.weight_18k)
        if after > shop.credit_limit + EPS:
            is_admin = bool(current_user.role and current_user.role.name == "admin")
            if not (payload.override_limit and is_admin):
                raise HTTPException(
                    status_code=400,
                    detail=f"Credit limit exceeded: {shop.name} may hold up to {shop.credit_limit:g} g ({eq_karat()}K-eq); "
                           f"this lend would bring it to {after:.3f} g."
                           + ("" if is_admin else " Ask an admin to approve."),
                )

    pieces = json.dumps([p.model_dump() for p in payload.pieces], ensure_ascii=False) if payload.pieces else None
    e = LoanEntry(
        shop_id=shop.id, entry_type=payload.entry_type, entry_date=payload.entry_date,
        weight_24k=payload.weight_24k, weight_21k=payload.weight_21k,
        weight_18k=payload.weight_18k, weight_silver=payload.weight_silver,
        cash_amount=payload.cash_amount, rate=payload.rate, settle_kind=payload.settle_kind,
        expected_return_time=payload.expected_return_time, taken_by=(payload.taken_by or None),
        note=payload.note or None, pieces=pieces,
        attachment_data=payload.attachment_data, attachment_name=payload.attachment_name,
        status="active", created_by_id=current_user.id,
    )
    db.add(e)
    db.flush()
    db.add(ActivityLog(
        action_type=f"loan_{e.entry_type}", invoice_ref=f"LN-{e.id} · {shop.name}"[:100],
        category="shop_loan", amount=e.cash_amount or 0.0, note=_summary(e, payload.note), user_id=current_user.id,
    ))
    db.commit()
    e = db.query(LoanEntry).options(joinedload(LoanEntry.shop), joinedload(LoanEntry.created_by), joinedload(LoanEntry.updated_by)).filter(LoanEntry.id == e.id).first()
    return _entry_response(e)


@router.post("/entries/{entry_id}/cancel", response_model=EntryResponse)
def cancel_entry(entry_id: int, payload: CancelPayload, db: Session = Depends(get_db), current_user=Depends(manage_perm)):
    e = db.query(LoanEntry).filter(LoanEntry.id == entry_id).first()
    if not e:
        raise HTTPException(status_code=404, detail="Entry not found")
    db.query(LoanShop).filter(LoanShop.id == e.shop_id).with_for_update().first()
    if e.status == "canceled":
        raise HTTPException(status_code=400, detail="Entry is already canceled")
    if current_user.role.name == "supervisor" and not payload.note:
        raise HTTPException(status_code=422, detail="Supervisors must provide a note when canceling")
    # Canceling a lend must not leave later returns larger than what was lent.
    bad = _check_not_negative(_balance(_active_entries(db, e.shop_id, exclude_id=e.id)))
    if bad:
        raise HTTPException(status_code=400, detail=f"Can't cancel: later returns/settlements already exceed the {LABEL[bad]} left. Cancel those first.")
    e.status = "canceled"
    e.cancel_note = payload.note
    e.updated_by_id = current_user.id
    db.add(ActivityLog(
        action_type="loan_cancel", invoice_ref=f"LN-{e.id} · {e.shop.name}"[:100],
        category="shop_loan", amount=e.cash_amount or 0.0, note=_summary(e, payload.note), user_id=current_user.id,
    ))
    db.commit()
    e = db.query(LoanEntry).options(joinedload(LoanEntry.shop), joinedload(LoanEntry.created_by), joinedload(LoanEntry.updated_by)).filter(LoanEntry.id == e.id).first()
    return _entry_response(e)


@router.post("/entries/{entry_id}/reactivate", response_model=EntryResponse)
def reactivate_entry(entry_id: int, db: Session = Depends(get_db), current_user=Depends(manage_perm)):
    e = db.query(LoanEntry).filter(LoanEntry.id == entry_id).first()
    if not e:
        raise HTTPException(status_code=404, detail="Entry not found")
    db.query(LoanShop).filter(LoanShop.id == e.shop_id).with_for_update().first()
    if e.status != "canceled":
        raise HTTPException(status_code=400, detail="Entry is not canceled")
    e.status = "active"
    bad = _check_not_negative(_balance(_active_entries(db, e.shop_id)))
    if bad:
        db.rollback()
        raise HTTPException(status_code=400, detail=f"Can't restore: it would return more {LABEL[bad]} than the shop has.")
    e.updated_by_id = current_user.id
    db.add(ActivityLog(
        action_type="reactivate", invoice_ref=f"LN-{e.id} · {e.shop.name}"[:100],
        category="shop_loan", amount=e.cash_amount or 0.0, note="Restored via Undo", user_id=current_user.id,
    ))
    db.commit()
    e = db.query(LoanEntry).options(joinedload(LoanEntry.shop), joinedload(LoanEntry.created_by), joinedload(LoanEntry.updated_by)).filter(LoanEntry.id == e.id).first()
    return _entry_response(e)


# ── Feeds the Dashboard / Daily Ledger ───────────────────────────────────

@router.get("/daily-summary")
def daily_summary(db: Session = Depends(get_db), _=Depends(require_any_permission("page.dashboard.view", "page.reports.view", "page.dayhistory.view", "page.loans.view"))):
    """Per-day metal and cash movement of ACTIVE loan entries, same key names as
    /invoices/daily-summary: { 'YYYY-MM-DD': { lend|return|settle: {w21,w18,w24,wSilver,cash,count} } }"""
    rows = (
        db.query(
            LoanEntry.entry_date, LoanEntry.entry_type,
            func.coalesce(func.sum(LoanEntry.weight_21k), 0.0), func.coalesce(func.sum(LoanEntry.weight_18k), 0.0),
            func.coalesce(func.sum(LoanEntry.weight_24k), 0.0), func.coalesce(func.sum(LoanEntry.weight_silver), 0.0),
            func.coalesce(func.sum(LoanEntry.cash_amount), 0.0), func.count(LoanEntry.id),
        )
        .filter(LoanEntry.status == "active")
        .group_by(LoanEntry.entry_date, LoanEntry.entry_type)
        .all()
    )
    out = {}
    for d, t, w21, w18, w24, ws, cash, n in rows:
        out.setdefault(str(d), {})[t] = {"w21": w21, "w18": w18, "w24": w24, "wSilver": ws, "cash": cash, "count": n}
    return out
