from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import or_, and_, desc
from typing import List
from ..core.database import get_db
from ..core.tenant import TenantDict
from ..core.security import get_current_user
from ..models.message import Message, Group, GroupMember, MessageReadReceipt
from ..models.user import User
from ..core.push import send_push_to_user
from ..schemas.message import (
    MessageCreate, MessageResponse, MessageEdit, ConversationSummary,
    BroadcastCreate, GroupCreate, GroupResponse,
)

router = APIRouter(prefix="/api/messages", tags=["messages"])

MAX_ATTACHMENT_BYTES = 1_500_000
EDIT_WINDOW_MINUTES = 2  # matches the "2 minutes" grace period shown in the UI

# ── Typing indicator — in-memory, same lightweight pattern as online
# presence. Keyed by (sender_id, "u<recipient_id>" or "g<group_id>") so a
# DM and a group typing state never collide. Entries older than a couple
# seconds are treated as "stopped typing" without needing an explicit
# stop-typing call (the frontend just stops re-sending the ping).
_typing = TenantDict()   # namespaced per app (user ids repeat across the two databases)
TYPING_WINDOW_SECONDS = 4


def _typing_key(sender_id: int, recipient_id=None, group_id=None) -> str:
    target = f"u{recipient_id}" if recipient_id else f"g{group_id}"
    return f"{sender_id}:{target}"


@router.post("/typing")
def send_typing(payload: dict, current_user=Depends(get_current_user)):
    recipient_id = payload.get("recipient_id")
    group_id = payload.get("group_id")
    _typing[_typing_key(current_user.id, recipient_id, group_id)] = datetime.now(timezone.utc)
    return {"ok": True}


@router.get("/typing/status")
def get_typing_status(recipient_id: int = None, group_id: int = None, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    """Who (other than me) is currently typing in this DM or group."""
    cutoff = datetime.now(timezone.utc) - timedelta(seconds=TYPING_WINDOW_SECONDS)
    typing_user_ids = []
    if group_id:
        member_ids = [m.user_id for m in db.query(GroupMember).filter(GroupMember.group_id == group_id).all()]
        for uid in member_ids:
            if uid == current_user.id:
                continue
            key = _typing_key(uid, group_id=group_id)
            if _typing.get(key, datetime.min.replace(tzinfo=timezone.utc)) >= cutoff:
                typing_user_ids.append(uid)
    elif recipient_id:
        key = _typing_key(recipient_id, recipient_id=current_user.id)
        if _typing.get(key, datetime.min.replace(tzinfo=timezone.utc)) >= cutoff:
            typing_user_ids.append(recipient_id)
    return {"typing_user_ids": typing_user_ids}


@router.get("/conversations", response_model=List[ConversationSummary])
def list_conversations(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    """Every other active user, with a preview of your most recent message
    with them (if any) and how many of their messages you haven't read yet.
    Shows everyone (not just people you've already messaged) since this is
    a small team — you should be able to start a chat with anyone."""
    others = db.query(User).filter(User.id != current_user.id, User.is_active == True).all()

    summaries = []
    for u in others:
        last_msg = (
            db.query(Message)
            .filter(
                or_(
                    and_(Message.sender_id == current_user.id, Message.recipient_id == u.id),
                    and_(Message.sender_id == u.id, Message.recipient_id == current_user.id),
                ),
                Message.is_deleted == False,
            )
            .order_by(desc(Message.created_at))
            .first()
        )
        unread = (
            db.query(Message)
            .filter(Message.sender_id == u.id, Message.recipient_id == current_user.id,
                     Message.is_read == False, Message.is_deleted == False)
            .count()
        )
        summaries.append(ConversationSummary(
            user_id=u.id,
            full_name=u.full_name,
            username=u.username,
            last_message=last_msg.body if last_msg else None,
            last_message_at=last_msg.created_at if last_msg else None,
            unread_count=unread,
        ))

    summaries.sort(key=lambda s: s.last_message_at or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
    return summaries


# ── Groups ──────────────────────────────────────────────────────────────

@router.post("/groups", response_model=GroupResponse, status_code=201)
def create_group(payload: GroupCreate, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Group name can't be empty")
    group = Group(name=name, created_by=current_user.id)
    db.add(group)
    db.flush()  # get group.id before adding members

    member_ids = set(payload.member_ids) | {current_user.id}  # creator is always a member
    for uid in member_ids:
        db.add(GroupMember(group_id=group.id, user_id=uid))
    db.commit()
    db.refresh(group)

    members = db.query(GroupMember).filter(GroupMember.group_id == group.id).all()
    return GroupResponse(
        id=group.id, name=group.name, created_by=group.created_by,
        member_ids=[m.user_id for m in members],
        member_names=[m.user.full_name for m in members if m.user],
        created_at=group.created_at,
    )


@router.delete("/groups/{group_id}", status_code=204)
def delete_group(group_id: int, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    group = db.query(Group).filter(Group.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    # Only the person who created the group, or an admin, can delete it —
    # otherwise any member could remove a group out from under everyone else.
    if group.created_by != current_user.id and current_user.role.name != "admin":
        raise HTTPException(status_code=403, detail="Only the group creator or an admin can delete this group")
    db.query(Message).filter(Message.group_id == group_id).delete()
    db.query(GroupMember).filter(GroupMember.group_id == group_id).delete()
    db.delete(group)
    db.commit()
    return None


@router.get("/groups", response_model=List[GroupResponse])
def list_groups(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    my_group_ids = [m.group_id for m in db.query(GroupMember).filter(GroupMember.user_id == current_user.id).all()]
    groups = db.query(Group).filter(Group.id.in_(my_group_ids)).all()

    result = []
    for group in groups:
        members = db.query(GroupMember).filter(GroupMember.group_id == group.id).all()
        last_msg = (
            db.query(Message)
            .filter(Message.group_id == group.id, Message.is_deleted == False)
            .order_by(desc(Message.created_at))
            .first()
        )
        unread = (
            db.query(Message)
            .filter(Message.group_id == group.id, Message.sender_id != current_user.id,
                     Message.is_read == False, Message.is_deleted == False)
            .count()
        )
        result.append(GroupResponse(
            id=group.id, name=group.name, created_by=group.created_by,
            member_ids=[m.user_id for m in members],
            member_names=[m.user.full_name for m in members if m.user],
            last_message=last_msg.body if last_msg else None,
            last_message_at=last_msg.created_at if last_msg else None,
            unread_count=unread,
            created_at=group.created_at,
        ))
    result.sort(key=lambda g: g.last_message_at or g.created_at, reverse=True)
    return result


@router.get("/groups/{group_id}/messages", response_model=List[MessageResponse])
def get_group_messages(group_id: int, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    is_member = db.query(GroupMember).filter(GroupMember.group_id == group_id, GroupMember.user_id == current_user.id).first()
    if not is_member:
        raise HTTPException(status_code=403, detail="You're not a member of this group")
    msgs = db.query(Message).options(joinedload(Message.sender)).filter(Message.group_id == group_id).order_by(Message.created_at).all()

    # Record this user's own read receipt on every message from someone
    # else they hadn't already acknowledged — one row per (message, user),
    # so "seen by" can later show exactly who, not just a count.
    already_read_ids = {
        r.message_id for r in db.query(MessageReadReceipt.message_id).filter(
            MessageReadReceipt.user_id == current_user.id,
            MessageReadReceipt.message_id.in_([m.id for m in msgs]),
        ).all()
    }
    for m in msgs:
        if m.sender_id != current_user.id and m.id not in already_read_ids:
            db.add(MessageReadReceipt(message_id=m.id, user_id=current_user.id))
    db.query(Message).filter(
        Message.group_id == group_id, Message.sender_id != current_user.id, Message.is_read == False
    ).update({"is_read": True})
    db.commit()
    return [_to_response(m, db) for m in msgs]


# ── Direct messages ──────────────────────────────────────────────────────

@router.get("/{other_user_id}", response_model=List[MessageResponse])
def get_conversation(other_user_id: int, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    msgs = (
        db.query(Message)
        .options(joinedload(Message.sender))
        .filter(
            or_(
                and_(Message.sender_id == current_user.id, Message.recipient_id == other_user_id),
                and_(Message.sender_id == other_user_id, Message.recipient_id == current_user.id),
            )
        )
        .order_by(Message.created_at)
        .all()
    )
    return [_to_response(m, db) for m in msgs]


def _to_response(m: Message, db: Session) -> MessageResponse:
    read_by = []
    if m.group_id:
        read_by = [r.user_id for r in db.query(MessageReadReceipt).filter(MessageReadReceipt.message_id == m.id).all()]
    return MessageResponse(
        id=m.id, sender_id=m.sender_id, recipient_id=m.recipient_id, group_id=m.group_id,
        sender_name=m.sender.full_name if m.sender else None,
        body=m.body if not m.is_deleted else None,
        attachment_data=m.attachment_data if not m.is_deleted else None,
        attachment_name=m.attachment_name if not m.is_deleted else None,
        is_read=m.is_read, read_by=read_by, is_broadcast=m.is_broadcast, is_deleted=m.is_deleted,
        edited_at=m.edited_at, created_at=m.created_at,
    )


@router.post("", response_model=MessageResponse, status_code=201)
def send_message(payload: MessageCreate, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    body = (payload.body or "").strip()
    if not body and not payload.attachment_data:
        raise HTTPException(status_code=422, detail="Message can't be empty")
    if payload.attachment_data and len(payload.attachment_data) > MAX_ATTACHMENT_BYTES:
        raise HTTPException(status_code=413, detail="Attachment is too large (max ~1MB)")
    if not payload.recipient_id and not payload.group_id:
        raise HTTPException(status_code=422, detail="Message needs a recipient or a group")

    if payload.group_id:
        is_member = db.query(GroupMember).filter(
            GroupMember.group_id == payload.group_id, GroupMember.user_id == current_user.id
        ).first()
        if not is_member:
            raise HTTPException(status_code=403, detail="You're not a member of this group")
    elif payload.recipient_id:
        recipient = db.query(User).filter(User.id == payload.recipient_id).first()
        if not recipient:
            raise HTTPException(status_code=404, detail="Recipient not found")

    msg = Message(
        sender_id=current_user.id, recipient_id=payload.recipient_id, group_id=payload.group_id,
        body=body or None, attachment_data=payload.attachment_data, attachment_name=payload.attachment_name,
    )
    db.add(msg)
    db.commit()
    db.refresh(msg)

    # Push to whoever should see this — the recipient for a DM, or every
    # other group member for a group message. Sent regardless of whether
    # they're actively connected (the service worker on their end decides
    # whether to actually show it, e.g. skip if that chat is focused).
    push_body = (body[:120] if body else "Sent an attachment")
    if payload.recipient_id:
        send_push_to_user(db, payload.recipient_id, {
            "title": current_user.full_name, "body": push_body,
            "tag": f"dm-{current_user.id}", "url": "/",
        })
    elif payload.group_id:
        member_ids = [m.user_id for m in db.query(GroupMember).filter(
            GroupMember.group_id == payload.group_id, GroupMember.user_id != current_user.id
        ).all()]
        for uid in member_ids:
            send_push_to_user(db, uid, {
                "title": f"{current_user.full_name}", "body": push_body,
                "tag": f"group-{payload.group_id}", "url": "/",
            })
    return _to_response(msg, db)


@router.put("/{message_id}", response_model=MessageResponse)
def edit_message(message_id: int, payload: MessageEdit, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    msg = db.query(Message).filter(Message.id == message_id).first()
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")
    if msg.sender_id != current_user.id:
        raise HTTPException(status_code=403, detail="You can only edit your own messages")
    if msg.is_deleted:
        raise HTTPException(status_code=400, detail="Can't edit a deleted message")
    age = datetime.now(timezone.utc) - msg.created_at.replace(tzinfo=timezone.utc)
    if age > timedelta(minutes=EDIT_WINDOW_MINUTES):
        raise HTTPException(status_code=400, detail=f"Messages can only be edited within {EDIT_WINDOW_MINUTES} minutes of sending")
    if not payload.body.strip():
        raise HTTPException(status_code=422, detail="Message can't be empty")

    msg.body = payload.body.strip()
    msg.edited_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(msg)
    return _to_response(msg, db)


@router.delete("/{message_id}", status_code=204)
def delete_message(message_id: int, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    msg = db.query(Message).filter(Message.id == message_id).first()
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")
    if msg.sender_id != current_user.id:
        raise HTTPException(status_code=403, detail="You can only delete your own messages")
    age = datetime.now(timezone.utc) - msg.created_at.replace(tzinfo=timezone.utc)
    if age > timedelta(minutes=EDIT_WINDOW_MINUTES):
        raise HTTPException(status_code=400, detail=f"Messages can only be deleted within {EDIT_WINDOW_MINUTES} minutes of sending")
    msg.is_deleted = True
    msg.body = None
    msg.attachment_data = None
    msg.attachment_name = None
    db.commit()


@router.post("/broadcast", response_model=List[MessageResponse], status_code=201)
def send_broadcast(payload: BroadcastCreate, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    """Admin-only — sends the same announcement to every other active user
    in one go, instead of messaging each person individually."""
    if current_user.role.name != "admin":
        raise HTTPException(status_code=403, detail="Only admins can send announcements")
    body = (payload.body or "").strip()
    if not body:
        raise HTTPException(status_code=422, detail="Announcement can't be empty")

    recipients = db.query(User).filter(User.id != current_user.id, User.is_active == True).all()
    created = []
    for r in recipients:
        msg = Message(sender_id=current_user.id, recipient_id=r.id, body=body, is_broadcast=True)
        db.add(msg)
        created.append(msg)
    db.commit()
    for msg in created:
        db.refresh(msg)
    return [_to_response(m, db) for m in created]


@router.post("/{other_user_id}/read")
def mark_read(other_user_id: int, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    db.query(Message).filter(
        Message.sender_id == other_user_id,
        Message.recipient_id == current_user.id,
        Message.is_read == False,
    ).update({"is_read": True})
    db.commit()
    return {"ok": True}


@router.get("/unread/count")
def unread_count(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    dm_count = db.query(Message).filter(Message.recipient_id == current_user.id, Message.is_read == False).count()
    my_group_ids = [m.group_id for m in db.query(GroupMember).filter(GroupMember.user_id == current_user.id).all()]
    group_count = db.query(Message).filter(
        Message.group_id.in_(my_group_ids), Message.sender_id != current_user.id, Message.is_read == False
    ).count() if my_group_ids else 0
    return {"count": dm_count + group_count}
