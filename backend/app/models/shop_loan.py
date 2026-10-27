from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime, Date, Text, ForeignKey
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from ..core.database import Base


class LoanShop(Base):
    """Another shop that borrows our gold/silver for the day (stock on trust).
    Soft-deleted via is_active so old entries keep showing the right name."""
    __tablename__ = "loan_shops"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(150), nullable=False, index=True)
    phone = Column(String(50), nullable=True)
    is_active = Column(Boolean, default=True)
    credit_limit = Column(Float, nullable=True)  # max 21K-equivalent grams this shop may hold; NULL = no limit
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    entries = relationship("LoanEntry", back_populates="shop")


class LoanEntry(Base):
    """One movement on a shop's account.

    entry_type:
      lend   — gold/silver leaves our stock to the shop   (debit on the shop)
      return — the same metal comes back into our stock   (credit)
      settle — the shop keeps the metal and pays for it: cash_amount enters our
               cash, the metal does NOT come back          (credit)
               settle_kind: 'cash' (priced at a rate) or 'sold' (shop sold the pieces)
    Canceled rows are kept for audit but excluded from every balance.
    """
    __tablename__ = "loan_entries"

    id = Column(Integer, primary_key=True, index=True)
    shop_id = Column(Integer, ForeignKey("loan_shops.id"), nullable=False, index=True)
    entry_type = Column(String(10), nullable=False, index=True)
    entry_date = Column(Date, nullable=False, index=True)

    weight_24k = Column(Float, default=0.0)
    weight_21k = Column(Float, default=0.0)
    weight_18k = Column(Float, default=0.0)
    weight_silver = Column(Float, default=0.0)

    cash_amount = Column(Float, default=0.0)   # only for settle
    rate = Column(Float, nullable=True)        # informational (SAR/g used for a cash settle)
    settle_kind = Column(String(10), nullable=True)

    expected_return_time = Column(String(5), nullable=True)  # "HH:MM", only for lend
    taken_by = Column(String(150), nullable=True)
    note = Column(Text, nullable=True)
    pieces = Column(Text, nullable=True)       # JSON list of {desc, karat, weight}
    attachment_data = Column(Text, nullable=True)
    attachment_name = Column(String(255), nullable=True)

    status = Column(String(20), default="active", index=True)  # active, canceled
    cancel_note = Column(Text, nullable=True)
    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    updated_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    shop = relationship("LoanShop", back_populates="entries")
    created_by = relationship("User", foreign_keys=[created_by_id])
    updated_by = relationship("User", foreign_keys=[updated_by_id])
