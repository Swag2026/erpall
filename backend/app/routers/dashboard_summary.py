"""
Dashboard/sidebar aggregate endpoints.

FIX (duplicate-request audit): Layout.jsx's sidebar badges were fetching
three separate count endpoints every 20 seconds — /invoices/count,
/activity-logs/count, /contacts/count — three round-trips for three small
numbers. This combines them into one request.
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from ..core.database import get_db
from ..core.security import get_current_user
from ..models.invoice import Invoice
from ..models.activity_log import ActivityLog
from ..models.contact import Contact

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


@router.get("/badge-counts")
def badge_counts(db: Session = Depends(get_db), _=Depends(get_current_user)):
    return {
        "invoices": db.query(Invoice).count(),
        "activity_logs": db.query(ActivityLog).count(),
        "contacts": db.query(Contact).filter(Contact.is_active == True).count(),
    }
