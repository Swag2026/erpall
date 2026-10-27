from pydantic import BaseModel, field_validator, model_validator
from typing import Optional, List, Dict
from datetime import date, datetime


def _clean_name(v: str) -> str:
    v = " ".join((v or "").split())
    if not v:
        raise ValueError("Name is required")
    if len(v) > 150:
        raise ValueError("Name is too long")
    return v


class ShopCreate(BaseModel):
    name: str
    phone: Optional[str] = None
    credit_limit: Optional[float] = None   # equivalent grams in the app's unit (Retail 21K-eq / Bullion 24K-eq); empty/0 = no limit

    @field_validator("credit_limit")
    @classmethod
    def _cl(cls, v):
        if v is None or v <= 0:
            return None
        if v > 1_000_000:
            raise ValueError("Credit limit is too large")
        return round(v, 3)

    @field_validator("name")
    @classmethod
    def _n(cls, v):
        return _clean_name(v)

    @field_validator("phone")
    @classmethod
    def _p(cls, v):
        v = (v or "").strip()
        return v or None


class ShopResponse(BaseModel):
    id: int
    name: str
    phone: Optional[str] = None
    is_active: bool
    credit_limit: Optional[float] = None
    balance: Dict[str, float]          # w24, w21, w18, silver (grams still with the shop)
    balance_21k_eq: Optional[float] = None   # filled in Retail (21K-equivalent)
    balance_24k_eq: Optional[float] = None   # filled in Bullion (24K-equivalent)
    open_since: Optional[datetime] = None   # start of the current unbroken "owes us" stretch
    last_activity: Optional[datetime] = None
    expected_return_time: Optional[str] = None  # of the latest active lend
    entry_count: int = 0


class Piece(BaseModel):
    desc: str = ""
    karat: Optional[str] = None
    weight: Optional[float] = None


class EntryCreate(BaseModel):
    shop_id: int
    entry_type: str
    entry_date: date
    weight_24k: float = 0.0
    weight_21k: float = 0.0
    weight_18k: float = 0.0
    weight_silver: float = 0.0
    cash_amount: float = 0.0
    rate: Optional[float] = None
    settle_kind: Optional[str] = None
    override_limit: bool = False   # admin only: lend even though it passes the shop's credit limit
    expected_return_time: Optional[str] = None
    taken_by: Optional[str] = None
    note: Optional[str] = None
    pieces: Optional[List[Piece]] = None
    attachment_data: Optional[str] = None
    attachment_name: Optional[str] = None

    @field_validator("entry_type")
    @classmethod
    def _t(cls, v):
        if v not in ("lend", "return", "settle"):
            raise ValueError("entry_type must be lend, return or settle")
        return v

    @field_validator("weight_24k", "weight_21k", "weight_18k", "weight_silver", "cash_amount")
    @classmethod
    def _nonneg(cls, v):
        v = float(v or 0)
        if v < 0:
            raise ValueError("Values cannot be negative")
        return round(v, 3)

    @field_validator("expected_return_time")
    @classmethod
    def _time(cls, v):
        if not v:
            return None
        parts = v.split(":")
        if len(parts) != 2 or not all(p.isdigit() for p in parts) or not (0 <= int(parts[0]) < 24 and 0 <= int(parts[1]) < 60):
            raise ValueError("expected_return_time must be HH:MM")
        return f"{int(parts[0]):02d}:{int(parts[1]):02d}"

    @model_validator(mode="after")
    def _shape(self):
        total_w = self.weight_24k + self.weight_21k + self.weight_18k + self.weight_silver
        if total_w <= 0:
            raise ValueError("Enter at least one weight")
        if self.entry_type == "settle":
            if self.cash_amount <= 0:
                raise ValueError("Enter the cash amount received")
            if self.settle_kind not in ("cash", "sold"):
                self.settle_kind = "cash"
        else:
            self.cash_amount = 0.0
            self.settle_kind = None
            self.rate = None
        if self.entry_type != "lend":
            self.expected_return_time = None
        return self


class CancelPayload(BaseModel):
    note: Optional[str] = None


class EntryResponse(BaseModel):
    id: int
    shop_id: int
    shop_name: str
    entry_type: str
    entry_date: date
    occurred_at: Optional[datetime] = None
    weight_24k: float
    weight_21k: float
    weight_18k: float
    weight_silver: float
    weight_21k_eq: Optional[float] = None    # Retail
    weight_24k_eq: Optional[float] = None    # Bullion
    cash_amount: float
    rate: Optional[float] = None
    settle_kind: Optional[str] = None
    expected_return_time: Optional[str] = None
    taken_by: Optional[str] = None
    note: Optional[str] = None
    pieces: List[Piece] = []
    has_attachment: bool = False
    attachment_data: Optional[str] = None
    attachment_name: Optional[str] = None
    status: str
    cancel_note: Optional[str] = None
    created_by_name: Optional[str] = None
    updated_by_name: Optional[str] = None
