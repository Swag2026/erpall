from sqlalchemy import Column, Integer, Float, Date, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from ..core.database import Base


class DayOpening(Base):
    """Opening balance for one exhibition day. One row per date — set once
    when the day starts (or edited later), used to compute closing cash /
    gold balance on the Dashboard. Previously this only lived in a JS
    variable on the frontend and vanished on every page refresh."""

    __tablename__ = "day_openings"

    id = Column(Integer, primary_key=True, index=True)
    opening_date = Column(Date, nullable=False, unique=True, index=True)
    opening_cash = Column(Float, default=0.0)
    opening_gold = Column(Float, default=0.0)     # 21K-equivalent grams
    opening_silver = Column(Float, default=0.0)
    updated_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    updated_by = relationship("User")
