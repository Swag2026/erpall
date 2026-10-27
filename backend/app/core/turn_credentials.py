import hmac
import hashlib
import base64
import time
from .config import get_settings

settings = get_settings()


def generate_turn_credentials(user_id: int, ttl_seconds: int = 3600) -> dict | None:
    """Time-limited TURN credentials using coturn's static-auth-secret
    scheme: username is "<expiry_unix_ts>:<user_id>", password is a
    base64 HMAC-SHA1 of that username keyed with the shared secret.
    coturn is configured with the same secret and validates identically
    on its side (use-auth-secret + static-auth-secret in turnserver.conf)
    — nothing per-user to provision, rotate, or store in the database.
    Returns None if no TURN server is configured (falls back to STUN-only,
    which works on most networks but not ones behind symmetric NAT/strict
    firewalls, e.g. some office networks)."""
    if not settings.TURN_SECRET or not settings.TURN_URLS:
        return None
    expiry = int(time.time()) + ttl_seconds
    username = f"{expiry}:{user_id}"
    digest = hmac.new(settings.TURN_SECRET.encode(), username.encode(), hashlib.sha1).digest()
    password = base64.b64encode(digest).decode()
    return {"username": username, "credential": password}


def build_ice_servers(user_id: int) -> list[dict]:
    servers = [{"urls": ["stun:stun.l.google.com:19302"]}]
    turn_creds = generate_turn_credentials(user_id)
    if turn_creds and settings.TURN_URLS:
        urls = [u.strip() for u in settings.TURN_URLS.split(",") if u.strip()]
        servers.append({"urls": urls, **turn_creds})
    return servers
