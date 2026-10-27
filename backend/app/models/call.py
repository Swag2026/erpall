from sqlalchemy import Column, Integer, String, ForeignKey, DateTime
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from ..core.database import Base


class Call(Base):
    """A voice/video call — either 1-on-1 (recipient_id set) or a group
    call (group_id set), mirroring how Message already splits DM vs
    group. Group calls use a mesh topology (every participant connects
    directly to every other participant), so there's no separate media
    server (SFU) to run — fine for the small group sizes this app's
    groups actually have. Signaling (who's calling who, offer/answer/ICE
    exchange) is relayed over a websocket; the actual audio/video never
    passes through this server."""
    __tablename__ = "calls"

    id = Column(Integer, primary_key=True, index=True)
    initiator_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    recipient_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    group_id = Column(Integer, ForeignKey("groups.id"), nullable=True)
    call_type = Column(String(10), nullable=False, default="video")  # "video" | "audio"
    # ringing -> active -> ended, or ringing -> declined/missed
    status = Column(String(20), nullable=False, default="ringing")
    started_at = Column(DateTime(timezone=True), server_default=func.now())
    ended_at = Column(DateTime(timezone=True), nullable=True)

    initiator = relationship("User", foreign_keys=[initiator_id])
    recipient = relationship("User", foreign_keys=[recipient_id])
    group = relationship("Group", foreign_keys=[group_id])


class CallParticipant(Base):
    """One row per user invited to a call. For a DM call there are two
    rows (initiator + recipient); for a group call, one per group member
    at the time the call started. `joined_at` stays null until they
    actually accept, so ringing vs joined is a simple null-check."""
    __tablename__ = "call_participants"

    id = Column(Integer, primary_key=True, index=True)
    call_id = Column(Integer, ForeignKey("calls.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    joined_at = Column(DateTime(timezone=True), nullable=True)
    left_at = Column(DateTime(timezone=True), nullable=True)
    declined = Column(String(1), nullable=False, default="0")  # "1" if they declined

    user = relationship("User", foreign_keys=[user_id])
