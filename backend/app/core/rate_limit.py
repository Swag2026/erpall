from slowapi import Limiter
from slowapi.util import get_remote_address

from .security import decode_token


def _rate_key(request) -> str:
    """Who is making the request?

    Logged-in calls are limited PER USER (and per app, since user ids repeat across the two databases). The old key
    was the plain remote address, which behind a proxy / Cloudflare tunnel (or one office router) is the SAME address
    for the whole team, so everyone shared a single bucket and the app could start answering 429 to staff during
    normal use. Calls without a token (login) fall back to the real client IP (Cloudflare / proxy header first), so
    the strict login limit still protects against brute force."""
    auth = request.headers.get("authorization", "")
    if auth[:7].lower() == "bearer ":
        payload = decode_token(auth[7:].strip())
        if payload and payload.get("sub") is not None:
            return f"u:{payload.get('app', '?')}:{payload['sub']}"
    ip = (
        request.headers.get("cf-connecting-ip")
        or request.headers.get("x-forwarded-for", "").split(",")[0].strip()
        or get_remote_address(request)
    )
    return f"ip:{ip}"


# 600/min per logged-in user is ~10 requests a second: far above real use, but still stops a runaway script.
# Login keeps its own strict 10/min per IP (see routers/auth.py).
limiter = Limiter(key_func=_rate_key, default_limits=["600/minute"])
