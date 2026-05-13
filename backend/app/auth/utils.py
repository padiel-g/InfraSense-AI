# Kept for import compatibility — all logic now lives in app.core.security.
from app.core.security import (  # noqa: F401
    hash_password,
    verify_password,
    create_access_token,
    create_refresh_token,
    decode_token,
)

# PasswordPolicyError is no longer raised here; kept for any existing callers.
class PasswordPolicyError(ValueError):
    """Password failed the strength policy."""
