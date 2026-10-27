from datetime import datetime, timedelta, timezone
from typing import List
from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session
from ..core.database import get_db, db_for
from ..core.tenant import APPS, TenantDict, current_app
from ..core.security import verify_password, hash_password, create_access_token, get_current_user
from ..models.user import User
from ..models.login_attempt import LoginAttempt
from ..core.rate_limit import limiter
from ..schemas.auth import (
    LoginRequest, TokenResponse, UserMe, ChangePasswordRequest, LoginAttemptResponse, ProfileUpdate, SwitchRequest,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])

MAX_FAILED_ATTEMPTS = 5
LOCKOUT_MINUTES = 5

# ── Online presence (in-memory) ──────────────────────────────────────────
# A single-process deployment (one uvicorn worker) is assumed here, which
# holds for this app's scale — so a plain in-memory dict is enough to power
# a "who's online" indicator without needing Redis or a DB table. Frontend
# calls POST /heartbeat every ~30s while a tab is open; anyone whose last
# heartbeat is within ONLINE_WINDOW_SECONDS counts as online.
ONLINE_WINDOW_SECONDS = 90
_last_seen = TenantDict()   # namespaced per app: Retail user 5 and Bullion user 5 are different people


def _client_ip(request: Request) -> str:
    # Railway (and most PaaS) sit behind a proxy — the real client IP is in
    # X-Forwarded-For, not request.client.host (which would be the proxy).
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def sync_password_to_other_apps(username: str, hashed: str, must_change: bool) -> List[str]:
    """Copy a password hash to the same username in every OTHER app's database. Returns the apps that were updated."""
    done = []
    me = current_app()
    for app_name in APPS:
        if app_name == me:
            continue
        try:
            with db_for(app_name) as other:
                u = other.query(User).filter(User.username == username).first()
                if u:
                    u.hashed_password = hashed
                    u.must_change_password = must_change
                    u.failed_login_attempts = 0
                    u.locked_until = None
                    other.commit()
                    done.append(app_name)
        except Exception as exc:  # pragma: no cover - the other DB being down must not block this change
            print(f"[password-sync] could not update {app_name}: {exc}")
    return done


def _log_attempt(db: Session, username: str, success: bool, ip: str, reason: str = None):
    db.add(LoginAttempt(username=username, success=success, ip_address=ip, reason=reason))
    db.commit()


def _accessible_apps(username: str) -> List[str]:
    """Every app in which this username exists and is active (= the apps the switcher may offer)."""
    from ..models.user import User as _User
    found = []
    for app_name in APPS:
        try:
            with db_for(app_name) as other:
                if other.query(_User.id).filter(_User.username == username, _User.is_active == True).first():
                    found.append(app_name)
        except Exception:  # an unreachable database must not break login for the other app
            continue
    return found


def _token_response(user: User, app_name: str) -> TokenResponse:
    token = create_access_token({"sub": str(user.id), "app": app_name})
    return TokenResponse(
        access_token=token,
        user_id=user.id,
        username=user.username,
        full_name=user.full_name,
        role=user.role.name,
        must_change_password=user.must_change_password,
        avatar=user.avatar,
        app=app_name,
        apps=_accessible_apps(user.username),
    )


@router.post("/login", response_model=TokenResponse)
@limiter.limit("10/minute")
def login(request: Request, payload: LoginRequest):
    app_name = (payload.app or request.headers.get("x-app") or "").strip().lower()
    if app_name not in APPS:
        raise HTTPException(status_code=400, detail="Unknown app. Use 'retail' or 'bullion'.")
    ip = _client_ip(request)

    with db_for(app_name) as db:
        user = db.query(User).filter(User.username == payload.username, User.is_active == True).first()

        # Generic invalid-credentials response either way — never reveal whether the username exists.
        invalid_creds = HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password",
        )

        if user and user.locked_until and user.locked_until > datetime.now(timezone.utc):
            remaining = int((user.locked_until - datetime.now(timezone.utc)).total_seconds() // 60) + 1
            _log_attempt(db, payload.username, False, ip, "locked")
            raise HTTPException(
                status_code=status.HTTP_423_LOCKED,
                detail=f"Too many failed attempts. Try again in {remaining} minute(s).",
            )

        if not user or not verify_password(payload.password, user.hashed_password):
            if user:
                user.failed_login_attempts = (user.failed_login_attempts or 0) + 1
                if user.failed_login_attempts >= MAX_FAILED_ATTEMPTS:
                    user.locked_until = datetime.now(timezone.utc) + timedelta(minutes=LOCKOUT_MINUTES)
                    user.failed_login_attempts = 0
                db.commit()
            _log_attempt(db, payload.username, False, ip, "invalid_password")
            raise invalid_creds

        # Successful login — clear any lockout state
        user.failed_login_attempts = 0
        user.locked_until = None
        db.commit()
        _log_attempt(db, payload.username, True, ip)
        return _token_response(user, app_name)


@router.get("/apps")
def my_apps(current_user=Depends(get_current_user)):
    """Which apps the logged-in username can switch to (drives the switcher in the UI)."""
    return {"current": current_app(), "apps": _accessible_apps(current_user.username)}


@router.post("/switch", response_model=TokenResponse)
def switch_app(request: Request, payload: SwitchRequest, current_user=Depends(get_current_user)):
    """Switch to the other app WITHOUT typing the password again.

    The caller already proved who they are (valid token of the current app). Access to the target app is simply
    "this username exists and is active in the target app's own user table" — the role and permissions there are the
    target app's own. Nothing from the current database is copied across."""
    target = (payload.app or "").strip().lower()
    if target not in APPS:
        raise HTTPException(status_code=400, detail="Unknown app")
    if target == current_app():
        raise HTTPException(status_code=400, detail="You are already in this app")
    ip = _client_ip(request)
    with db_for(target) as db:
        other = db.query(User).filter(User.username == current_user.username, User.is_active == True).first()
        if not other:
            raise HTTPException(status_code=403, detail=f"Your account has no access to {target.title()}")
        if other.locked_until and other.locked_until > datetime.now(timezone.utc):
            raise HTTPException(status_code=423, detail=f"Your {target.title()} account is temporarily locked")
        _log_attempt(db, other.username, True, ip, f"switch from {current_app()}")
        return _token_response(other, target)


@router.get("/me", response_model=UserMe)
def me(current_user=Depends(get_current_user)):
    _last_seen[current_user.id] = datetime.now(timezone.utc)
    return UserMe(
        id=current_user.id,
        username=current_user.username,
        full_name=current_user.full_name,
        role=current_user.role.name,
        is_active=current_user.is_active,
        must_change_password=current_user.must_change_password,
        avatar=current_user.avatar,
        email=current_user.email,
        phone=current_user.phone,
    )


@router.get("/my-permissions")
def my_permissions(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    """Every logged-in user needs to know what THEY can do (to hide nav
    items, gate buttons, etc.) — but only admins can see/edit the FULL
    matrix for every role (that's /settings/permissions). This is the
    self-service, read-only version of the same data."""
    from ..core.permissions import PERMISSIONS, has_permission
    is_admin = current_user.role.name == "admin"
    return {
        key: True if is_admin else has_permission(db, current_user.role_id, current_user.role.name, key)
        for key, _, _ in PERMISSIONS
    }


@router.post("/heartbeat")
def heartbeat(current_user=Depends(get_current_user)):
    """Cheap presence ping — the frontend calls this every ~30s while the
    app is open in a tab. Powers the "who's online" sidebar indicator."""
    _last_seen[current_user.id] = datetime.now(timezone.utc)
    return {"ok": True}


@router.get("/online")
def online_users(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    cutoff = datetime.now(timezone.utc) - timedelta(seconds=ONLINE_WINDOW_SECONDS)
    online_ids = [uid for uid, seen in _last_seen.items() if seen >= cutoff]
    if not online_ids:
        return []
    users = db.query(User).filter(User.id.in_(online_ids)).all()
    return [{"id": u.id, "full_name": u.full_name, "username": u.username, "role": u.role.name} for u in users]


@router.put("/profile", response_model=UserMe)
def update_profile(
    payload: ProfileUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Self-service profile update — any logged-in user can edit their own
    name, email, phone, and profile picture (but not their role/username,
    which stay admin-controlled via /api/users)."""
    if payload.full_name is not None and payload.full_name.strip():
        current_user.full_name = payload.full_name.strip()
    if payload.email is not None:
        current_user.email = payload.email.strip() or None
    if payload.phone is not None:
        current_user.phone = payload.phone.strip() or None
    if payload.avatar is not None:
        current_user.avatar = payload.avatar or None
    db.commit()
    db.refresh(current_user)
    return UserMe(
        id=current_user.id,
        username=current_user.username,
        full_name=current_user.full_name,
        role=current_user.role.name,
        is_active=current_user.is_active,
        must_change_password=current_user.must_change_password,
        avatar=current_user.avatar,
        email=current_user.email,
        phone=current_user.phone,
    )


@router.post("/change-password")
def change_password(
    payload: ChangePasswordRequest,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    if not verify_password(payload.current_password, current_user.hashed_password):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    new_hash = hash_password(payload.new_password)
    current_user.hashed_password = new_hash
    current_user.must_change_password = False
    db.commit()
    # One user id / password for both apps: mirror the new password into every other app where this username exists.
    sync_password_to_other_apps(current_user.username, new_hash, must_change=False)
    return {"detail": "Password changed successfully"}


@router.get("/login-attempts", response_model=List[LoginAttemptResponse])
def list_login_attempts(
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    if current_user.role.name != "admin":
        raise HTTPException(status_code=403, detail="Only admins can view login history")
    return (
        db.query(LoginAttempt)
        .order_by(LoginAttempt.created_at.desc())
        .limit(min(limit, 500))
        .all()
    )
