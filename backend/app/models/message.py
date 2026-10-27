from sqlalchemy import Column, Integer, String, Text, ForeignKey, DateTime, Boolean, UniqueConstraint
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from ..core.database import Base


class Group(Base):
    """A named group chat with multiple members — separate from 1-on-1
    direct messages and from admin broadcasts. Anyone in the group can post;
    membership is managed by whoever created it (or an admin)."""
    __tablename__ = "groups"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(120), nullable=False)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    creator = relationship("User", foreign_keys=[created_by])


class GroupMember(Base):
    __tablename__ = "group_members"

    id = Column(Integer, primary_key=True, index=True)
    group_id = Column(Integer, ForeignKey("groups.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    joined_at = Column(DateTime(timezone=True), server_default=func.now())

    user = relationship("User", foreign_keys=[user_id])

    __table_args__ = (UniqueConstraint("group_id", "user_id", name="uq_group_member"),)


class Message(Base):
    """A single message — either a direct message (recipient_id set) or a
    group message (group_id set), never both. Broadcasts reuse the DM path
    (one row per recipient) since that already fans out cleanly."""
    __tablename__ = "messages"

    id = Column(Integer, primary_key=True, index=True)
    sender_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    recipient_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    group_id = Column(Integer, ForeignKey("groups.id"), nullable=True)
    body = Column(Text, nullable=True)
    # Small attachments (images, receipts) stored inline as a base64 data
    # URL — there's no separate object-storage service in this deployment,
    # and exhibition-floor chat attachments are small (a photo of a piece,
    # a screenshot), so this keeps things simple without adding infra.
    attachment_data = Column(Text, nullable=True)
    attachment_name = Column(String(255), nullable=True)
    is_read = Column(Boolean, default=False, nullable=False)
    is_broadcast = Column(Boolean, default=False, nullable=False)
    is_deleted = Column(Boolean, default=False, nullable=False)
    edited_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    sender = relationship("User", foreign_keys=[sender_id])
    recipient = relationship("User", foreign_keys=[recipient_id])
    group = relationship("Group", foreign_keys=[group_id])


class MessageReadReceipt(Base):
    """Per-user read tracking for GROUP messages. A DM only has one other
    party, so Message.is_read already covers it — but a group message
    needs to know *which* members have seen it (for a "seen by 3" style
    receipt), not just whether at least one of them has."""
    __tablename__ = "message_read_receipts"

    id = Column(Integer, primary_key=True, index=True)
    message_id = Column(Integer, ForeignKey("messages.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    read_at = Column(DateTime(timezone=True), server_default=func.now())

    user = relationship("User", foreign_keys=[user_id])

    __table_args__ = (UniqueConstraint("message_id", "user_id", name="uq_message_read_receipt"),)
