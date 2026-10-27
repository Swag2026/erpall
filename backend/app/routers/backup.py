import json
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
from ..core.database import get_db
from ..core.security import get_current_user
from ..models.invoice import Invoice, InvoiceItem
from ..models.contact import Contact
from ..models.activity_log import ActivityLog

router = APIRouter(prefix="/api/backup", tags=["backup"])


def _require_admin(current_user=Depends(get_current_user)):
    if current_user.role.name != "admin":
        raise HTTPException(status_code=403, detail="Only admins can perform backup/restore")
    return current_user


# Everything stored by the app is exported (every column of every table), so a
# JSON backup can rebuild history, edit trails, attachments, day open/close,
# chat, users and settings. Only secrets are left out: password hashes and
# browser push-subscription keys / login-attempt records.
_SKIP_COLUMNS = {"users": {"hashed_password"}}


def _plain(v):
    import base64, datetime, decimal
    if v is None or isinstance(v, (bool, int, float, str)):
        return v
    if isinstance(v, (datetime.datetime, datetime.date, datetime.time)):
        return v.isoformat()
    if isinstance(v, decimal.Decimal):
        return float(v)
    if isinstance(v, (bytes, bytearray)):
        return base64.b64encode(bytes(v)).decode()
    return str(v)


def _dump(db: Session, model):
    from sqlalchemy import inspect
    table = model.__table__
    skip = _SKIP_COLUMNS.get(table.name, set())
    cols = [c.key for c in inspect(model).mapper.column_attrs if c.columns[0].name not in skip]
    pk = table.primary_key.columns.values()[0] if table.primary_key.columns else None
    q = db.query(model)
    if pk is not None:
        q = q.order_by(pk)
    return [{k: _plain(getattr(row, k)) for k in cols} for row in q.all()]


@router.get("/export")
def export_backup(db: Session = Depends(get_db), _=Depends(_require_admin)):
    from ..models.user import Role, RolePermission, User
    from ..models.salesman import Salesman
    from ..models.app_setting import AppSetting
    from ..models.cost_rate import CostRate
    from ..models.day_opening import DayOpening
    from ..models.day_reconciliation import DayReconciliation
    from ..models.supplier_payment import SupplierPayment
    from ..models.expense import Expense
    from ..models.message import Message, Group, GroupMember, MessageReadReceipt
    from ..models.call import Call, CallParticipant
    from ..models.shop_loan import LoanShop, LoanEntry

    models = {
        "invoices": Invoice, "invoice_items": InvoiceItem, "contacts": Contact,
        "salesmen": Salesman, "activity_logs": ActivityLog,
        "day_openings": DayOpening, "day_reconciliations": DayReconciliation,
        "supplier_payments": SupplierPayment, "expenses": Expense,
        "cost_rates": CostRate, "app_settings": AppSetting,
        "roles": Role, "role_permissions": RolePermission, "users": User,
        "groups": Group, "group_members": GroupMember,
        "messages": Message, "message_read_receipts": MessageReadReceipt,
        "calls": Call, "call_participants": CallParticipant,
        "loan_shops": LoanShop, "loan_entries": LoanEntry,
    }
    data = {
        "exported_at": str(__import__("datetime").datetime.utcnow()),
        "format_version": 2,
    }
    for key, model in models.items():
        data[key] = _dump(db, model)
    data["row_counts"] = {k: len(data[k]) for k in models}

    return JSONResponse(content=data, headers={
        "Content-Disposition": "attachment; filename=swag-gold-backup.json"
    })


@router.get("/health")
def health():
    return {"status": "ok"}
