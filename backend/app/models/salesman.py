from sqlalchemy import Column, Integer, String, Boolean, DateTime
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from ..core.database import Base


class Salesman(Base):
    """A named salesperson that can be attached to Sale / Purchase entries.
    Soft-deleted via is_active so old invoices keep showing the right name."""
    __tablename__ = "salesmen"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(150), nullable=False, index=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    invoices = relationship("Invoice", back_populates="salesman")
