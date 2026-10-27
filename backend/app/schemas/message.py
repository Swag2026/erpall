from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime


class MessageCreate(BaseModel):
    recipient_id: Optional[int] = None
    group_id: Optional[int] = None
    body: Optional[str] = None
    attachment_data: Optional[str] = None
    attachment_name: Optional[str] = None


class MessageEdit(BaseModel):
    body: str


class BroadcastCreate(BaseModel):
    body: str


class MessageResponse(BaseModel):
    id: int
    sender_id: int
    recipient_id: Optional[int] = None
    group_id: Optional[int] = None
    sender_name: Optional[str] = None
    body: Optional[str] = None
    attachment_data: Optional[str] = None
    attachment_name: Optional[str] = None
    is_read: bool
    read_by: List[int] = []  # group messages only — user_ids who've seen it (excludes the sender)
    is_broadcast: bool = False
    is_deleted: bool = False
    edited_at: Optional[datetime] = None
    created_at: datetime

    class Config:
        from_attributes = True


class ConversationSummary(BaseModel):
    user_id: int
    full_name: str
    username: str
    last_message: Optional[str] = None
    last_message_at: Optional[datetime] = None
    unread_count: int = 0


class GroupCreate(BaseModel):
    name: str
    member_ids: List[int]


class GroupResponse(BaseModel):
    id: int
    name: str
    created_by: int
    member_ids: List[int] = []
    member_names: List[str] = []
    last_message: Optional[str] = None
    last_message_at: Optional[datetime] = None
    unread_count: int = 0
    created_at: datetime

    class Config:
        from_attributes = True
