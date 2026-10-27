"""Dynamic, admin-editable permissions.

Instead of scattering `if role.name == "cashier": raise ...` across every
router, every gated action has a permission key here. An admin can flip any
of these per role from Settings → Team & Access, and it takes effect
immediately — no code change or redeploy needed.

DEFAULT_PERMISSIONS mirrors exactly what the app enforced before this system
existed, so turning this on changes nothing until an admin actually edits it.
"""
from fastapi import Depends, HTTPException
from sqlalchemy.orm import Session
from ..core.database import get_db
from ..core.security import get_current_user

# (key, human label, description) — shown as rows in the Settings matrix.
# Split into two groups: PAGE ACCESS (can this role even open the page) and
# ACTIONS (finer-grained capabilities within pages everyone can reach).
PERMISSIONS = [
    # ── Page access — one row per page in the sidebar ──
    ("page.dashboard.view", "View Dashboard", "Access the main Dashboard (daily summary, cash/gold balances)."),
    ("page.history.view", "View History page", "Access the invoice History / ledger page."),
    ("page.activity.view", "View Activity Log", "Access the Activity Log (audit trail) page."),
    ("page.analytics.view", "View Analytics page", "Access the Analytics charts page."),
    ("page.reports.view", "View Reports page", "Access the Reports page."),
    ("page.contacts.view", "View Contacts page", "Access the Contacts (customers/suppliers) page."),
    ("page.profitcalc.view", "View Profit Calculator", "Access the Profit Calculator page."),
    ("page.external_sync.view", "View External Sync page", "Access the External ERP balance sync page."),
    ("page.dayhistory.view", "View Day Open/Close History", "See who opened/closed each day, opening & counted cash, and any variance."),
    ("page.cashdeposit.view", "View Cash Deposit", "Access the separate Cash Deposit account balance and history."),
    ("page.settings.view", "View Settings page", "Access the Settings page (read-only if settings.manage is off)."),
    ("page.users.view", "View Users page", "Access the Users (staff accounts) page."),
    ("page.loans.view", "View Shop Loans", "Open the Shop Loans page (gold lent to other shops and what is still out)."),
    ("chat.use", "Use chat / messaging", "Send and receive direct messages and group chats."),
    ("chat.broadcast", "Send announcements", "Send a broadcast announcement to all staff."),

    # ── Actions — finer-grained capabilities ──
    ("invoice.edit", "Edit invoices", "Change an already-saved sale/purchase/payment/expense entry."),
    ("invoice.cancel", "Cancel invoices", "Cancel (soft-delete) an invoice, or undo a cancel."),
    ("contacts.manage", "Manage contacts", "Add or edit customers/suppliers (page.contacts.view controls just viewing)."),
    ("settings.manage", "Manage settings & backup", "Edit cost rates, download backups, change system settings."),
    ("users.manage", "Manage users", "Create, edit, or disable staff accounts."),
    ("day.open", "Set day opening balance", "Enter or change the opening cash / gold / silver of a day (Dashboard)."),
    ("day.close", "Close the day", "Close a day by entering the counted cash (Dashboard)."),
    ("day.edit_closed", "Edit entries on a closed day", "Edit or cancel invoices dated on a day that has already been closed."),
    ("day.reopen", "Reopen a closed day", "Remove a day's close (reconciliation) record so entries can be added again. A reason is required and it is logged."),
    ("loans.manage", "Manage shop loans", "Lend gold to a shop, record returns and settlements, add shops, cancel entries."),
]

DEFAULT_PERMISSIONS = {
    "admin": {k: True for k, _, _ in PERMISSIONS},
    "supervisor": {
        "page.dashboard.view": True,
        "page.history.view": True, "page.activity.view": True, "page.analytics.view": True,
        "page.reports.view": True, "page.contacts.view": True, "page.profitcalc.view": True,
        "page.external_sync.view": True, "page.settings.view": True, "page.users.view": False,
        "page.dayhistory.view": True,
        "page.cashdeposit.view": True,
        "page.loans.view": True,
        "chat.use": True, "chat.broadcast": False,
        "invoice.edit": True, "invoice.cancel": True,
        "contacts.manage": True, "settings.manage": True, "users.manage": False,
        "loans.manage": True,
        "day.open": True, "day.close": True, "day.edit_closed": False,
    },
    "cashier": {
        # Per business request: cashier sees Entry (always accessible, no
        # gate), History, and Cash Deposit (money deposit report) — every
        # other page, including Dashboard, stays off by default.
        "page.dashboard.view": False,
        "page.history.view": True, "page.activity.view": False, "page.analytics.view": False,
        "page.reports.view": False, "page.contacts.view": False, "page.profitcalc.view": False,
        "page.external_sync.view": False, "page.settings.view": False, "page.users.view": False,
        "page.dayhistory.view": False,
        "page.cashdeposit.view": True,
        "page.loans.view": False,
        "chat.use": True, "chat.broadcast": False,
        "invoice.edit": False, "invoice.cancel": False,
        "contacts.manage": False, "settings.manage": False, "users.manage": False,
        "loans.manage": False,
        "day.open": False, "day.close": False, "day.edit_closed": False,
    },
}


def has_permission(db: Session, role_id: int, role_name: str, key: str) -> bool:
    from ..models.user import RolePermission
    row = db.query(RolePermission).filter(
        RolePermission.role_id == role_id, RolePermission.permission_key == key
    ).first()
    if row is not None:
        return row.allowed
    # No row yet (fresh install before first seed/edit) — fall back to the
    # same defaults the app always used, so behavior never silently changes.
    return DEFAULT_PERMISSIONS.get(role_name, {}).get(key, False)


def has_any_permission(db: Session, user, keys) -> bool:
    """True if the user is an admin or holds at least one of the given permission keys."""
    if user.role.name == "admin":
        return True
    return any(has_permission(db, user.role_id, user.role.name, k) for k in keys)


def require_any_permission(*keys: str):
    """FastAPI dependency: 403 unless the user holds at least one of these permission keys (admins pass)."""
    def _dep(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
        if not has_any_permission(db, current_user, keys):
            raise HTTPException(status_code=403, detail="You don't have permission to do this")
        return current_user
    return _dep


def require_permission(key: str):
    """FastAPI dependency: 403s unless the current user's role is granted
    this permission key. Admins implicitly pass everything."""
    def _dep(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
        if current_user.role.name == "admin":
            return current_user
        if not has_permission(db, current_user.role_id, current_user.role.name, key):
            raise HTTPException(status_code=403, detail="You don't have permission to do this")
        return current_user
    return _dep
