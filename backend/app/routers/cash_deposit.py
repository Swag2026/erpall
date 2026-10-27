from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import Optional
from datetime import date
from ..core.database import get_db
from ..core.security import get_current_user
from ..core.permissions import has_permission
from ..models.invoice import Invoice

router = APIRouter(prefix="/api/cash-deposit", tags=["cash-deposit"])


def _require_view(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not has_permission(db, current_user.role_id, current_user.role.name, "page.cashdeposit.view"):
        raise HTTPException(status_code=403, detail="You don't have permission to view Cash Deposit")
    return current_user


@router.get("/summary")
def cash_deposit_summary(
    db: Session = Depends(get_db),
    _=Depends(_require_view),
):
    """Current Cash Deposit balance and its full running history — a
    separate cash pool from the shop's Main cash balance. Money enters it
    via a 'cash_deposit' invoice (a deposit), and can leave it when an
    expense is deliberately paid FROM this account instead of Main (chosen
    at expense-entry time via payment_source='cash_deposit')."""
    deposits = (
        db.query(Invoice)
        .filter(Invoice.category == "cash_deposit", Invoice.status == "active")
        .all()
    )
    expenses_from_deposit = (
        db.query(Invoice)
        .filter(Invoice.category == "expense", Invoice.payment_source == "cash_deposit", Invoice.status == "active")
        .all()
    )

    # Build one combined, chronologically-sorted ledger so the running
    # balance column is meaningful (each row shows the balance AFTER that
    # transaction, not just an unordered list of amounts).
    rows = []
    for d in deposits:
        rows.append({
            "date": d.invoice_date, "type": "deposit", "invoice_no": d.invoice_no,
            "amount": d.cash_amount or d.total_amount or 0, "description": d.description,
            "created_by": d.created_by.full_name if d.created_by else None,
            "_sort": (d.invoice_date, d.created_at or d.invoice_date),
        })
    for e in expenses_from_deposit:
        rows.append({
            "date": e.invoice_date, "type": "expense", "invoice_no": e.invoice_no,
            "amount": e.cash_amount or e.total_amount or 0, "description": e.description,
            "created_by": e.created_by.full_name if e.created_by else None,
            "_sort": (e.invoice_date, e.created_at or e.invoice_date),
        })
    rows.sort(key=lambda r: r["_sort"])

    running = 0.0
    history = []
    for r in rows:
        if r["type"] == "deposit":
            running += r["amount"]
        else:
            running -= r["amount"]
        history.append({
            "date": str(r["date"]), "type": r["type"], "invoice_no": r["invoice_no"],
            "amount": r["amount"], "description": r["description"],
            "created_by": r["created_by"], "balance_after": running,
        })

    total_deposited = sum(d.cash_amount or d.total_amount or 0 for d in deposits)
    total_spent = sum(e.cash_amount or e.total_amount or 0 for e in expenses_from_deposit)

    return {
        "balance": total_deposited - total_spent,
        "total_deposited": total_deposited,
        "total_spent": total_spent,
        # Newest first for display; the running-balance calc above already
        # needed chronological order to compute correctly.
        "history": list(reversed(history)),
    }
