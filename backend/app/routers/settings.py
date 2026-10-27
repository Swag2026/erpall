from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Dict
from pydantic import BaseModel
from ..core.database import get_db
from ..core.security import get_current_user
from ..core.permissions import PERMISSIONS, DEFAULT_PERMISSIONS, has_permission
from ..models.app_setting import AppSetting
from ..models.user import Role, RolePermission
from ..schemas.setting import SettingResponse, BulkSettingsUpdate

router = APIRouter(prefix="/api/settings", tags=["settings"])


@router.get("", response_model=List[SettingResponse])
def get_settings(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if current_user.role.name != "admin" and not has_permission(db, current_user.role_id, current_user.role.name, "page.settings.view"):
        raise HTTPException(status_code=403, detail="You don't have permission to view settings")
    return db.query(AppSetting).all()


@router.put("", response_model=List[SettingResponse])
def update_settings(
    payload: BulkSettingsUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    if current_user.role.name != "admin" and not has_permission(db, current_user.role_id, current_user.role.name, "settings.manage"):
        raise HTTPException(status_code=403, detail="You don't have permission to update settings")
    for key, value in payload.settings.items():
        setting = db.query(AppSetting).filter(AppSetting.key == key).first()
        if setting:
            setting.value = str(value)
        else:
            db.add(AppSetting(key=key, value=str(value)))
    db.commit()
    return db.query(AppSetting).all()


# ── Permission Groups — who's allowed to do what ─────────────────────────

class PermissionsUpdate(BaseModel):
    # { "supervisor": { "invoice.edit": true, ... }, "cashier": {...} }
    permissions: Dict[str, Dict[str, bool]]


@router.get("/permissions")
def get_permissions(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if current_user.role.name != "admin":
        raise HTTPException(status_code=403, detail="Only admins can view permission groups")

    roles = db.query(Role).all()
    matrix = {}
    for role in roles:
        matrix[role.name] = {}
        for key, _, _ in PERMISSIONS:
            matrix[role.name][key] = has_permission(db, role.id, role.name, key)

    return {
        "roles": [r.name for r in roles],
        "permissions": [{"key": k, "label": label, "description": desc} for k, label, desc in PERMISSIONS],
        "matrix": matrix,
    }


@router.put("/permissions")
def update_permissions(
    payload: PermissionsUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    if current_user.role.name != "admin":
        raise HTTPException(status_code=403, detail="Only admins can edit permission groups")

    valid_keys = {k for k, _, _ in PERMISSIONS}
    for role_name, perms in payload.permissions.items():
        if role_name == "admin":
            continue  # admin is always fully permitted, not editable — prevents locking yourself out
        role = db.query(Role).filter(Role.name == role_name).first()
        if not role:
            continue
        for key, allowed in perms.items():
            if key not in valid_keys:
                continue
            row = db.query(RolePermission).filter(
                RolePermission.role_id == role.id, RolePermission.permission_key == key
            ).first()
            if row:
                row.allowed = bool(allowed)
            else:
                db.add(RolePermission(role_id=role.id, permission_key=key, allowed=bool(allowed)))
    db.commit()
    return get_permissions(db, current_user)
