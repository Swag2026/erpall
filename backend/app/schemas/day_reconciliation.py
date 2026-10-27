from pydantic import BaseModel
from typing import Optional
from datetime import date, datetime


class ReconciliationUpsert(BaseModel):
    system_closing_cash: float
    counted_cash: float
    note: Optional[str] = None


class ReopenPayload(BaseModel):
    reason: str


class ReconciliationResponse(BaseModel):
    reconciliation_date: date
    system_closing_cash: float
    counted_cash: float
    variance: float
    note: Optional[str] = None
    reconciled_by_name: Optional[str] = None
    reconciled_at: Optional[datetime] = None

    model_config = {"from_attributes": True}
