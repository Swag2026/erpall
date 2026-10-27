from contextlib import contextmanager
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase
from .config import get_settings
from .tenant import APPS, current_app

settings = get_settings()


def _make_engine(url: str):
    kwargs = {"pool_pre_ping": True}
    if not url.startswith("sqlite"):
        kwargs.update(pool_size=10, max_overflow=20)
    return create_engine(url, **kwargs)


# One engine + session factory per app. Each points at its own database; nothing is shared between them.
engines = {app: _make_engine(url) for app, url in settings.database_urls.items()}
session_makers = {app: sessionmaker(autocommit=False, autoflush=False, bind=eng) for app, eng in engines.items()}


class Base(DeclarativeBase):
    pass


def get_db():
    """FastAPI dependency: a session on the database of the app resolved for this request."""
    try:
        app = current_app()
    except LookupError:
        raise HTTPException(
            status_code=401,
            detail="No app selected. Log in again (X-App header or a token with an app is required).",
        )
    db = session_makers[app]()
    try:
        yield db
    finally:
        db.close()


@contextmanager
def db_for(app: str):
    """Open a session on a specific app's database (used for cross-app lookups, e.g. the app switcher)."""
    if app not in APPS:
        raise ValueError(f"Unknown app '{app}'")
    db = session_makers[app]()
    try:
        yield db
    finally:
        db.close()
