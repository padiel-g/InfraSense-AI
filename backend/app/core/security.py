"""
Core security utilities — password hashing and JWT helpers.

Uses bcrypt directly (no passlib) to avoid the passlib 1.7.4 + bcrypt 4.x
incompatibility on Windows where passlib's detect_wrap_bug() rejects passwords
over 72 bytes with a ValueError.  The SHA-256 pre-hash always produces 44 bytes,
well under bcrypt's 72-byte limit.
"""

from __future__ import annotations

import base64
import hashlib
from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt
from jose import JWTError, jwt

from app.config import get_settings

settings = get_settings()


# ---------------------------------------------------------------------------
# Password helpers
# ---------------------------------------------------------------------------

def _prehash(password: str) -> bytes:
    """SHA-256 → base64-encode → bytes (always 44 bytes, safe for bcrypt)."""
    return base64.b64encode(hashlib.sha256(password.encode("utf-8")).digest())


def _legacy_bcrypt_input(password: str) -> bytes:
    """Return the raw bcrypt input used by older accounts."""
    return password.encode("utf-8")[:72]


def hash_password(plain: str) -> str:
    """Return a bcrypt hash of *plain*."""
    return bcrypt.hashpw(_prehash(plain), bcrypt.gensalt(rounds=12)).decode("utf-8")


def password_matches_current_scheme(plain: str, hashed: str) -> bool:
    """True when *hashed* matches the current SHA-256 pre-hash scheme."""
    if not plain or not hashed:
        return False
    try:
        return bcrypt.checkpw(_prehash(plain), hashed.encode("utf-8"))
    except Exception:
        return False


def verify_password(plain: str, hashed: str) -> bool:
    """Return True if *plain* matches the stored bcrypt *hashed* value.

    The active scheme hashes a SHA-256/base64 representation of the password
    before bcrypt so long passwords never hit bcrypt's 72-byte ceiling. Older
    development accounts may still contain raw bcrypt hashes, so keep a legacy
    fallback to avoid rejecting otherwise-correct passwords.
    """
    if not plain or not hashed:
        return False
    if password_matches_current_scheme(plain, hashed):
        return True
    try:
        return bcrypt.checkpw(_legacy_bcrypt_input(plain), hashed.encode("utf-8"))
    except Exception:
        return False


# ---------------------------------------------------------------------------
# JWT helpers
# ---------------------------------------------------------------------------

def create_access_token(data: dict) -> str:
    payload = {**data}
    payload["exp"] = datetime.now(timezone.utc) + timedelta(
        minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES
    )
    payload["type"] = "access"
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def create_refresh_token(data: dict, remember_me: bool = False) -> str:
    days = (
        settings.REMEMBER_ME_REFRESH_EXPIRE_DAYS
        if remember_me
        else settings.REFRESH_TOKEN_EXPIRE_DAYS
    )
    payload = {**data}
    payload["exp"] = datetime.now(timezone.utc) + timedelta(days=days)
    payload["type"] = "refresh"
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def decode_token(token: str) -> Optional[dict]:
    """Decode and return the JWT payload, or None if invalid / expired."""
    try:
        return jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    except JWTError:
        return None
