from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session, joinedload
from typing import List, Optional
from ..core.database import get_db
from ..core.security import get_current_user
from ..models.activity_log import ActivityLog
from ..models.user import User
from ..schemas.activity_log import ActivityLogResponse

router = APIRouter(prefix="/api/activity-logs", tags=["activity-logs"])


@router.get("/count")
def count_activity_logs(
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    """Sidebar badge just needs a number — this avoids pulling the full
    (eager-loaded, user+role joined) list purely to read len() off it,
    which was happening on every single page navigation across the app."""
    return {"total": db.query(ActivityLog).count()}


@router.get("", response_model=List[ActivityLogResponse])
def list_activity_logs(
    action_type: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    since_id: Optional[int] = Query(None, description="Only return logs with id > since_id — used for notification polling."),
    skip: int = Query(0, ge=0),
    limit: int = Query(500, ge=1, le=5000),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    # user.role is accessed below for every row — without eager-loading
    # BOTH hops, this was issuing 2 separate lazy-load queries per log
    # entry (one for the user, one more for that user's role).
    q = db.query(ActivityLog).options(joinedload(ActivityLog.user).joinedload(User.role))
    if action_type and action_type != "all":
        q = q.filter(ActivityLog.action_type == action_type)
    if search:
        q = q.filter(ActivityLog.invoice_ref.ilike(f"%{search}%"))
    if since_id is not None:
        q = q.filter(ActivityLog.id > since_id)
    logs = q.order_by(ActivityLog.timestamp.desc()).offset(skip).limit(limit).all()

    result = []
    for log in logs:
        ts = log.timestamp
        result.append(ActivityLogResponse(
            id=log.id,
            action_type=log.action_type,
            invoice_no=log.invoice_ref,     # frontend uses invoice_no
            invoice_ref=log.invoice_ref,
            category=log.category,
            amount=log.amount or 0.0,
            note=log.note,
            user_id=log.user_id,
            user_name=log.user.full_name if log.user else None,
            user_role=log.user.role.name if log.user else None,
            user_avatar=log.user.avatar if log.user else None,
            created_at=ts,                  # frontend uses created_at
            timestamp=ts,
        ))
    return result
