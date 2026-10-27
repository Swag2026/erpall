from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from ..core.database import get_db, db_for
from ..core.tenant import APPS, current_app
from ..core.security import get_current_user, hash_password
from ..core.permissions import has_permission, require_permission
from ..models.user import User, Role
from ..schemas.user import UserCreate, UserUpdate, UserResponse
from .auth import sync_password_to_other_apps

router = APIRouter(prefix="/api/users", tags=["users"])


def _require_view(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if current_user.role.name != "admin" and not has_permission(db, current_user.role_id, current_user.role.name, "page.users.view"):
        raise HTTPException(status_code=403, detail="You don't have permission to view users")
    return current_user


def _get_role_or_404(db: Session, role_name: str) -> Role:
    role = db.query(Role).filter(Role.name == role_name).first()
    if not role:
        raise HTTPException(status_code=400, detail=f"Role '{role_name}' does not exist")
    return role


def _build_response(u: User) -> UserResponse:
    return UserResponse(
        id=u.id,
        username=u.username,
        full_name=u.full_name,
        role=u.role.name,
        is_active=u.is_active,
        created_at=u.created_at,
        must_change_password=u.must_change_password,
        avatar=u.avatar,
    )


@router.get("", response_model=List[UserResponse])
def list_users(
    db: Session = Depends(get_db),
    _=Depends(_require_view),
):
    users = db.query(User).order_by(User.created_at.asc()).all()
    return [_build_response(u) for u in users]


@router.post("", response_model=UserResponse, status_code=201)
def create_user(
    payload: UserCreate,
    db: Session = Depends(get_db),
    _=Depends(require_permission("users.manage")),
):
    existing = db.query(User).filter(User.username == payload.username).first()
    if existing:
        raise HTTPException(status_code=400, detail=f"Username '{payload.username}' already exists")

    role = _get_role_or_404(db, payload.role)
    user = User(
        username=payload.username,
        full_name=payload.full_name,
        hashed_password=hash_password(payload.password),
        role_id=role.id,
        is_active=True,
        must_change_password=True,  # admin-set password — force them to pick their own
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    # Optional: give the same person access to the other app(s) with the SAME username + password. Their role there
    # is set here too (it must exist in that app); each app keeps its own roles/permissions afterwards.
    for other_app in (payload.also_in or []):
        if other_app not in APPS or other_app == current_app():
            continue
        with db_for(other_app) as odb:
            if odb.query(User).filter(User.username == payload.username).first():
                continue  # already has an account there
            orole = odb.query(Role).filter(Role.name == payload.role).first()
            if not orole:
                continue
            odb.add(User(
                username=payload.username, full_name=payload.full_name, hashed_password=user.hashed_password,
                role_id=orole.id, is_active=True, must_change_password=True,
            ))
            odb.commit()
    return _build_response(user)


@router.put("/{user_id}", response_model=UserResponse)
def update_user(
    user_id: int,
    payload: UserUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("users.manage")),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    is_self = user.id == current_user.id
    if is_self and (payload.role is not None or payload.is_active is False):
        raise HTTPException(status_code=400, detail="You cannot change your own role or disable your own account")

    if payload.full_name is not None:
        user.full_name = payload.full_name
    if payload.password:
        user.hashed_password = hash_password(payload.password)
        if not is_self:
            user.must_change_password = True  # admin reset someone else's password
    if payload.role is not None:
        role = _get_role_or_404(db, payload.role)
        user.role_id = role.id
    if payload.is_active is not None:
        user.is_active = payload.is_active

    db.commit()
    db.refresh(user)
    if payload.password:
        # same password everywhere: mirror an admin reset into the other app(s) too
        sync_password_to_other_apps(user.username, user.hashed_password, must_change=not is_self)
    return _build_response(user)


@router.delete("/{user_id}", status_code=204)
def deactivate_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("users.manage")),
):
    """Soft-disable: keeps the user row (and all their invoices/activity log
    attribution) intact, just blocks future logins."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.id == current_user.id:
        raise HTTPException(status_code=400, detail="You cannot disable your own account")

    user.is_active = False
    db.commit()
