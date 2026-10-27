"""Multi-app (multi-database) support.

One backend serves two separate businesses, each with its OWN database:

    retail   -> DATABASE_URL_RETAIL   (gold unit: 21K-equivalent)
    bullion  -> DATABASE_URL_BULLION  (gold unit: 24K-equivalent)

Which database a request talks to is decided in ONE place — the ASGI middleware at the bottom of this file:
  1. an authenticated request uses the `app` claim inside its JWT (the token is the authority, so a Retail token can
     never read Bullion data, whatever headers the browser sends);
  2. otherwise (login, health) the `X-App` header / `?app=` query parameter is used.
The decision is stored in a ContextVar that database.get_db() reads.
"""
import json
from contextvars import ContextVar
from typing import Dict, Iterator, Optional, Tuple
from urllib.parse import parse_qs

APPS = ("retail", "bullion")

# Gold-equivalent unit each app reports in (grams are converted to this purity).
EQ_KARAT = {"retail": 21, "bullion": 24}

_current_app: ContextVar[Optional[str]] = ContextVar("current_app", default=None)


def set_current_app(app: Optional[str]):
    return _current_app.set(app)


def reset_current_app(token) -> None:
    _current_app.reset(token)


def current_app() -> str:
    """The app (database) the current request belongs to. Raises if none was resolved."""
    app = _current_app.get()
    if app not in APPS:
        raise LookupError("No app selected for this request")
    return app


def eq_karat(app: Optional[str] = None) -> int:
    return EQ_KARAT[app or current_app()]


def to_eq(w24, w21, w18, app: Optional[str] = None) -> float:
    """Convert 24K / 21K / 18K grams to the current app's equivalent-purity grams."""
    k = eq_karat(app)
    return (w24 or 0) * 24 / k + (w21 or 0) * 21 / k + (w18 or 0) * 18 / k


class TenantDict:
    """A dict whose keys are automatically namespaced by the current app, so in-memory state (online presence, typing
    indicators, websocket connections, call rooms) of Retail and Bullion can never mix, even when user id 5 exists in
    both databases."""

    def __init__(self):
        self._d: Dict[Tuple[str, object], object] = {}

    def _k(self, key):
        return (current_app(), key)

    def __getitem__(self, key):
        return self._d[self._k(key)]

    def __setitem__(self, key, value):
        self._d[self._k(key)] = value

    def __contains__(self, key):
        return self._k(key) in self._d

    def get(self, key, default=None):
        return self._d.get(self._k(key), default)

    def setdefault(self, key, default=None):
        return self._d.setdefault(self._k(key), default)

    def pop(self, key, *default):
        return self._d.pop(self._k(key), *default)

    def items(self):
        app = current_app()
        return [(k[1], v) for k, v in list(self._d.items()) if k[0] == app]


# ── ASGI middleware (works for both HTTP and WebSocket) ──────────────────────────────────────────────────────────
def _app_from_token(token: str) -> Optional[str]:
    from .security import decode_token  # local import: security imports this module
    payload = decode_token(token) if token else None
    app = payload.get("app") if payload else None
    return app if app in APPS else None


class TenantMiddleware:
    def __init__(self, app):   # parameter MUST be called `app`: older Starlette instantiates middleware with app=...
        self.asgi = app

    async def __call__(self, scope, receive, send):
        if scope["type"] not in ("http", "websocket"):
            return await self.asgi(scope, receive, send)

        headers = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope.get("headers", [])}
        query = parse_qs(scope.get("query_string", b"").decode("latin-1"))

        token = ""
        auth = headers.get("authorization", "")
        if auth[:7].lower() == "bearer ":
            token = auth[7:].strip()
        elif query.get("token"):
            token = query["token"][0]  # WebSockets can't set headers

        app = _app_from_token(token)
        if app is None:
            hint = headers.get("x-app") or (query.get("app") or [""])[0]
            app = hint.strip().lower() if hint.strip().lower() in APPS else None
        # (An invalid/expired token resolves to nothing here and is rejected later by get_current_user -> 401.
        #  A VALID token always wins over the header, so a header can never redirect an authenticated request.)

        if scope["type"] == "websocket" and app is None:
            # No valid app/token: refuse the socket right here (same 4401 the handler uses for a bad token), instead of
            # letting a dependency exception surface differently on different Starlette versions.
            await receive()  # the initial websocket.connect message
            return await send({"type": "websocket.close", "code": 4401})

        ctx = set_current_app(app)
        try:
            return await self.asgi(scope, receive, send)
        finally:
            reset_current_app(ctx)
