from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload
from typing import List
from datetime import date as date_type
from ..core.database import get_db
from ..core.security import get_current_user
from ..core.permissions import has_any_permission, require_permission
from ..models.activity_log import ActivityLog
from ..models.day_opening import DayOpening
from ..schemas.day_opening import DayOpeningUpsert, DayOpeningResponse

router = APIRouter(prefix="/api/day-openings", tags=["day-openings"])


def _build_response(row: DayOpening) -> DayOpeningResponse:
    return DayOpeningResponse(
        opening_date=row.opening_date,
        opening_cash=row.opening_cash,
        opening_gold=row.opening_gold,
        opening_silver=row.opening_silver,
        updated_by_name=row.updated_by.full_name if row.updated_by else None,
        updated_at=row.updated_at,
    )


# Pages that legitimately show opening/closing balances. Anyone else (e.g. a cashier) only needs to know WHICH days
# have an opening (Day Workflow), never the amounts.
BALANCE_VIEW_PERMS = ("page.dashboard.view", "page.dayhistory.view", "page.reports.view")


@router.get("", response_model=List[DayOpeningResponse])
def list_day_openings(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    rows = db.query(DayOpening).options(joinedload(DayOpening.updated_by)).order_by(DayOpening.opening_date.asc()).all()
    out = [_build_response(r) for r in rows]
    if not has_any_permission(db, current_user, BALANCE_VIEW_PERMS):
        for o in out:
            o.opening_cash = o.opening_gold = o.opening_silver = 0.0
            o.updated_by_name = None
    return out


@router.put("/{opening_date}", response_model=DayOpeningResponse)
def upsert_day_opening(
    opening_date: date_type,
    payload: DayOpeningUpsert,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("day.open")),
):
    for v in (payload.opening_cash, payload.opening_gold, payload.opening_silver):
        if v != v or abs(v) > 1e9:
            raise HTTPException(status_code=422, detail="Opening balance is not a valid number")
    row = db.query(DayOpening).filter(DayOpening.opening_date == opening_date).first()
    old = (row.opening_cash, row.opening_gold, row.opening_silver) if row else None
    if not row:
        row = DayOpening(opening_date=opening_date)
        db.add(row)
    # Audit trail: changing an opening balance shifts every balance after it, so it must be traceable.
    db.add(ActivityLog(
        action_type="day_open", invoice_ref=str(opening_date), category="day_open",
        amount=payload.opening_cash,
        note=(f"Opening set: cash {payload.opening_cash:g}, gold {payload.opening_gold:g}g, silver {payload.opening_silver:g}g"
              + (f" (was cash {old[0] or 0:g}, gold {old[1] or 0:g}g, silver {old[2] or 0:g}g)" if old else "")),
        user_id=current_user.id,
    ))
    row.opening_cash = payload.opening_cash
    row.opening_gold = payload.opening_gold
    row.opening_silver = payload.opening_silver
    row.updated_by_id = current_user.id
    db.commit()
    db.refresh(row)
    return _build_response(row)
