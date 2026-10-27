from pydantic import BaseModel
from typing import List, Optional


class SummaryResponse(BaseModel):
    total_revenue: float
    total_purchases: float
    total_invoices: int
    total_sale_invoices: int
    total_gold_sold_grams: float
    equivalent_21k_grams: float
    cash_total: float
    card_total: float
    exhibition_days: int


class DailyRevenueItem(BaseModel):
    date: str
    revenue: float
    purchases: float
    net: float


class KaratBreakdownItem(BaseModel):
    purity: str
    weight_grams: float
    amount: float
    percentage: float


class CashVsCardResponse(BaseModel):
    cash_sales: float
    card_sales: float
    cash_purchases: float
    card_purchases: float


class SalesVsPurchasesResponse(BaseModel):
    dates: List[str]
    sales: List[float]
    purchases: List[float]
