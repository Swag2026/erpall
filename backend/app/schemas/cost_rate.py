from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class CostRateBase(BaseModel):
    purity: str
    cost_per_gram: float


class CostRateCreate(CostRateBase):
    pass


class CostRateUpdate(BaseModel):
    cost_per_gram: float


class CostRateResponse(CostRateBase):
    id: int
    is_active: bool
    updated_at: datetime

    model_config = {"from_attributes": True}
