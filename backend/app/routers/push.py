from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from ..core.database import get_db
from ..core.security import get_current_user
from ..core.config import get_settings
from ..models.push_subscription import PushSubscription
from ..schemas.push import PushSubscribeIn, PushUnsubscribeIn

router = APIRouter(prefix="/api/push", tags=["push"])
settings = get_settings()


@router.get("/vapid-public-key")
def get_vapid_public_key():
    return {"key": settings.VAPID_PUBLIC_KEY}


@router.post("/subscribe", status_code=204)
def subscribe(payload: PushSubscribeIn, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    existing = db.query(PushSubscription).filter(PushSubscription.endpoint == payload.endpoint).first()
    if existing:
        # Same browser re-subscribing (e.g. keys rotated) — update in
        # place rather than erroring on the unique constraint.
        existing.user_id = current_user.id
        existing.p256dh = payload.p256dh
        existing.auth = payload.auth
    else:
        db.add(PushSubscription(
            user_id=current_user.id, endpoint=payload.endpoint,
            p256dh=payload.p256dh, auth=payload.auth,
        ))
    db.commit()
    return None


@router.post("/unsubscribe", status_code=204)
def unsubscribe(payload: PushUnsubscribeIn, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    db.query(PushSubscription).filter(
        PushSubscription.endpoint == payload.endpoint, PushSubscription.user_id == current_user.id
    ).delete()
    db.commit()
    return None
