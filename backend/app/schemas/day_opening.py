from pydantic import BaseModel
from typing import Optional
from datetime import date, datetime


class DayOpeningUpsert(BaseModel):
    opening_cash: float = 0.0
    opening_gold: float = 0.0
    opening_silver: float = 0.0


class DayOpeningResponse(BaseModel):
    opening_date: date
    opening_cash: float
    opening_gold: float
    opening_silver: float
    updated_by_name: Optional[str] = None
    updated_at: Optional[datetime] = None

    model_config = {"from_attributes": True}
