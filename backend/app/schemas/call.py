from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel


class CallCreate(BaseModel):
    recipient_id: Optional[int] = None
    group_id: Optional[int] = None
    call_type: str = "video"  # "video" | "audio"


class CallRespond(BaseModel):
    action: str  # "accept" | "decline"


class ParticipantOut(BaseModel):
    user_id: int
    full_name: Optional[str] = None
    joined_at: Optional[datetime] = None
    left_at: Optional[datetime] = None
    declined: bool = False

    class Config:
        from_attributes = True


class CallOut(BaseModel):
    id: int
    initiator_id: int
    recipient_id: Optional[int] = None
    group_id: Optional[int] = None
    call_type: str
    status: str
    started_at: datetime
    ended_at: Optional[datetime] = None
    participants: List[ParticipantOut] = []

    class Config:
        from_attributes = True


class IceServersOut(BaseModel):
    ice_servers: List[dict]
