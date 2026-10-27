from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import Optional
from datetime import date
from ..core.database import get_db
from ..core.security import get_current_user
from ..core.permissions import has_permission
from ..models.invoice import Invoice
from ..models.user import User
from ..schemas.analytics import (
    SummaryResponse, DailyRevenueItem, KaratBreakdownItem,
    CashVsCardResponse, SalesVsPurchasesResponse,
)

router = APIRouter(prefix="/api/analytics", tags=["analytics"])

SALE_CATS = ("sale",)
PURCHASE_CATS = ("purchase_jewelry", "purchase_scrap")


def _require_analytics(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not has_permission(db, current_user.role_id, current_user.role.name, "page.analytics.view"):
        from fastapi import HTTPException
        raise HTTPException(status_code=403, detail="You don't have permission to view analytics")
    return current_user


@router.get("/summary", response_model=SummaryResponse)
def summary(db: Session = Depends(get_db), _=Depends(_require_analytics)):
    active = db.query(Invoice).filter(Invoice.status == "active")

    sales = active.filter(Invoice.category == "sale")
    purchases = active.filter(Invoice.category.in_(PURCHASE_CATS))

    s = sales.with_entities(
        func.coalesce(func.sum(Invoice.total_amount), 0).label("rev"),
        func.count(Invoice.id).label("cnt"),
        func.coalesce(func.sum(Invoice.weight_21k), 0).label("w21"),
        func.coalesce(func.sum(Invoice.weight_18k), 0).label("w18"),
        func.coalesce(func.sum(Invoice.weight_24k), 0).label("w24"),
        func.coalesce(func.sum(Invoice.cash_amount), 0).label("cash"),
        func.coalesce(func.sum(Invoice.card_amount), 0).label("card"),
    ).first()

    p = purchases.with_entities(
        func.coalesce(func.sum(Invoice.total_amount), 0).label("rev"),
    ).first()

    days_count = db.query(func.count(func.distinct(Invoice.invoice_date))).filter(Invoice.status == "active").scalar() or 0

    conv21 = float(s.w21 or 0) + float(s.w18 or 0) * (18/21) + float(s.w24 or 0) * (24/21)

    return SummaryResponse(
        total_revenue=float(s.rev or 0),
        total_purchases=float(p.rev or 0),
        total_invoices=db.query(Invoice).filter(Invoice.status == "active").count(),
        total_sale_invoices=int(s.cnt or 0),
        total_gold_sold_grams=float(s.w21 or 0) + float(s.w18 or 0) + float(s.w24 or 0),
        equivalent_21k_grams=round(conv21, 3),
        cash_total=float(s.cash or 0),
        card_total=float(s.card or 0),
        exhibition_days=int(days_count),
    )


@router.get("/daily-revenue")
def daily_revenue(db: Session = Depends(get_db), _=Depends(_require_analytics)):
    rows = db.query(
        Invoice.invoice_date,
        Invoice.category,
        func.coalesce(func.sum(Invoice.total_amount), 0).label("total"),
    ).filter(Invoice.status == "active").group_by(
        Invoice.invoice_date, Invoice.category
    ).order_by(Invoice.invoice_date).all()

    by_day: dict = {}
    for row in rows:
        d = str(row.invoice_date)
        if d not in by_day:
            by_day[d] = {"revenue": 0.0, "purchases": 0.0}
        if row.category == "sale":
            by_day[d]["revenue"] += float(row.total)
        elif row.category in PURCHASE_CATS:
            by_day[d]["purchases"] += float(row.total)

    return [
        DailyRevenueItem(
            date=d,
            revenue=v["revenue"],
            purchases=v["purchases"],
            net=v["revenue"] - v["purchases"],
        )
        for d, v in sorted(by_day.items())
    ]


@router.get("/karat-breakdown")
def karat_breakdown(db: Session = Depends(get_db), _=Depends(_require_analytics)):
    sales = db.query(Invoice).filter(Invoice.category == "sale", Invoice.status == "active")

    agg = sales.with_entities(
        func.coalesce(func.sum(Invoice.weight_21k), 0).label("w21"),
        func.coalesce(func.sum(Invoice.weight_18k), 0).label("w18"),
        func.coalesce(func.sum(Invoice.weight_24k), 0).label("w24"),
        func.coalesce(func.sum(Invoice.weight_silver), 0).label("wS"),
        func.coalesce(func.sum(Invoice.amount_21k), 0).label("a21"),
        func.coalesce(func.sum(Invoice.amount_18k), 0).label("a18"),
        func.coalesce(func.sum(Invoice.amount_24k), 0).label("a24"),
        func.coalesce(func.sum(Invoice.amount_silver), 0).label("aS"),
    ).first()

    total_weight = float(agg.w21) + float(agg.w18) + float(agg.w24) + float(agg.wS) or 1

    return [
        KaratBreakdownItem(purity="21K", weight_grams=float(agg.w21), amount=float(agg.a21),
                           percentage=round(float(agg.w21)/total_weight*100, 1)),
        KaratBreakdownItem(purity="18K", weight_grams=float(agg.w18), amount=float(agg.a18),
                           percentage=round(float(agg.w18)/total_weight*100, 1)),
        KaratBreakdownItem(purity="24K", weight_grams=float(agg.w24), amount=float(agg.a24),
                           percentage=round(float(agg.w24)/total_weight*100, 1)),
        KaratBreakdownItem(purity="Silver", weight_grams=float(agg.wS), amount=float(agg.aS),
                           percentage=round(float(agg.wS)/total_weight*100, 1)),
    ]


@router.get("/cash-vs-card", response_model=CashVsCardResponse)
def cash_vs_card(db: Session = Depends(get_db), _=Depends(_require_analytics)):
    active = db.query(Invoice).filter(Invoice.status == "active")

    def _agg(cat_filter):
        return active.filter(cat_filter).with_entities(
            func.coalesce(func.sum(Invoice.cash_amount), 0).label("cash"),
            func.coalesce(func.sum(Invoice.card_amount), 0).label("card"),
        ).first()

    sa = _agg(Invoice.category == "sale")
    pa = _agg(Invoice.category.in_(PURCHASE_CATS))

    return CashVsCardResponse(
        cash_sales=float(sa.cash), card_sales=float(sa.card),
        cash_purchases=float(pa.cash), card_purchases=float(pa.card),
    )


@router.get("/sales-vs-purchases", response_model=SalesVsPurchasesResponse)
def sales_vs_purchases(db: Session = Depends(get_db), _=Depends(_require_analytics)):
    rows = db.query(
        Invoice.invoice_date,
        Invoice.category,
        func.coalesce(func.sum(Invoice.total_amount), 0).label("total"),
    ).filter(Invoice.status == "active").group_by(
        Invoice.invoice_date, Invoice.category
    ).order_by(Invoice.invoice_date).all()

    by_day: dict = {}
    for row in rows:
        d = str(row.invoice_date)
        if d not in by_day:
            by_day[d] = {"s": 0.0, "p": 0.0}
        if row.category == "sale":
            by_day[d]["s"] += float(row.total)
        elif row.category in PURCHASE_CATS:
            by_day[d]["p"] += float(row.total)

    dates = sorted(by_day.keys())
    return SalesVsPurchasesResponse(
        dates=dates,
        sales=[by_day[d]["s"] for d in dates],
        purchases=[by_day[d]["p"] for d in dates],
    )
