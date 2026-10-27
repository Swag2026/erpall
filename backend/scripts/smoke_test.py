#!/usr/bin/env python3
"""Post-deploy smoke test against a LIVE backend (Railway / VM). Read-mostly: it only logs in, switches, reads, and
creates ONE tagged contact in each app (deleted again at the end).

  python scripts/smoke_test.py https://YOUR-API.up.railway.app --user admin --password '...'
  (optional) --retail-user/--retail-password if Retail uses different credentials than Bullion for this check

Checks: health, login to both apps, app list, switch both directions without a password, tokens can't cross databases,
a record created in one app is invisible in the other, wrong password rejected.
"""
import argparse
import sys
import uuid

import requests

ap = argparse.ArgumentParser()
ap.add_argument("base")
ap.add_argument("--user", required=True)
ap.add_argument("--password", required=True)
a = ap.parse_args()
B = a.base.rstrip("/") + "/api"
fails = []


def check(name, cond, extra=""):
    print(("PASS " if cond else "FAIL ") + name + (f"  [{extra}]" if (extra and not cond) else ""))
    if not cond:
        fails.append(name)


def login(app_name, pw=None):
    return requests.post(f"{B}/auth/login", json={"username": a.user, "password": pw or a.password, "app": app_name}, timeout=30)


def H(tok):
    return {"Authorization": f"Bearer {tok}"}


h = requests.get(f"{B}/health", timeout=30)
check("health", h.status_code == 200, h.text[:100])

tok = {}
for app_name in ("retail", "bullion"):
    r = login(app_name)
    check(f"login {app_name}", r.status_code == 200, f"{r.status_code} {r.text[:120]}")
    if r.status_code == 200:
        tok[app_name] = r.json()["access_token"]
        check(f"{app_name}: token says app={app_name}", r.json().get("app") == app_name)
        check(f"{app_name}: both apps offered in switcher", set(r.json().get("apps", [])) == {"retail", "bullion"}, str(r.json().get("apps")))
if len(tok) < 2:
    print("\nCannot continue without both logins (is this user present in BOTH databases? run scripts/sync_users.py)")
    sys.exit(1)

check("wrong password rejected", login("retail", "definitely-wrong-password").status_code == 401)

for src, dst in (("retail", "bullion"), ("bullion", "retail")):
    r = requests.post(f"{B}/auth/switch", json={"app": dst}, headers=H(tok[src]), timeout=30)
    check(f"switch {src} -> {dst} without password", r.status_code == 200 and r.json().get("app") == dst, r.text[:120])

tag = f"SMOKE-{uuid.uuid4().hex[:8]}"
r = requests.post(f"{B}/contacts", json={"name": tag, "contact_type": "customer"}, headers=H(tok["retail"]), timeout=30)
check("create tagged contact in RETAIL", r.status_code in (200, 201), r.text[:120])
cid = r.json().get("id") if r.status_code in (200, 201) else None
names = lambda t, **kw: [c["name"] for c in requests.get(f"{B}/contacts", headers={**H(t), **kw}, timeout=30).json()]
check("visible in RETAIL", tag in names(tok["retail"]))
check("NOT visible in BULLION", tag not in names(tok["bullion"]))
check("header cannot redirect Bullion token to Retail", tag not in names(tok["bullion"], **{"X-App": "retail"}))
if cid:
    requests.delete(f"{B}/contacts/{cid}", headers=H(tok["retail"]), timeout=30)

print("\n" + ("ALL GOOD" if not fails else f"{len(fails)} FAILED: {fails}"))
sys.exit(1 if fails else 0)
