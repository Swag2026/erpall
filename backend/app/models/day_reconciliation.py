from sqlalchemy import Column, Integer, Float, String, Date, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from ..core.database import Base


class DayReconciliation(Base):
    """End-of-day cash reconciliation. Cashier/Supervisor physically counts
    the cash in hand and enters it here; the app compares it against the
    system-calculated closing cash for that day and records the variance.
    One row per exhibition day."""

    __tablename__ = "day_reconciliations"

    id = Column(Integer, primary_key=True, index=True)
    reconciliation_date = Column(Date, nullable=False, unique=True, index=True)
    system_closing_cash = Column(Float, nullable=False)   # snapshot of the calculated value at the moment of reconciling
    counted_cash = Column(Float, nullable=False)           # physically counted amount
    variance = Column(Float, nullable=False)                # counted - system (negative = short, positive = over)
    note = Column(String(500))
    reconciled_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    reconciled_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    reconciled_by = relationship("User")
