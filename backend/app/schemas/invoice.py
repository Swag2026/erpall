import math
from pydantic import BaseModel, field_validator
from typing import Optional, List
from datetime import date, datetime


VALID_CATEGORIES = (
    "sale", "purchase_jewelry", "purchase_scrap", "supplier_payment", "expense", "cash_adjustment", "cash_deposit",
)
MONEY_FIELDS = ("amount_21k", "amount_18k", "amount_24k", "amount_silver", "cash_amount", "card_amount", "total_amount")
WEIGHT_FIELDS = ("weight_21k", "weight_18k", "weight_24k", "weight_silver")
MAX_MONEY = 1_000_000_000      # 1 billion SAR — far beyond any real entry, blocks typos / abuse
MAX_WEIGHT = 1_000_000         # 1,000 kg


def _num_ok(v, limit, label):
    if v is None:
        return v
    if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
        raise ValueError(f"{label} is not a valid number")
    if v < 0:
        raise ValueError(f"{label} cannot be negative")
    if v > limit:
        raise ValueError(f"{label} is too large")
    return v


class _RulesMixin(BaseModel):
    @field_validator(*MONEY_FIELDS, check_fields=False)
    @classmethod
    def _money(cls, v, info):
        return _num_ok(v, MAX_MONEY, info.field_name.replace("_", " "))

    @field_validator(*WEIGHT_FIELDS, check_fields=False)
    @classmethod
    def _weight(cls, v, info):
        return _num_ok(v, MAX_WEIGHT, info.field_name.replace("_", " "))

    @field_validator("category", check_fields=False)
    @classmethod
    def _category(cls, v):
        if v is not None and v not in VALID_CATEGORIES:
            raise ValueError(f"Unknown category '{v}'")
        return v

    @field_validator("payment_source", check_fields=False)
    @classmethod
    def _source(cls, v):
        if v is not None and v not in ("main", "cash_deposit"):
            raise ValueError("payment_source must be 'main' or 'cash_deposit'")
        return v


class InvoiceItemBase(BaseModel):
    metal_type: Optional[str] = None
    purity: Optional[str] = None
    weight_grams: float = 0.0
    rate_per_gram: float = 0.0
    line_amount: float = 0.0
    remarks: Optional[str] = None


class InvoiceItemCreate(InvoiceItemBase):
    pass


class InvoiceItemResponse(InvoiceItemBase):
    id: int
    invoice_id: int

    model_config = {"from_attributes": True}


class InvoiceBase(_RulesMixin):
    invoice_no: str
    invoice_date: date
    category: str  # sale, purchase_jewelry, purchase_scrap, supplier_payment, expense
    contact_id: Optional[int] = None
    salesman_id: Optional[int] = None
    weight_21k: float = 0.0
    weight_18k: float = 0.0
    weight_24k: float = 0.0
    weight_silver: float = 0.0
    amount_21k: float = 0.0
    amount_18k: float = 0.0
    amount_24k: float = 0.0
    amount_silver: float = 0.0
    cash_amount: float = 0.0
    card_amount: float = 0.0
    total_amount: float = 0.0
    note: Optional[str] = None
    description: Optional[str] = None
    attachment_data: Optional[str] = None
    attachment_name: Optional[str] = None
    payment_source: Optional[str] = "main"  # "main" or "cash_deposit"


class InvoiceCreate(InvoiceBase):
    items: Optional[List[InvoiceItemCreate]] = []


class InvoiceUpdate(_RulesMixin):
    invoice_no: Optional[str] = None
    invoice_date: Optional[date] = None
    category: Optional[str] = None
    contact_id: Optional[int] = None
    salesman_id: Optional[int] = None
    weight_21k: Optional[float] = None
    weight_18k: Optional[float] = None
    weight_24k: Optional[float] = None
    weight_silver: Optional[float] = None
    amount_21k: Optional[float] = None
    amount_18k: Optional[float] = None
    amount_24k: Optional[float] = None
    amount_silver: Optional[float] = None
    cash_amount: Optional[float] = None
    card_amount: Optional[float] = None
    total_amount: Optional[float] = None
    note: Optional[str] = None
    description: Optional[str] = None
    attachment_data: Optional[str] = None
    attachment_name: Optional[str] = None
    payment_source: Optional[str] = None
    items: Optional[List[InvoiceItemCreate]] = None


class CancelRequest(BaseModel):
    note: Optional[str] = None


class InvoiceResponse(InvoiceBase):
    id: int
    status: str
    validity: str
    created_by_id: int
    updated_by_id: Optional[int] = None
    created_at: datetime
    updated_at: Optional[datetime] = None
    items: List[InvoiceItemResponse] = []
    contact_name: Optional[str] = None
    salesman_name: Optional[str] = None
    created_by_name: Optional[str] = None
    updated_by_name: Optional[str] = None

    model_config = {"from_attributes": True}
