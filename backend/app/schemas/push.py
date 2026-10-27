from pydantic import BaseModel


class PushSubscribeIn(BaseModel):
    endpoint: str
    p256dh: str
    auth: str


class PushUnsubscribeIn(BaseModel):
    endpoint: str
