from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from ..core.database import get_db
from ..core.security import get_current_user
from ..core.permissions import has_permission, require_any_permission
from ..models.cost_rate import CostRate
from ..schemas.cost_rate import CostRateCreate, CostRateUpdate, CostRateResponse

router = APIRouter(prefix="/api/cost-rates", tags=["cost-rates"])


@router.get("", response_model=List[CostRateResponse])
def list_cost_rates(db: Session = Depends(get_db), _=Depends(require_any_permission("page.settings.view", "page.profitcalc.view", "settings.manage"))):
    return db.query(CostRate).filter(CostRate.is_active == True).all()


@router.post("", response_model=CostRateResponse, status_code=201)
def create_cost_rate(
    payload: CostRateCreate,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    if not has_permission(db, current_user.role_id, current_user.role.name, "settings.manage"):
        raise HTTPException(status_code=403, detail="You don't have permission to change cost rates")
    existing = db.query(CostRate).filter(CostRate.purity == payload.purity).first()
    if existing:
        existing.cost_per_gram = payload.cost_per_gram
        db.commit()
        db.refresh(existing)
        return existing
    rate = CostRate(**payload.model_dump())
    db.add(rate)
    db.commit()
    db.refresh(rate)
    return rate


@router.put("/{rate_id}", response_model=CostRateResponse)
def update_cost_rate(
    rate_id: int,
    payload: CostRateUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    if not has_permission(db, current_user.role_id, current_user.role.name, "settings.manage"):
        raise HTTPException(status_code=403, detail="You don't have permission to change cost rates")
    rate = db.query(CostRate).filter(CostRate.id == rate_id).first()
    if not rate:
        raise HTTPException(status_code=404, detail="Cost rate not found")
    rate.cost_per_gram = payload.cost_per_gram
    db.commit()
    db.refresh(rate)
    return rate
