#!/usr/bin/env python3
"""One-time / on-demand user sync between the Retail and Bullion databases.

Goal: the same person logs in with the SAME username + password in both apps. Each app keeps its own roles,
permissions and business data; only the login identity is mirrored.

Usage (from the backend folder, with the same .env the API uses):

  python scripts/sync_users.py report
        Show who exists where, and where the password differs.

  python scripts/sync_users.py copy --from retail --to bullion [--users ali,sara] [--dry-run]
        Create the users that are missing in the target app (same username, full name, password hash, role name).
        Existing target users are NOT touched.

  python scripts/sync_users.py passwords --from retail [--users ali,sara] [--dry-run]
        Make the password of users who exist in BOTH apps equal to the one in the --from app.
"""

import argparse
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from app.core.database import db_for          # noqa: E402
from app.core.tenant import APPS               # noqa: E402
from app.models.user import User, Role         # noqa: E402


def _load(app_name):
    with db_for(app_name) as db:
        return {u.username: dict(
            full_name=u.full_name, hashed=u.hashed_password, active=u.is_active, role=u.role.name,
        ) for u in db.query(User).all()}


def cmd_report(_):
    data = {a: _load(a) for a in APPS}
    names = sorted(set().union(*[set(d) for d in data.values()]))
    print(f"{'username':24} {'retail':14} {'bullion':14} password")
    for n in names:
        r, b = data["retail"].get(n), data["bullion"].get(n)
        fmt = lambda x: "-" if not x else f"{x['role']}{'' if x['active'] else ' (off)'}"
        pw = "" if not (r and b) else ("same" if r["hashed"] == b["hashed"] else "DIFFERENT")
        print(f"{n:24} {fmt(r):14} {fmt(b):14} {pw}")


def cmd_copy(a):
    if a.src == a.dst:
        sys.exit("--from and --to must differ")
    src = _load(a.src)
    wanted = set(a.users.split(",")) if a.users else set(src)
    with db_for(a.dst) as db:
        have = {u.username for u in db.query(User).all()}
        roles = {r.name: r.id for r in db.query(Role).all()}
        made = 0
        for name in sorted(wanted):
            u = src.get(name)
            if not u or name in have:
                continue
            if u["role"] not in roles:
                print(f"skip {name}: role '{u['role']}' missing in {a.dst}")
                continue
            print(f"{'would create' if a.dry_run else 'create'} {name} ({u['role']}) in {a.dst}")
            if not a.dry_run:
                db.add(User(username=name, full_name=u["full_name"], hashed_password=u["hashed"],
                            role_id=roles[u["role"]], is_active=u["active"], must_change_password=False))
            made += 1
        if not a.dry_run:
            db.commit()
        print(f"done: {made} user(s)")


def cmd_passwords(a):
    others = [x for x in APPS if x != a.src]
    src = _load(a.src)
    for dst in others:
        with db_for(dst) as db:
            changed = 0
            for u in db.query(User).all():
                s = src.get(u.username)
                if not s or (a.users and u.username not in a.users.split(",")) or s["hashed"] == u.hashed_password:
                    continue
                print(f"{'would update' if a.dry_run else 'update'} password of {u.username} in {dst}")
                if not a.dry_run:
                    u.hashed_password = s["hashed"]
                    u.failed_login_attempts = 0
                    u.locked_until = None
                changed += 1
            if not a.dry_run:
                db.commit()
            print(f"{dst}: {changed} password(s)")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("report").set_defaults(fn=cmd_report)
    c = sub.add_parser("copy"); c.add_argument("--from", dest="src", required=True, choices=APPS)
    c.add_argument("--to", dest="dst", required=True, choices=APPS); c.add_argument("--users"); c.add_argument("--dry-run", action="store_true"); c.set_defaults(fn=cmd_copy)
    p = sub.add_parser("passwords"); p.add_argument("--from", dest="src", required=True, choices=APPS)
    p.add_argument("--users"); p.add_argument("--dry-run", action="store_true"); p.set_defaults(fn=cmd_passwords)
    args = ap.parse_args()
    args.fn(args)
