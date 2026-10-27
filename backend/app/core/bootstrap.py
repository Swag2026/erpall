"""Idempotent start-up helpers."""
from sqlalchemy.exc import SQLAlchemyError
from ..models.user import Role

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
