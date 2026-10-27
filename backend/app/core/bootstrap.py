"""Idempotent start-up helpers."""
import os
from sqlalchemy.exc import SQLAlchemyError
from ..models.user import Role, User

BASE_ROLES = (
    ("admin", "Full access"),
    ("supervisor", "Supervisor"),
    ("cashier", "Cashier"),
)


def ensure_roles() -> None:
    """Make sure the three standard roles exist in BOTH databases (a brand-new app database starts empty).
    Never touches existing rows. Users are NOT created here — use scripts/sync_users.py or the Users page."""
    from .database import session_makers
    for app_name, maker in session_makers.items():
        db = maker()
        try:
            have = {r.name for r in db.query(Role).all()}
            for name, desc in BASE_ROLES:
                if name not in have:
                    db.add(Role(name=name, description=desc))
            db.commit()
        except SQLAlchemyError as exc:  # pragma: no cover - must never block start-up
            db.rollback()
            print(f"[bootstrap:{app_name}] could not ensure roles: {exc}")
        finally:
            db.close()


def ensure_bootstrap_admin() -> None:
    """OPTIONAL first-login helper for a brand-new (empty) deployment, e.g. a Railway test.

    Only acts when BOTH env vars are set:  BOOTSTRAP_ADMIN_USERNAME  and  BOOTSTRAP_ADMIN_PASSWORD
    It creates that admin (same username + password) in BOTH databases — but only in a database that has NO users yet,
    so it can never overwrite or reset a real account. Remove the two variables once real users exist."""
    username = os.getenv("BOOTSTRAP_ADMIN_USERNAME", "").strip()
    password = os.getenv("BOOTSTRAP_ADMIN_PASSWORD", "")
    if not username or not password:
        return
    from .database import session_makers
    from .security import hash_password
    for app_name, maker in session_makers.items():
        db = maker()
        try:
            if db.query(User).count() > 0:
                continue
            admin = db.query(Role).filter(Role.name == "admin").first()
            if not admin:
                continue
            db.add(User(username=username, full_name=username.title(), hashed_password=hash_password(password),
                        role_id=admin.id, is_active=True, must_change_password=False))
            db.commit()
            print(f"[bootstrap:{app_name}] created first admin '{username}'")
        except SQLAlchemyError as exc:  # pragma: no cover
            db.rollback()
            print(f"[bootstrap:{app_name}] could not create admin: {exc}")
        finally:
            db.close()
