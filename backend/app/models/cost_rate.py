from sqlalchemy import Column, Integer, Float, String, DateTime, Boolean
from sqlalchemy.sql import func
from ..core.database import Base


class CostRate(Base):
    __tablename__ = "cost_rates"

    id = Column(Integer, primary_key=True, index=True)
    purity = Column(String(10), unique=True, nullable=False)  # "21", "18", "24", "silver" — must match frontend's purity keys
    cost_per_gram = Column(Float, nullable=False, default=0.0)
    is_active = Column(Boolean, default=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
