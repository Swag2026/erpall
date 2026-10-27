from pydantic import BaseModel
from typing import Optional, List, Any
from datetime import datetime


class ContactBase(BaseModel):
    name: str
    phone: Optional[str] = None
    email: Optional[str] = None
    contact_type: str = "customer"  # customer, supplier, both
    city: Optional[str] = None
    notes: Optional[str] = None


class ContactCreate(ContactBase):
    pass


class ContactUpdate(ContactBase):
    name: Optional[str] = None
    contact_type: Optional[str] = None


class ContactInvoiceSummary(BaseModel):
    id: int
    invoice_no: str
    invoice_date: str
    category: str
    total_amount: float

    model_config = {"from_attributes": True}


class ContactResponse(ContactBase):
    id: int
    is_active: bool
    created_at: datetime
    updated_at: Optional[datetime] = None
    # computed stats
    total_invoices: int = 0
    total_amount: float = 0.0
    total_sales_amount: float = 0.0      # frontend uses this
    total_purchase_amount: float = 0.0   # frontend uses this
    invoices: List[ContactInvoiceSummary] = []  # frontend contact detail modal

    model_config = {"from_attributes": True}
