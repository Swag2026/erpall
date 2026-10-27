"""
External ERP Sync
==================
Read-only proxy to a partner company's ERP (docs supplied by them). We
authenticate on their behalf using service credentials stored in our own
.env (never sent to the frontend), cache the 1-hour token in memory, and
re-fetch it automatically once it's close to expiring. The frontend only
ever talks to OUR backend — it never sees the partner's credentials or
token, which is why this is a proxy rather than something the frontend
calls directly.
"""
import time
import requests
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional, List

from ..core.database import get_db
from ..core.security import get_current_user
from ..core.config import get_settings
from ..core.permissions import has_permission

router = APIRouter(prefix="/api/external-sync", tags=["external-sync"])

_token_cache = {"token": None, "expires_at": 0}


def _require_ext_view(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if current_user.role.name != "admin" and not has_permission(db, current_user.role_id, current_user.role.name, "page.external_sync.view"):
        raise HTTPException(status_code=403, detail="You don't have permission to use External Sync")
    return current_user


def _get_external_token() -> str:
    settings = get_settings()
    now = time.time()
    if _token_cache["token"] and _token_cache["expires_at"] - now > 60:
        return _token_cache["token"]

    try:
        r = requests.post(
            f"{settings.EXTERNAL_API_BASE_URL}/auth/token",
            json={"username": settings.EXTERNAL_API_USERNAME, "password": settings.EXTERNAL_API_PASSWORD},
            timeout=15,
        )
        r.raise_for_status()
        data = r.json()
    except requests.RequestException as e:
        raise HTTPException(status_code=502, detail=f"Could not reach external ERP for authentication: {e}")

    token = data.get("token")
    expires_in = data.get("expires_in", 3600)
    if not token:
        raise HTTPException(status_code=502, detail="External ERP did not return a token")

    _token_cache["token"] = token
    _token_cache["expires_at"] = now + expires_in
    return token


def _external_post(path: str, payload: dict) -> dict:
    settings = get_settings()
    token = _get_external_token()
    try:
        r = requests.post(
            f"{settings.EXTERNAL_API_BASE_URL}{path}",
            json=payload,
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            timeout=30,
        )
        if r.status_code == 401:
            _token_cache["token"] = None
            token = _get_external_token()
            r = requests.post(
                f"{settings.EXTERNAL_API_BASE_URL}{path}",
                json=payload,
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                timeout=30,
            )
        r.raise_for_status()
        return r.json()
    except requests.RequestException as e:
        raise HTTPException(status_code=502, detail=f"External ERP request failed: {e}")


class CustomerBalancesRequest(BaseModel):
    branches: Optional[List[int]] = None
    to_date: Optional[str] = None


class SummaryRequest(BaseModel):
    branches: List[int] = []
    from_date: str
    to_date: str
    account_types: List[str] = ["customers"]
    price_of_gold: float = 0
    price_of_silver: float = 0
    convert: int = 0
    currency: int = 1
    rate_type: str = "gram"
    show_data_with_zero: str = "no"


@router.post("/customer-balances")
def sync_customer_balances(
    payload: CustomerBalancesRequest = CustomerBalancesRequest(),
    _=Depends(_require_ext_view),
):
    """Pulls each customer's cash/gold/silver debit-credit-balance from the
    partner ERP. branches/to_date are both optional passthroughs."""
    body = {k: v for k, v in payload.model_dump().items() if v is not None}
    return _external_post("/customer-balances", body)


@router.post("/summary-of-all-accounts")
def sync_summary_of_all_accounts(
    payload: SummaryRequest,
    _=Depends(_require_ext_view),
):
    return _external_post("/summary-of-all-accounts", payload.model_dump())
