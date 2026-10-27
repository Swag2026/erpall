import json
import logging
from pywebpush import webpush, WebPushException
from sqlalchemy.orm import Session
from ..models.push_subscription import PushSubscription
from .config import get_settings

settings = get_settings()
logger = logging.getLogger(__name__)


def send_push_to_user(db: Session, user_id: int, payload: dict) -> None:
    """Fire-and-forget web push to every browser this user has subscribed
    from. Payload becomes the JSON body the service worker's 'push' event
    receives — keep it small (title/body/tag/data), same shape across
    call sites so sw.js only needs one code path."""
    if not settings.VAPID_PRIVATE_KEY or not settings.VAPID_PUBLIC_KEY:
        return  # push not configured on this deployment — silently skip

    subs = db.query(PushSubscription).filter(PushSubscription.user_id == user_id).all()
    dead_ids = []
    for sub in subs:
        try:
            webpush(
                subscription_info={
                    "endpoint": sub.endpoint,
                    "keys": {"p256dh": sub.p256dh, "auth": sub.auth},
                },
                data=json.dumps(payload),
                vapid_private_key=settings.VAPID_PRIVATE_KEY,
                vapid_claims={"sub": settings.VAPID_CLAIMS_EMAIL},
            )
        except WebPushException as e:
            status = e.response.status_code if e.response is not None else None
            if status in (404, 410):
                # Browser unsubscribed or the subscription expired —
                # stop trying this one instead of failing on every future
                # message/call.
                dead_ids.append(sub.id)
            else:
                logger.warning("Push failed for user %s: %s", user_id, e)
        except Exception as e:
            logger.warning("Push failed for user %s: %s", user_id, e)

    if dead_ids:
        db.query(PushSubscription).filter(PushSubscription.id.in_(dead_ids)).delete(synchronize_session=False)
        db.commit()
