from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
import os

from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from .routers import auth, contacts, invoices, analytics, cost_rates, activity_logs, settings, reports, backup, users, day_openings, day_reconciliation, messages, external_sync, dashboard_summary, cash_deposit, calls, push, salesmen, shop_loans
from .core.database import Base, engines
from .core.tenant import TenantMiddleware
from .core.bootstrap import ensure_roles, ensure_bootstrap_admin
from .core.config import get_settings
from .core.rate_limit import limiter

# Create all tables in BOTH databases (use Alembic in production)
for _eng in engines.values():
    Base.metadata.create_all(bind=_eng)


def _run_light_migrations():
    """create_all() never alters tables that already exist, so columns added
    after the first deploy are added here — idempotent, runs on every boot,
    and can never block startup (failures are only printed)."""
    from sqlalchemy import text
    statements = [
        "ALTER TABLE invoices ADD COLUMN IF NOT EXISTS salesman_id INTEGER REFERENCES salesmen(id)",
        "CREATE INDEX IF NOT EXISTS ix_invoices_salesman_id ON invoices (salesman_id)",
        "ALTER TABLE loan_shops ADD COLUMN IF NOT EXISTS credit_limit DOUBLE PRECISION",
    ]
    for app_name, engine in engines.items():
        if engine.dialect.name != "postgresql":
            continue
        for stmt in statements:
            try:
                with engine.begin() as conn:
                    conn.execute(text(stmt))
            except Exception as exc:  # pragma: no cover
                print(f"[migration:{app_name}] skipped: {stmt} -> {exc}")


_run_light_migrations()
ensure_roles()
ensure_bootstrap_admin()

_settings = get_settings()

app = FastAPI(
    title="Swag Gold — Exhibition Ledger API (Retail + Bullion)",
    version="2.0.0",
    description="Full-stack jewelry exhibition ERP with RBAC, analytics, and audit trails",
)

# ── Rate limiting (per-IP) ───────────────────────────────────────────────
# SECURITY FIX: nothing in this API previously capped how many requests a
# single IP (or a botnet of many IPs) could send per minute — every
# endpoint, not just login, could be flooded without limit. This adds a
# reasonable global default (see core/rate_limit.py), with a much
# stricter limit specifically on /login since credential-stuffing/
# brute-force is the highest-value target.
# Note: this slows down and raises the cost of an attack from any ONE IP;
# it is not a substitute for CDN/WAF-level DDoS protection against a truly
# distributed attack spread across thousands of IPs — that layer belongs
# in front of the server (see the deployment notes on Cloudflare).
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_settings.cors_origins,
    # allow_credentials must be False when origins is "*" — the two are
    # mutually exclusive per the CORS spec. We use Bearer tokens, not
    # cookies, so this has no effect on the app either way.
    allow_credentials=_settings.cors_origins != ["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Security headers ─────────────────────────────────────────────────────
# SECURITY FIX: no response previously carried any of the standard
# hardening headers — a malicious site could have embedded this app in an
# invisible iframe (clickjacking), browsers could be tricked into
# mis-interpreting response content types, and there was no HSTS signal
# telling browsers to always use HTTPS for this host going forward.
# Content-Security-Policy is deliberately NOT set here: this backend has a
# fallback static-SPA-serving code path below, and a wrong CSP could
# silently break that page if it's ever actually used (in production the
# real frontend is served separately via Netlify, not through this
# backend) — safer to leave CSP to whichever layer actually serves the
# HTML rather than guess one here that might not match.
@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "geolocation=(), camera=(), microphone=()"
    response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    return response

# Decide which database (retail / bullion) each request uses — see core/tenant.py. Added LAST so it is the OUTERMOST
# middleware and has already run when CORS / rate limiting / the routes execute.
app.add_middleware(TenantMiddleware)

# Register routers
app.include_router(auth.router)
app.include_router(contacts.router)
app.include_router(invoices.router)
app.include_router(analytics.router)
app.include_router(cost_rates.router)
app.include_router(activity_logs.router)
app.include_router(settings.router)
app.include_router(reports.router)
app.include_router(backup.router)
app.include_router(users.router)
app.include_router(day_openings.router)
app.include_router(day_reconciliation.router)
app.include_router(messages.router)
app.include_router(external_sync.router)
app.include_router(cash_deposit.router)
app.include_router(dashboard_summary.router)
app.include_router(calls.router)
app.include_router(push.router)
app.include_router(salesmen.router)
app.include_router(shop_loans.router)


@app.get("/api/health")
def health():
    return {"status": "ok", "service": "Swag Gold API"}


# Serve frontend static files if they exist alongside backend
FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "..", "frontend")
if os.path.isdir(FRONTEND_DIR):
    app.mount("/static", StaticFiles(directory=os.path.join(FRONTEND_DIR, "assets")), name="static")

    @app.get("/", include_in_schema=False)
    def serve_frontend():
        return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))

    @app.get("/{full_path:path}", include_in_schema=False)
    def serve_spa(full_path: str):
        filepath = os.path.join(FRONTEND_DIR, full_path)
        if os.path.isfile(filepath):
            return FileResponse(filepath)
        return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))
