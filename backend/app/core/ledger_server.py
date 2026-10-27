"""Server-side copy of the Dashboard's cash carry-forward, so the backend (not the browser) decides what the
system closing cash of a day is. Same formula as frontend lib/ledger.js / Dashboard.jsx:

    closing = opening + sale cash + cash added + cash received for settled shop loans
              - purchase cash - supplier-payment cash - expense cash paid from MAIN

A day with no explicit opening inherits the previous day's closing. Canceled invoices are ignored; expenses paid
from the separate Cash Deposit account never touched Main's cash.
"""
from collections import defaultdict
from datetime import date
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..models.invoice import Invoice
from ..models.day_opening import DayOpening
from ..models.shop_loan import LoanEntry


def _flows_by_day(db: Session, upto: date) -> dict:
    flow = defaultdict(float)
    rows = (
        db.query(Invoice.invoice_date, Invoice.category, Invoice.payment_source,
                 func.coalesce(func.sum(Invoice.cash_amount), 0.0))
        .filter(Invoice.status != "canceled", Invoice.invoice_date <= upto)
        .group_by(Invoice.invoice_date, Invoice.category, Invoice.payment_source)
        .all()
    )
    for d, cat, src, cash in rows:
        cash = float(cash or 0)
        if cat in ("sale", "cash_adjustment"):
            flow[d] += cash
        elif cat in ("purchase_jewelry", "purchase_scrap", "supplier_payment"):
            flow[d] -= cash
        elif cat == "expense" and src != "cash_deposit":
            flow[d] -= cash
    loans = (
        db.query(LoanEntry.entry_date, func.coalesce(func.sum(LoanEntry.cash_amount), 0.0))
        .filter(LoanEntry.status == "active", LoanEntry.entry_type == "settle", LoanEntry.entry_date <= upto)
        .group_by(LoanEntry.entry_date)
        .all()
    )
    for d, cash in loans:
        flow[d] += float(cash or 0)
    return flow


def closing_cash(db: Session, day: date) -> float:
    flow = _flows_by_day(db, day)
    openings = {o.opening_date: float(o.opening_cash or 0)
                for o in db.query(DayOpening).filter(DayOpening.opening_date <= day).all()}
    days = sorted(set(flow) | set(openings) | {day})
    carry = 0.0
    for d in days:
        opening = openings[d] if d in openings else carry
        carry = opening + flow.get(d, 0.0)
    return round(carry, 2)
