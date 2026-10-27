from sqlalchemy import Column, Integer, Float, String, ForeignKey, DateTime, Text, Date
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from ..core.database import Base


class SupplierPayment(Base):
    __tablename__ = "supplier_payments"

    id = Column(Integer, primary_key=True, index=True)
    payment_date = Column(Date, nullable=False)
    contact_id = Column(Integer, ForeignKey("contacts.id"), nullable=True)
    amount = Column(Float, nullable=False)
    cash_amount = Column(Float, default=0.0)
    card_amount = Column(Float, default=0.0)
    note = Column(Text)
    reference = Column(String(200))
    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    contact = relationship("Contact")
    created_by = relationship("User")
