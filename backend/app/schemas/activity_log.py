from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class ActivityLogResponse(BaseModel):
    id: int
    action_type: str
    invoice_no: Optional[str] = None      # frontend uses invoice_no
    invoice_ref: Optional[str] = None     # kept for back-compat
    category: Optional[str] = None
    amount: float = 0.0
    note: Optional[str] = None
    user_id: int
    user_name: Optional[str] = None
    user_role: Optional[str] = None
    user_avatar: Optional[str] = None
    created_at: datetime                  # frontend uses created_at
    timestamp: Optional[datetime] = None  # kept for back-compat

    model_config = {"from_attributes": True}
