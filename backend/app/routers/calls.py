from datetime import datetime, timezone
from typing import Dict, Set
from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect, Query
from sqlalchemy.orm import Session
from ..core.database import get_db
from ..core.tenant import TenantDict
from ..core.security import get_current_user, decode_token
from ..core.turn_credentials import build_ice_servers
from ..models.call import Call, CallParticipant
from ..models.message import Group, GroupMember
from ..models.user import User
from ..schemas.call import CallCreate, CallRespond, CallOut, ParticipantOut, IceServersOut
from ..core.push import send_push_to_user

router = APIRouter(prefix="/api/calls", tags=["calls"])


# ── Signaling relay ──────────────────────────────────────────────────────
# In-memory map of user_id -> live websocket connection, same lightweight
# pattern as the typing-indicator dict in messages.py. This process only
# relays small JSON signaling messages (offers/answers/ICE candidates,
# a few KB each, a handful of times per call) between browsers — it never
# touches the actual audio/video, so this doesn't need to scale like
# message storage does. If you ever run more than one backend instance
# behind a load balancer, this map would need to move to something shared
# (e.g. Redis pub/sub) since a user's socket might land on a different
# instance than the peer signaling them.
class ConnectionManager:
    def __init__(self):
        # TenantDict: keys are namespaced per app, so Retail user 5 / call 12 never collide with Bullion user 5 / call 12
        self.active = TenantDict()
        # call_id -> set of user_ids currently "in" the call (accepted)
        self.call_members = TenantDict()

    async def connect(self, user_id: int, ws: WebSocket):
        await ws.accept()
        self.active[user_id] = ws

    def disconnect(self, user_id: int):
        self.active.pop(user_id, None)

    async def send_to(self, user_id: int, message: dict):
        ws = self.active.get(user_id)
        if ws:
            try:
                await ws.send_json(message)
            except Exception:
                pass

    async def broadcast_to(self, user_ids, message: dict, exclude: int = None):
        for uid in user_ids:
            if uid != exclude:
                await self.send_to(uid, message)


manager = ConnectionManager()


def _target_user_ids(call: Call, db: Session) -> list[int]:
    if call.group_id:
        return [m.user_id for m in db.query(GroupMember).filter(GroupMember.group_id == call.group_id).all()]
    return [uid for uid in [call.initiator_id, call.recipient_id] if uid]


@router.get("/ws")
async def call_signaling_ws_info():
    # Documented here for discoverability — the actual endpoint is the
    # @router.websocket("/ws") below; FastAPI doesn't list websocket routes
    # in the OpenAPI schema so this stub keeps it visible in /docs.
    return {"detail": "Connect via WebSocket at this same path with ?token=<jwt>"}


@router.websocket("/ws")
async def call_signaling_ws(websocket: WebSocket, token: str = Query(...), db: Session = Depends(get_db)):
    # Browsers' WebSocket API can't set an Authorization header, so the JWT
    # travels as a query param here instead — same token issued at login,
    # just carried differently for this one connection.
    payload = decode_token(token)
    if not payload:
        await websocket.close(code=4401)
        return
    user_id = int(payload.get("sub"))
    user = db.query(User).filter(User.id == user_id, User.is_active == True).first()
    if not user:
        await websocket.close(code=4401)
        return

    await manager.connect(user_id, websocket)
    try:
        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type")
            call_id = data.get("call_id")

            if msg_type in ("offer", "answer", "ice-candidate"):
                # Pure relay — forward the SDP/ICE payload to the one
                # target peer named in the message. No parsing needed,
                # the browsers negotiate the actual media between
                # themselves once these are exchanged.
                to_user = data.get("to")
                if to_user:
                    await manager.send_to(int(to_user), {**data, "from": user_id})

            elif msg_type == "join":
                # This user has accepted and is ready to negotiate. Tell
                # everyone already in the call to initiate an offer *to*
                # this new user, and tell the new user who's already in
                # so their UI can show them immediately.
                members = manager.call_members.setdefault(call_id, set())
                existing = list(members)
                members.add(user_id)
                await manager.broadcast_to(
                    existing, {"type": "peer-joined", "call_id": call_id, "user_id": user_id}
                )
                await manager.send_to(
                    user_id, {"type": "existing-peers", "call_id": call_id, "user_ids": existing}
                )

            elif msg_type == "leave":
                members = manager.call_members.get(call_id, set())
                members.discard(user_id)
                await manager.broadcast_to(
                    members, {"type": "peer-left", "call_id": call_id, "user_id": user_id}
                )

    except WebSocketDisconnect:
        manager.disconnect(user_id)
        # Drop this user out of any call they were in so the others stop
        # waiting on a peer connection that's never coming back.
        for call_id, members in manager.call_members.items():
            if user_id in members:
                members.discard(user_id)


# ── REST: call lifecycle ─────────────────────────────────────────────────

@router.get("/ice-servers", response_model=IceServersOut)
def get_ice_servers(current_user=Depends(get_current_user)):
    return {"ice_servers": build_ice_servers(current_user.id)}


@router.post("", response_model=CallOut)
async def start_call(payload: CallCreate, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not payload.recipient_id and not payload.group_id:
        raise HTTPException(400, "recipient_id or group_id required")
    if payload.group_id:
        is_member = db.query(GroupMember).filter(
            GroupMember.group_id == payload.group_id, GroupMember.user_id == current_user.id
        ).first()
        if not is_member:
            raise HTTPException(403, "Not a member of this group")

    call = Call(
        initiator_id=current_user.id,
        recipient_id=payload.recipient_id,
        group_id=payload.group_id,
        call_type=payload.call_type if payload.call_type in ("video", "audio") else "video",
        status="ringing",
    )
    db.add(call)
    db.flush()

    target_ids = _target_user_ids(call, db)
    for uid in target_ids:
        db.add(CallParticipant(
            call_id=call.id, user_id=uid,
            joined_at=datetime.now(timezone.utc) if uid == current_user.id else None,
        ))
    db.commit()
    db.refresh(call)

    # Ring everyone else who's currently online, and push everyone else
    # regardless (covers the case where their tab isn't open/focused —
    # that's the whole point of push).
    for uid in target_ids:
        if uid != current_user.id:
            await manager.send_to(uid, {
                "type": "incoming-call",
                "call_id": call.id,
                "call_type": call.call_type,
                "from": current_user.id,
                "from_name": current_user.full_name,
                "group_id": call.group_id,
            })
            send_push_to_user(db, uid, {
                "title": f"{current_user.full_name} is calling",
                "body": "Video call" if call.call_type == "video" else "Voice call",
                "tag": f"call-{call.id}", "url": "/",
            })

    return _call_out(call, db)


@router.post("/{call_id}/respond", response_model=CallOut)
async def respond_to_call(call_id: int, payload: CallRespond, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    call = db.query(Call).filter(Call.id == call_id).first()
    if not call:
        raise HTTPException(404, "Call not found")
    participant = db.query(CallParticipant).filter(
        CallParticipant.call_id == call_id, CallParticipant.user_id == current_user.id
    ).first()
    if not participant:
        raise HTTPException(403, "Not invited to this call")

    if payload.action == "accept":
        participant.joined_at = datetime.now(timezone.utc)
        call.status = "active"
    elif payload.action == "decline":
        participant.declined = "1"
        # Tell the caller right away — otherwise their screen sits on
        # "Connecting..." forever with no signal that anyone actually
        # answered. For a 1-on-1 call the only other party declining
        # means nobody's coming; for a group call, other invitees might
        # still join, so we still notify but the caller's UI decides
        # whether that means "end" (DM) or just "one fewer" (group).
        await manager.send_to(call.initiator_id, {
            "type": "call-declined", "call_id": call.id,
            "user_id": current_user.id, "is_group": bool(call.group_id),
        })
    else:
        raise HTTPException(400, "action must be 'accept' or 'decline'")
    db.commit()
    db.refresh(call)
    return _call_out(call, db)


@router.post("/{call_id}/end", response_model=CallOut)
async def end_call(call_id: int, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    call = db.query(Call).filter(Call.id == call_id).first()
    if not call:
        raise HTTPException(404, "Call not found")

    participant = db.query(CallParticipant).filter(
        CallParticipant.call_id == call_id, CallParticipant.user_id == current_user.id
    ).first()
    if participant and not participant.left_at:
        participant.left_at = datetime.now(timezone.utc)

    members = manager.call_members.get(call_id, set())
    members.discard(current_user.id)
    await manager.broadcast_to(members, {"type": "peer-left", "call_id": call_id, "user_id": current_user.id})

    # Last one out marks the whole call ended.
    if not members:
        call.status = "ended"
        call.ended_at = datetime.now(timezone.utc)
        manager.call_members.pop(call_id, None)

    db.commit()
    db.refresh(call)
    return _call_out(call, db)


@router.get("", response_model=list[CallOut])
def list_calls(limit: int = 50, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    """Call history for the current user — every DM call they were part of,
    plus every call in a group they belong to, newest first."""
    my_group_ids = [m.group_id for m in db.query(GroupMember).filter(GroupMember.user_id == current_user.id).all()]
    participated_call_ids = [
        p.call_id for p in db.query(CallParticipant).filter(CallParticipant.user_id == current_user.id).all()
    ]
    calls = (
        db.query(Call)
        .filter(Call.id.in_(participated_call_ids) if participated_call_ids else False)
        .order_by(Call.started_at.desc())
        .limit(limit)
        .all()
    )
    return [_call_out(c, db) for c in calls]


@router.get("/{call_id}", response_model=CallOut)
def get_call(call_id: int, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    call = db.query(Call).filter(Call.id == call_id).first()
    if not call:
        raise HTTPException(404, "Call not found")
    return _call_out(call, db)


def _call_out(call: Call, db: Session) -> CallOut:
    participants = db.query(CallParticipant).filter(CallParticipant.call_id == call.id).all()
    out = []
    for p in participants:
        user = db.query(User).filter(User.id == p.user_id).first()
        out.append(ParticipantOut(
            user_id=p.user_id,
            full_name=user.full_name if user else None,
            joined_at=p.joined_at,
            left_at=p.left_at,
            declined=(p.declined == "1"),
        ))
    return CallOut(
        id=call.id, initiator_id=call.initiator_id, recipient_id=call.recipient_id,
        group_id=call.group_id, call_type=call.call_type, status=call.status,
        started_at=call.started_at, ended_at=call.ended_at, participants=out,
    )
