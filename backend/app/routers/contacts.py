from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import List, Optional
from ..core.database import get_db
from ..core.security import get_current_user
from ..core.permissions import has_permission
from ..models.contact import Contact
from ..models.invoice import Invoice
from ..schemas.contact import ContactCreate, ContactUpdate, ContactResponse, ContactInvoiceSummary

router = APIRouter(prefix="/api/contacts", tags=["contacts"])


def _response_from_invoices(contact: Contact, active_invs: list) -> ContactResponse:
    total_sales    = sum(i.total_amount or 0 for i in active_invs if i.category == "sale")
    total_purchase = sum(i.total_amount or 0 for i in active_invs if i.category in ("purchase_jewelry", "purchase_scrap"))
    total_all      = sum(i.total_amount or 0 for i in active_invs)

    inv_summaries = [
        ContactInvoiceSummary(
            id=i.id,
            invoice_no=str(i.invoice_no),
            invoice_date=str(i.invoice_date),
            category=i.category,
            total_amount=float(i.total_amount or 0),
        )
        for i in active_invs
    ]

    return ContactResponse(
        id=contact.id,
        name=contact.name,
        phone=contact.phone,
        email=contact.email,
        contact_type=contact.contact_type,
        city=contact.city,
        notes=contact.notes,
        is_active=contact.is_active,
        created_at=contact.created_at,
        updated_at=contact.updated_at,
        total_invoices=len(active_invs),
        total_amount=float(total_all),
        total_sales_amount=float(total_sales),
        total_purchase_amount=float(total_purchase),
        invoices=inv_summaries,
    )


def build_response(contact: Contact, db: Session) -> ContactResponse:
    """Single-contact lookup (detail view) — one contact means one query
    here is fine, no N+1 concern."""
    active_invs = (
        db.query(Invoice)
        .filter(Invoice.contact_id == contact.id, Invoice.status == "active")
        .order_by(Invoice.invoice_date.desc())
        .all()
    )
    return _response_from_invoices(contact, active_invs)


@router.get("/count")
def count_contacts(
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    """Sidebar badge just needs a number — this avoids pulling every
    contact's full invoice history/aggregates purely to read len() off
    the list, which was happening on every single page navigation."""
    return {"total": db.query(Contact).filter(Contact.is_active == True).count()}


@router.get("", response_model=List[ContactResponse])
def list_contacts(
    search: Optional[str] = Query(None),
    contact_type: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    if not has_permission(db, current_user.role_id, current_user.role.name, "page.contacts.view"):
        raise HTTPException(status_code=403, detail="You don't have permission to view contacts")
    q = db.query(Contact).filter(Contact.is_active == True)
    if search:
        like = f"%{search}%"
        q = q.filter((Contact.name.ilike(like)) | (Contact.phone.ilike(like)))
    if contact_type and contact_type != "all":
        q = q.filter(Contact.contact_type == contact_type)
    contacts = q.order_by(Contact.name).all()

    # Previously called build_response() per contact, each running its own
    # full invoice-table query — with N contacts that's N separate scans.
    # One query for every contact's invoices, grouped in memory, replaces
    # all of them.
    contact_ids = [c.id for c in contacts]
    all_invs = (
        db.query(Invoice)
        .filter(Invoice.contact_id.in_(contact_ids), Invoice.status == "active")
        .order_by(Invoice.invoice_date.desc())
        .all()
    ) if contact_ids else []
    invs_by_contact = {}
    for inv in all_invs:
        invs_by_contact.setdefault(inv.contact_id, []).append(inv)

    return [_response_from_invoices(c, invs_by_contact.get(c.id, [])) for c in contacts]


@router.post("", response_model=ContactResponse, status_code=201)
def create_contact(
    payload: ContactCreate,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    contact = Contact(**payload.model_dump())
    db.add(contact)
    db.commit()
    db.refresh(contact)
    return build_response(contact, db)


@router.get("/{contact_id}", response_model=ContactResponse)
def get_contact(
    contact_id: int,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    contact = db.query(Contact).filter(Contact.id == contact_id, Contact.is_active == True).first()
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    return build_response(contact, db)


@router.put("/{contact_id}", response_model=ContactResponse)
def update_contact(
    contact_id: int,
    payload: ContactUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    if not has_permission(db, current_user.role_id, current_user.role.name, "contacts.manage"):
        raise HTTPException(status_code=403, detail="You don't have permission to edit contacts")
    contact = db.query(Contact).filter(Contact.id == contact_id, Contact.is_active == True).first()
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    for field, val in payload.model_dump(exclude_unset=True).items():
        setattr(contact, field, val)
    db.commit()
    db.refresh(contact)
    return build_response(contact, db)


@router.delete("/{contact_id}", status_code=204)
def delete_contact(
    contact_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    if not has_permission(db, current_user.role_id, current_user.role.name, "contacts.manage"):
        raise HTTPException(status_code=403, detail="You don't have permission to delete contacts")
    contact = db.query(Contact).filter(Contact.id == contact_id, Contact.is_active == True).first()
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    contact.is_active = False  # soft delete
    db.commit()
