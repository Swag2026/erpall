"""Integration test: one backend, two databases (SQLite files here, PostgreSQL in production).

Run:  cd backend && python -m pytest tests -q
"""
import os
import tempfile

_tmp = tempfile.mkdtemp()
os.environ["DATABASE_URL_RETAIL"] = f"sqlite:///{_tmp}/retail.db"
os.environ["DATABASE_URL_BULLION"] = f"sqlite:///{_tmp}/bullion.db"
os.environ["SECRET_KEY"] = "x" * 40
os.environ["ALLOWED_ORIGINS"] = "*"

import pytest                                   # noqa: E402
from fastapi.testclient import TestClient       # noqa: E402

from app.main import app                        # noqa: E402
from app.core.database import db_for            # noqa: E402
from app.core.security import hash_password      # noqa: E402
from app.models.user import User, Role           # noqa: E402

app.state.limiter.enabled = False   # the real 10/min login limit would trip over this test's many logins
client = TestClient(app)
PW = "Passw0rd!x"


def _reset_databases():
    """Each test module starts from empty databases (both modules share one process and one pair of DB files)."""
    from app.core.database import Base, engines
    from app.core.bootstrap import ensure_roles
    for eng in engines.values():
        Base.metadata.drop_all(bind=eng)
        Base.metadata.create_all(bind=eng)
    ensure_roles()


@pytest.fixture(scope="module", autouse=True)
def seed():
    _reset_databases()
    for name, users in {
        "retail": [("alice", "admin"), ("bob", "cashier")],      # bob: Retail only
        "bullion": [("alice", "admin"), ("carol", "admin")],     # carol: Bullion only
    }.items():
        with db_for(name) as db:
            roles = {r.name: r.id for r in db.query(Role).all()}
            assert {"admin", "supervisor", "cashier"} <= set(roles), "ensure_roles() should create standard roles"
            for u, role in users:
                db.add(User(username=u, full_name=u.title(), hashed_password=hash_password(PW), role_id=roles[role]))
            db.commit()


def login(user, app_name, pw=PW):
    return client.post("/api/auth/login", json={"username": user, "password": pw, "app": app_name})


def H(tok, **extra):
    return {"Authorization": f"Bearer {tok}", **extra}


def test_login_per_app_and_access():
    r = login("alice", "retail"); assert r.status_code == 200 and r.json()["app"] == "retail"
    assert set(r.json()["apps"]) == {"retail", "bullion"}
    assert login("alice", "bullion").status_code == 200
    assert login("bob", "retail").status_code == 200
    assert login("bob", "bullion").status_code == 401          # bob has no Bullion account
    assert login("carol", "retail").status_code == 401
    assert login("alice", "nope").status_code == 400
    assert login("alice", "retail", "wrong-password").status_code == 401


def test_login_via_header_only():
    r = client.post("/api/auth/login", json={"username": "alice", "password": PW}, headers={"X-App": "bullion"})
    assert r.status_code == 200 and r.json()["app"] == "bullion"


def test_data_isolation_and_token_beats_header():
    rt = login("alice", "retail").json()["access_token"]
    bt = login("alice", "bullion").json()["access_token"]
    assert client.post("/api/contacts", json={"name": "Retail Customer", "contact_type": "customer"}, headers=H(rt)).status_code in (200, 201)
    names = lambda tok, **h: [c["name"] for c in client.get("/api/contacts", headers=H(tok, **h)).json()]
    assert "Retail Customer" in names(rt)
    assert "Retail Customer" not in names(bt)
    # a header can never redirect an authenticated request into the other database
    assert "Retail Customer" in names(rt, **{"X-App": "bullion"})
    assert "Retail Customer" not in names(bt, **{"X-App": "retail"})
    with db_for("bullion") as db:
        from app.models.contact import Contact
        assert db.query(Contact).count() == 0


def test_switch_without_password():
    rt = login("alice", "retail").json()
    sw = client.post("/api/auth/switch", json={"app": "bullion"}, headers=H(rt["access_token"]))
    assert sw.status_code == 200, sw.text
    j = sw.json(); assert j["app"] == "bullion" and j["username"] == "alice"
    me = client.get("/api/auth/me", headers=H(j["access_token"]))
    assert me.status_code == 200 and me.json()["username"] == "alice"
    # the new token is Bullion's: Retail data is invisible with it
    assert "Retail Customer" not in [c["name"] for c in client.get("/api/contacts", headers=H(j["access_token"])).json()]
    # no access / same app
    bob = login("bob", "retail").json()["access_token"]
    assert client.post("/api/auth/switch", json={"app": "bullion"}, headers=H(bob)).status_code == 403
    assert client.post("/api/auth/switch", json={"app": "retail"}, headers=H(rt["access_token"])).status_code == 400
    assert client.get("/api/auth/apps", headers=H(bob)).json()["apps"] == ["retail"]


def test_requests_without_valid_app_rejected():
    assert client.get("/api/contacts").status_code in (401, 403)
    assert client.get("/api/contacts", headers=H("garbage")).status_code == 401
    from app.core.security import create_access_token
    legacy = create_access_token({"sub": "1"})                 # old-style token without an app claim
    assert client.get("/api/auth/me", headers=H(legacy)).status_code == 401


def test_password_change_syncs_to_other_app():
    rt = login("alice", "retail").json()["access_token"]
    r = client.post("/api/auth/change-password", json={"current_password": PW, "new_password": "NewPassw0rd!y"}, headers=H(rt))
    assert r.status_code == 200, r.text
    assert login("alice", "bullion", "NewPassw0rd!y").status_code == 200
    assert login("alice", "bullion", PW).status_code == 401
    # bob (retail only) is unaffected; carol (bullion only) unaffected
    assert login("carol", "bullion").status_code == 200


def test_admin_create_user_with_also_in():
    rt = login("alice", "retail", "NewPassw0rd!y").json()["access_token"]
    r = client.post("/api/users", json={"username": "dave", "full_name": "Dave", "password": "Davepass123", "role": "supervisor", "also_in": ["bullion"]}, headers=H(rt))
    assert r.status_code == 201, r.text
    assert login("dave", "retail", "Davepass123").status_code == 200
    assert login("dave", "bullion", "Davepass123").status_code == 200
    # admin password reset mirrors too
    uid = login("dave", "retail", "Davepass123").json()["user_id"]
    assert client.put(f"/api/users/{uid}", json={"password": "Reset123456"}, headers=H(rt)).status_code == 200
    assert login("dave", "bullion", "Reset123456").status_code == 200


def test_per_app_gold_unit():
    # 10 g of 24K lent to a shop: Retail reports 21K-eq (11.428), Bullion reports 24K-eq (10.0)
    out = {}
    for app_name, pw in (("retail", "NewPassw0rd!y"), ("bullion", "NewPassw0rd!y")):
        tok = login("alice", app_name, pw).json()["access_token"]
        shop = client.post("/api/shop-loans/shops", json={"name": f"Shop {app_name}"}, headers=H(tok))
        assert shop.status_code == 201, shop.text
        e = client.post("/api/shop-loans/entries", json={
            "shop_id": shop.json()["id"], "entry_type": "lend", "entry_date": "2026-10-20", "weight_24k": 10}, headers=H(tok))
        assert e.status_code == 201, e.text
        out[app_name] = (client.get("/api/shop-loans/shops", headers=H(tok)).json()[0], e.json())
    r_shop, r_entry = out["retail"]; b_shop, b_entry = out["bullion"]
    assert r_shop["balance_21k_eq"] == pytest.approx(11.429, abs=0.001) and r_shop["balance_24k_eq"] is None
    assert b_shop["balance_24k_eq"] == pytest.approx(10.0) and b_shop["balance_21k_eq"] is None
    assert r_entry["weight_21k_eq"] == pytest.approx(11.429, abs=0.001)
    assert b_entry["weight_24k_eq"] == pytest.approx(10.0)


def test_reopen_and_hardening_present():
    paths = set(client.get("/openapi.json").json()["paths"])
    assert any(p.endswith("/reopen") for p in paths), paths
    from app.core.permissions import PERMISSIONS
    keys = {k for k, _, _ in PERMISSIONS}
    assert {"day.open", "day.close", "day.edit_closed", "day.reopen"} <= keys


def test_websocket_resolves_app_from_token():
    rt = login("alice", "retail", "NewPassw0rd!y").json()["access_token"]
    with client.websocket_connect(f"/api/calls/ws?token={rt}") as ws:
        ws.send_json({"type": "join", "call_id": 1})
        assert ws.receive_json()["type"] == "existing-peers"
    from app.core.security import create_access_token
    legacy = create_access_token({"sub": "1"})
    with pytest.raises(Exception):
        with client.websocket_connect(f"/api/calls/ws?token={legacy}") as ws:
            ws.receive_json()
