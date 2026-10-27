from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload
from typing import List
from datetime import date as date_type
from ..core.database import get_db
from ..core.security import get_current_user
from ..core.permissions import has_any_permission, require_permission
from ..core.ledger_server import closing_cash
from ..models.day_reconciliation import DayReconciliation
from ..models.activity_log import ActivityLog
from ..schemas.day_reconciliation import ReconciliationUpsert, ReconciliationResponse, ReopenPayload

router = APIRouter(prefix="/api/reconciliations", tags=["reconciliations"])


def _build_response(r: DayReconciliation) -> ReconciliationResponse:
    return ReconciliationResponse(
        reconciliation_date=r.reconciliation_date,
        system_closing_cash=r.system_closing_cash,
        counted_cash=r.counted_cash,
        variance=r.variance,
        note=r.note,
        reconciled_by_name=r.reconciled_by.full_name if r.reconciled_by else None,
        reconciled_at=r.reconciled_at,
    )


@router.get("", response_model=List[ReconciliationResponse])
def list_reconciliations(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    rows = db.query(DayReconciliation).options(joinedload(DayReconciliation.reconciled_by)).order_by(DayReconciliation.reconciliation_date.desc()).all()
    out = [_build_response(r) for r in rows]
    # Entry/Day Workflow only need to know WHICH days are closed. Amounts and variances are for the roles that can
    # see balances (Dashboard / Day History / Reports).
    if not has_any_permission(db, current_user, ("page.dashboard.view", "page.dayhistory.view", "page.reports.view")):
        for r in out:
            r.system_closing_cash = r.counted_cash = r.variance = 0.0
            r.note = None
            r.reconciled_by_name = None
    return out


@router.put("/{reconciliation_date}", response_model=ReconciliationResponse)
def upsert_reconciliation(
    reconciliation_date: date_type,
    payload: ReconciliationUpsert,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("day.close")),
):
    if payload.counted_cash != payload.counted_cash or abs(payload.counted_cash) > 1e9:
        raise HTTPException(status_code=422, detail="Counted cash is not a valid number")
    # The expected cash is computed HERE from the books, never trusted from the browser, so a closed day's
    # variance can't be faked by sending a matching number.
    system_cash = closing_cash(db, reconciliation_date)
    row = db.query(DayReconciliation).filter(DayReconciliation.reconciliation_date == reconciliation_date).first()
    if not row:
        row = DayReconciliation(reconciliation_date=reconciliation_date)
        db.add(row)
    row.system_closing_cash = system_cash
    row.counted_cash = payload.counted_cash
    row.variance = round(payload.counted_cash - system_cash, 2)
    row.note = payload.note
    row.reconciled_by_id = current_user.id

    # Traceable in Activity Log — who closed this day, and whether the
    # counted cash matched the system's expected total. Previously this
    # action left no audit trail at all outside the reconciliations table.
    variance_note = f"Day closed. System: {system_cash}, Counted: {payload.counted_cash}, Variance: {row.variance}"
    if payload.note:
        variance_note += f" | {payload.note}"
    log = ActivityLog(
        action_type="day_close",
        invoice_ref=str(reconciliation_date),
        category="day_close",
        amount=row.variance,
        note=variance_note,
        user_id=current_user.id,
    )
    db.add(log)

    db.commit()
    db.refresh(row)
    return _build_response(row)


@router.post("/{reconciliation_date}/reopen")
def reopen_day(
    reconciliation_date: date_type,
    payload: ReopenPayload,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("day.reopen")),
):
    """Reopen a closed day: removes that day's close (reconciliation) record so
    entries can be added again. Nothing else is touched (no invoices, openings
    or cash figures). The old close figures are kept in the Activity Log note,
    and the day can be closed again later from the Dashboard."""
    reason = (payload.reason or "").strip()
    if len(reason) < 3:
        raise HTTPException(status_code=422, detail="A reason is required to reopen a day")
    row = db.query(DayReconciliation).filter(DayReconciliation.reconciliation_date == reconciliation_date).first()
    if not row:
        raise HTTPException(status_code=404, detail="This day is not closed")
    closer = row.reconciled_by.full_name if row.reconciled_by else "unknown"
    snapshot = (
        f"Day reopened. Previous close: system {row.system_closing_cash}, counted {row.counted_cash}, "
        f"variance {row.variance}, closed by {closer}"
    )
    if row.note:
        snapshot += f", note: {row.note}"
    snapshot += f" | Reason: {reason}"
    db.add(ActivityLog(
        action_type="day_reopen",
        invoice_ref=str(reconciliation_date),
        category="day_close",
        amount=row.variance,
        note=snapshot[:2000],
        user_id=current_user.id,
    ))
    db.delete(row)
    db.commit()
    return {"ok": True, "reconciliation_date": str(reconciliation_date)}
