from sqlalchemy import Column, Integer, String, Boolean, DateTime
from sqlalchemy.sql import func
from ..core.database import Base


class LoginAttempt(Base):
    """Every login attempt — successful or failed — for security auditing.
    Visible to Admins under Settings so they can see who accessed the
    system and spot suspicious activity (repeated failures, unfamiliar
    times, etc)."""

    __tablename__ = "login_attempts"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(100), nullable=False, index=True)
    success = Column(Boolean, nullable=False)
    ip_address = Column(String(64))
    reason = Column(String(255))  # e.g. "invalid_password", "locked", "inactive", null on success
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)
