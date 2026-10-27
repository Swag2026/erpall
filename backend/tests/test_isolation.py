"""Deep isolation test: the SAME user ids / invoice numbers / contact ids exist in both databases, every table gets
rows tagged with the owning app's marker, then EVERY readable endpoint is swept with both tokens and no response may
ever contain the other app's marker.

Run:  cd backend && python -m pytest tests/test_isolation.py -q
"""
import json
import os
import tempfile

_tmp = tempfile.mkdtemp()
os.environ["DATABASE_URL_RETAIL"] = f"sqlite:///{_tmp}/retail.db"
os.environ["DATABASE_URL_BULLION"] = f"sqlite:///{_tmp}/bullion.db"
os.environ["SECRET_KEY"] = "y" * 40
os.environ["ALLOWED_ORIGINS"] = "*"

import pytest                                   # noqa: E402
from fastapi.testclient import TestClient       # noqa: E402

from app.main import app                        # noqa: E402
from app.core.database import db_for            # noqa: E402
from app.core.security import hash_password      # noqa: E402
from app.models.user import User, Role           # noqa: E402

app.state.limiter.enabled = False
client = TestClient(app)
PW = "Passw0rd!x"
APPS = ("retail", "bullion")
MARK = {"retail": "RETAILMARK", "bullion": "BULLIONMARK"}
OTHER = {"retail": "bullion", "bullion": "retail"}
TOK = {}
IDS = {}


def H(app_name):
    return {"Authorization": f"Bearer {TOK[app_name]}"}


def ok(r, *codes):
    assert r.status_code in (codes or (200, 201, 204)), f"{r.request.method} {r.request.url.path} -> {r.status_code} {r.text[:300]}"
    return r


def _reset_databases():
    """Each test module starts from empty databases (both modules share one process and one pair of DB files)."""
    from app.core.database import Base, engines
    from app.core.bootstrap import ensure_roles
    for eng in engines.values():
        Base.metadata.drop_all(bind=eng)
        Base.metadata.create_all(bind=eng)
    ensure_roles()


@pytest.fixture(scope="module", autouse=True)
def world():
    _reset_databases()
    # identical usernames AND identical user ids (alice=1, bob=2) in both databases, different display names
    for a in APPS:
        with db_for(a) as db:
            roles = {r.name: r.id for r in db.query(Role).all()}
            db.add(User(username="alice", full_name=f"{MARK[a]} Alice", hashed_password=hash_password(PW), role_id=roles["admin"]))
            db.add(User(username="bob", full_name=f"{MARK[a]} Bob", hashed_password=hash_password(PW), role_id=roles["cashier"]))
            db.commit()
    for a in APPS:
        r = ok(client.post("/api/auth/login", json={"username": "alice", "password": PW, "app": a}))
        TOK[a] = r.json()["access_token"]
        r = ok(client.post("/api/auth/login", json={"username": "bob", "password": PW, "app": a}))
        TOK[a + "_bob"] = r.json()["access_token"]
    for a in APPS:
        seed(a)


def seed(a):
    h, m = H(a), MARK[a]
    c = ok(client.post("/api/contacts", json={"name": f"{m} Customer", "phone": "0500000000", "contact_type": "customer", "city": f"{m} City", "notes": f"{m} note"}, headers=h)).json()
    s = ok(client.post("/api/salesmen", json={"name": f"{m} Salesman"}, headers=h)).json()
    inv = ok(client.post("/api/invoices", json={
        "invoice_no": "INV-0001", "invoice_date": "2026-10-20", "category": "sale", "contact_id": c["id"], "salesman_id": s["id"],
        "weight_21k": 10, "amount_21k": 5000, "total_amount": 5000, "cash_amount": 3000, "card_amount": 2000, "notes": f"{m} invoice note"}, headers=h)).json()
    ok(client.post("/api/invoices", json={
        "invoice_no": "INV-0002", "invoice_date": "2026-10-20", "category": "cash_deposit", "total_amount": 700 if a == "retail" else 900,
        "cash_amount": 700 if a == "retail" else 900, "payment_source": "cash_deposit", "notes": f"{m} deposit"}, headers=h))
    ok(client.post("/api/invoices", json={
        "invoice_no": "INV-0003", "invoice_date": "2026-10-20", "category": "expense", "total_amount": 100, "cash_amount": 100, "card_amount": 0,
        "payment_source": "main", "notes": f"{m} expense"}, headers=h))
    ok(client.post("/api/cost-rates", json={"purity": "21K", "cost_per_gram": 250.0 if a == "retail" else 333.0}, headers=h), 200, 201)
    ok(client.put("/api/settings", json={"settings": {"company_name": f"{m} Co"}}, headers=h))
    shop = ok(client.post("/api/shop-loans/shops", json={"name": f"{m} Shop"}, headers=h)).json()
    ok(client.post("/api/shop-loans/entries", json={"shop_id": shop["id"], "entry_type": "lend", "entry_date": "2026-10-20", "weight_24k": 10, "note": f"{m} loan"}, headers=h))
    ok(client.put("/api/day-openings/2026-10-20", json={"opening_cash": 1111 if a == "retail" else 2222, "opening_gold": 5, "opening_silver": 0}, headers=h))
    ok(client.put("/api/reconciliations/2026-10-19", json={"system_closing_cash": 0, "counted_cash": 12.5, "note": f"{m} close"}, headers=h))
    ok(client.post("/api/messages", json={"recipient_id": 2, "body": f"{m} hello bob"}, headers=h))
    ok(client.post("/api/messages/groups", json={"name": f"{m} Group", "member_ids": [2]}, headers=h))
    ok(client.post("/api/messages/broadcast", json={"body": f"{m} broadcast"}, headers=h))
    ok(client.post("/api/push/subscribe", json={"endpoint": f"https://push.example/{m}", "p256dh": "k", "auth": "a"}, headers=h))
    ok(client.put("/api/auth/profile", json={"email": f"{m.lower()}@example.com", "phone": "0555"}, headers=h))
    ok(client.post("/api/auth/heartbeat", headers=H(a + "_bob")))
    IDS[a] = {"contact": c["id"], "invoice": inv["id"], "salesman": s["id"], "shop": shop["id"]}


def get_routes():
    spec = client.get("/openapi.json").json()["paths"]
    return sorted(p for p, ops in spec.items() if "get" in ops and "{" not in p and p not in ("/api/health", "/api/calls/ws", "/api/backup/export"))


# GETs that need query params / are expected to be non-200 without them
NEEDS_PARAMS = {"/api/messages/typing/status": {}, "/api/reports/comparison": {"period": "month"}, "/api/reports/daily": {"report_date": "2026-10-20"}}


def sweep(a):
    out = {}
    for p in get_routes():
        r = client.get(p, params=NEEDS_PARAMS.get(p, {}), headers=H(a))
        out[p] = (r.status_code, r.text)
    return out


def test_every_endpoint_both_apps_no_foreign_marker():
    leaks, seen_own = [], {a: set() for a in APPS}
    results = {a: sweep(a) for a in APPS}
    for a in APPS:
        for path, (code, text) in results[a].items():
            assert code < 500, f"{a} {path} -> {code} {text[:200]}"
            if MARK[OTHER[a]] in text:
                leaks.append((a, path))
            if MARK[a] in text:
                seen_own[a].add(path)
    assert not leaks, f"CROSS-APP LEAK in: {leaks}"
    # sanity: the sweep really exercised the seeded data (otherwise 'no leak' proves nothing)
    for a in APPS:
        assert len(seen_own[a]) >= 8, f"{a}: only {sorted(seen_own[a])} contained own data"
    assert seen_own["retail"] == seen_own["bullion"], (seen_own["retail"] ^ seen_own["bullion"])


def test_by_id_endpoints_and_id_collisions():
    for a in APPS:
        h, m = H(a), MARK[a]
        assert IDS[a] == {"contact": 1, "invoice": 1, "salesman": 1, "shop": 1}   # ids collide on purpose
        assert m in ok(client.get("/api/contacts/1", headers=h)).text and MARK[OTHER[a]] not in client.get("/api/contacts/1", headers=h).text
        assert m in ok(client.get("/api/invoices/1", headers=h)).text and MARK[OTHER[a]] not in client.get("/api/invoices/1", headers=h).text
        assert m in ok(client.get("/api/shop-loans/entries/1", headers=h)).text
        assert m in ok(client.get("/api/messages/2", headers=h)).text and MARK[OTHER[a]] not in client.get("/api/messages/2", headers=h).text


def test_totals_differ_per_app_not_summed():
    # cash deposit balance: retail 700, bullion 900; opening cash 1111 vs 2222; cost rate 250 vs 333; each app sees only its own
    for a, dep, opening, rate in (("retail", 700, 1111, 250.0), ("bullion", 900, 2222, 333.0)):
        h = H(a)
        assert json.dumps(ok(client.get("/api/cash-deposit/summary", headers=h)).json()).count(str(dep)) >= 1
        ops = ok(client.get("/api/day-openings", headers=h)).json()
        assert [o["opening_cash"] for o in ops if o["opening_date"] == "2026-10-20"] == [opening]
        assert [r["cost_per_gram"] for r in ok(client.get("/api/cost-rates", headers=h)).json()] == [rate]
        assert len(ok(client.get("/api/invoices", headers=h)).json()) == 3
        assert len(ok(client.get("/api/contacts", headers=h)).json()) == 1
        assert len(ok(client.get("/api/shop-loans/shops", headers=h)).json()) == 1


def test_database_rows_physically_separate():
    from app.models.invoice import Invoice
    from app.models.contact import Contact
    from app.models.message import Message
    from app.models.push_subscription import PushSubscription
    from app.models.activity_log import ActivityLog
    for a in APPS:
        with db_for(a) as db:
            assert db.query(Invoice).count() == 3
            assert {c.name for c in db.query(Contact).all()} == {f"{MARK[a]} Customer"}
            assert all(MARK[a] in m.body for m in db.query(Message).all())
            assert [s.endpoint for s in db.query(PushSubscription).all()] == [f"https://push.example/{MARK[a]}"]
            assert db.query(ActivityLog).count() > 0
            assert not any(MARK[OTHER[a]] in (l.note or "") for l in db.query(ActivityLog).all())


def test_settings_and_permissions_independent():
    ok(client.put("/api/settings", json={"settings": {"company_name": "RETAILMARK Changed"}}, headers=H("retail")))
    assert "RETAILMARK Changed" not in client.get("/api/settings", headers=H("bullion")).text
    # flip a permission in Retail only
    p = ok(client.get("/api/settings/permissions", headers=H("retail"))).json()
    before_b = client.get("/api/settings/permissions", headers=H("bullion")).json()
    perms = {"cashier": {"page.history.view": False}}
    ok(client.put("/api/settings/permissions", json={"permissions": perms}, headers=H("retail")))
    assert ok(client.get("/api/auth/my-permissions", headers=H("retail_bob"))).json()["page.history.view"] is False
    assert ok(client.get("/api/auth/my-permissions", headers=H("bullion_bob"))).json()["page.history.view"] is True
    assert client.get("/api/settings/permissions", headers=H("bullion")).json() == before_b


def test_users_lists_and_login_history_separate():
    for a in APPS:
        users = ok(client.get("/api/users", headers=H(a))).json()
        assert {u["full_name"] for u in users} == {f"{MARK[a]} Alice", f"{MARK[a]} Bob"}
        assert MARK[OTHER[a]] not in client.get("/api/auth/login-attempts", headers=H(a)).text
    # presence: only Retail Bob heartbeated "just now" for bob; Bullion's online list must not contain RETAIL names
    assert MARK["retail"] not in client.get("/api/auth/online", headers=H("bullion")).text
    assert MARK["bullion"] not in client.get("/api/auth/online", headers=H("retail")).text


def test_backup_export_only_own_data():
    for a in APPS:
        r = ok(client.get("/api/backup/export", headers=H(a)))
        assert MARK[a] in r.text and MARK[OTHER[a]] not in r.text
        h = ok(client.get("/api/backup/health", headers=H(a)))
        assert MARK[OTHER[a]] not in h.text


def test_websocket_rooms_and_user_ids_do_not_mix():
    # user id 1 and 2 exist in BOTH apps, and both apps use call_id 7
    with client.websocket_connect(f"/api/calls/ws?token={TOK['retail']}") as ra, \
         client.websocket_connect(f"/api/calls/ws?token={TOK['retail_bob']}") as rb, \
         client.websocket_connect(f"/api/calls/ws?token={TOK['bullion']}") as ba, \
         client.websocket_connect(f"/api/calls/ws?token={TOK['bullion_bob']}") as bb:
        ra.send_json({"type": "join", "call_id": 7}); assert ra.receive_json()["user_ids"] == []
        # Bullion bob joins "call 7" too: must NOT see Retail alice (id 1) as an existing peer
        bb.send_json({"type": "join", "call_id": 7}); msg = bb.receive_json()
        assert msg["type"] == "existing-peers" and msg["user_ids"] == [], msg
        # Retail bob joins -> sees Retail alice only, and Retail alice is told
        rb.send_json({"type": "join", "call_id": 7}); assert rb.receive_json()["user_ids"] == [1]
        assert ra.receive_json()["type"] == "peer-joined"
        # signaling from Retail alice to user 2 reaches RETAIL bob only
        ra.send_json({"type": "offer", "call_id": 7, "to": 2, "sdp": "RETAILMARK-sdp"})
        got = rb.receive_json(); assert got["sdp"] == "RETAILMARK-sdp" and got["from"] == 1
        # prove Bullion bob received nothing stray: his next message is the answer to his own next join
        bb.send_json({"type": "join", "call_id": 8}); nxt = bb.receive_json()
        assert nxt["type"] == "existing-peers" and nxt["call_id"] == 8, nxt
        ba.send_json({"type": "join", "call_id": 8}); got = ba.receive_json()
        assert got["user_ids"] == [2]                       # Bullion alice sees Bullion bob (id 2) in call 8 — not before


def test_typing_indicator_namespaced():
    ok(client.post("/api/messages/typing", json={"recipient_id": 1}, headers=H("retail_bob")))
    r = ok(client.get("/api/messages/typing/status", params={"recipient_id": 2}, headers=H("retail"))).json()
    assert r["typing_user_ids"] == [2]
    r = ok(client.get("/api/messages/typing/status", params={"recipient_id": 2}, headers=H("bullion"))).json()
    assert r["typing_user_ids"] == []


def test_token_cannot_be_replayed_across_apps_even_with_same_user_id():
    # Retail alice (id 1) and Bullion alice (id 1): re-signing the SAME sub with the other app's claim is rejected only
    # because the claim is what selects the DB. A token signed for retail can never reach bullion rows.
    assert MARK["retail"] in client.get("/api/contacts", headers=H("retail")).text
    assert MARK["retail"] not in client.get("/api/contacts", headers={**H("bullion"), "X-App": "retail"}).text
    assert MARK["retail"] not in client.get("/api/contacts?app=retail", headers=H("bullion")).text
