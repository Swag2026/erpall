from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session
from typing import List
from ..core.database import get_db
from ..core.security import get_current_user
from ..models.salesman import Salesman
from ..schemas.salesman import SalesmanCreate, SalesmanResponse

router = APIRouter(prefix="/api/salesmen", tags=["salesmen"])


@router.get("", response_model=List[SalesmanResponse])
def list_salesmen(
    include_inactive: bool = False,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    q = db.query(Salesman)
    if not include_inactive:
        q = q.filter(Salesman.is_active == True)  # noqa: E712
    return q.order_by(func.lower(Salesman.name)).all()


@router.post("", response_model=SalesmanResponse, status_code=201)
def create_salesman(
    payload: SalesmanCreate,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    """Any logged-in user can add a name on the fly from the entry form.
    Names are unique case-insensitively; re-adding a previously removed
    name simply brings it back instead of creating a duplicate."""
    existing = db.query(Salesman).filter(func.lower(Salesman.name) == payload.name.lower()).first()
    if existing:
        if existing.is_active:
            raise HTTPException(status_code=400, detail=f"Salesman '{existing.name}' already exists")
        existing.is_active = True
        db.commit()
        db.refresh(existing)
        return existing
    s = Salesman(name=payload.name)
    db.add(s)
    db.commit()
    db.refresh(s)
    return s


def _require_manager(current_user):
    if not current_user.role or current_user.role.name not in ("admin", "supervisor"):
        raise HTTPException(status_code=403, detail="Only admins/supervisors can edit or remove a salesman")


@router.put("/{salesman_id}", response_model=SalesmanResponse)
def rename_salesman(
    salesman_id: int,
    payload: SalesmanCreate,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    _require_manager(current_user)
    s = db.query(Salesman).filter(Salesman.id == salesman_id).first()
    if not s:
        raise HTTPException(status_code=404, detail="Salesman not found")
    clash = db.query(Salesman).filter(
        func.lower(Salesman.name) == payload.name.lower(), Salesman.id != salesman_id
    ).first()
    if clash:
        raise HTTPException(status_code=400, detail=f"Salesman '{clash.name}' already exists")
    s.name = payload.name  # invoices reference by id, so old records show the new name
    db.commit()
    db.refresh(s)
    return s


@router.delete("/{salesman_id}", status_code=204)
def deactivate_salesman(
    salesman_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    _require_manager(current_user)
    s = db.query(Salesman).filter(Salesman.id == salesman_id).first()
    if not s:
        raise HTTPException(status_code=404, detail="Salesman not found")
    s.is_active = False  # soft delete: old invoices keep their salesman name
    db.commit()
    return None
