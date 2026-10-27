from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    # One backend, two completely separate databases (see core/tenant.py).
    # DATABASE_URL is kept as a fallback for the Retail database so an existing Retail .env keeps working.
    DATABASE_URL: str = "postgresql://postgres:password@localhost:5432/swag_gold"
    DATABASE_URL_RETAIL: str = ""
    DATABASE_URL_BULLION: str = ""
    SECRET_KEY: str  # required — no insecure default; app will fail fast if unset
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 480
    ALGORITHM: str = "HS256"
    # Comma-separated list, e.g. "https://swag-gold.netlify.app,https://swaggroup.co"
    # Falls back to "*" only if left unset — set this in production.
    ALLOWED_ORIGINS: str = "*"

    # External partner ERP we pull customer balances from (read-only sync).
    # Defaults match the docs supplied — override in .env if they rotate
    # the password, without needing a code change.
    EXTERNAL_API_BASE_URL: str = "https://swag.gerpsystems.com/external"
    EXTERNAL_API_USERNAME: str = "external"
    EXTERNAL_API_PASSWORD: str = "48d9c0073f426d5cc3!Aa1"

    # coturn TURN server for video/audio calling — shared secret must match
    # `static-auth-secret` in turnserver.conf on the Oracle VM. Comma-separate
    # multiple URLs (UDP + TCP + TLS variants), e.g.:
    # "turn:bullion-turn.swag.sa:3478?transport=udp,turn:bullion-turn.swag.sa:3478?transport=tcp"
    TURN_SECRET: str = ""
    TURN_URLS: str = ""

    # Web Push (VAPID) — same key pair for every environment is fine (it
    # identifies the SERVER, not a user); only rotate it if it ever leaks.
    # Generate a new pair with: py_vapid's Vapid().generate_keys()
    VAPID_PUBLIC_KEY: str = ""
    VAPID_PRIVATE_KEY: str = ""
    VAPID_CLAIMS_EMAIL: str = "mailto:admin@swag.sa"

    @property
    def database_urls(self) -> dict:
        retail = self.DATABASE_URL_RETAIL or self.DATABASE_URL
        if not self.DATABASE_URL_BULLION:
            raise ValueError("DATABASE_URL_BULLION must be set (the Bullion database URL).")
        if retail == self.DATABASE_URL_BULLION:
            raise ValueError("Retail and Bullion must use DIFFERENT databases.")
        return {"retail": retail, "bullion": self.DATABASE_URL_BULLION}

    @property
    def cors_origins(self) -> list[str]:
        if self.ALLOWED_ORIGINS.strip() == "*":
            return ["*"]
        return [o.strip() for o in self.ALLOWED_ORIGINS.split(",") if o.strip()]

    def model_post_init(self, __context):
        self.database_urls  # fail fast if the two databases are misconfigured
        if len(self.SECRET_KEY) < 32:
            raise ValueError("SECRET_KEY must be at least 32 characters long. Set it in your .env file.")

    class Config:
        env_file = ".env"


@lru_cache()
def get_settings() -> Settings:
    return Settings()
