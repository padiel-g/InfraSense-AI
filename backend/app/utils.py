"""
Authentication utilities.

Fixes:
  * `bcrypt.__about__` AttributeError   -> pin bcrypt==4.0.1 with passlib 1.7.4
  * `password cannot be longer than 72 bytes` -> SHA256 + base64 pre-hash
  * Silent truncation of long passwords  -> deterministic, injective pre-hash
"""

from __future__ import annotations

import base64
import hashlib
import re
import secrets
from typing import Final

from passlib.context import CryptContext


# --------------------------------------------------------------------------- #
# Passlib context
# --------------------------------------------------------------------------- #
# bcrypt "rounds" = work factor (2**rounds). 12 is the modern baseline.
pwd_context: Final[CryptContext] = CryptContext(
    schemes=["bcrypt"],
    deprecated="auto",
    bcrypt__rounds=12,
)

# Application-wide pepper. Keep this in your secrets manager / env, NOT in code.
# Rotating the pepper invalidates every stored hash, so treat it like a root key.
import os
_PEPPER: Final[bytes] = os.getenv("AUTH_PEPPER", "").encode("utf-8")

# --------------------------------------------------------------------------- #
# Password policy
# --------------------------------------------------------------------------- #
MIN_PASSWORD_LENGTH: Final[int] = 8
MAX_PASSWORD_LENGTH: Final[int] = 1024  # sane upper bound; bcrypt limit is bypassed

_STRENGTH_PATTERNS: Final[tuple[tuple[re.Pattern[str], str], ...]] = (
    (re.compile(r"[a-z]"), "one lowercase letter"),
    (re.compile(r"[A-Z]"), "one uppercase letter"),
    (re.compile(r"\d"),    "one digit"),
    (re.compile(r"[^\w\s]"), "one special character"),
)


class PasswordPolicyError(ValueError):
    """Raised when a password fails the strength policy."""


def validate_password_strength(password: str) -> None:
    """Raise ``PasswordPolicyError`` if the password is too weak."""
    if not isinstance(password, str):
        raise PasswordPolicyError("Password must be a string.")

    length = len(password)
    if length < MIN_PASSWORD_LENGTH:
        raise PasswordPolicyError(
            f"Password must be at least {MIN_PASSWORD_LENGTH} characters."
        )
    if length > MAX_PASSWORD_LENGTH:
        raise PasswordPolicyError(
            f"Password must be at most {MAX_PASSWORD_LENGTH} characters."
        )

    missing = [label for pattern, label in _STRENGTH_PATTERNS if not pattern.search(password)]
    if missing:
        raise PasswordPolicyError("Password must contain " + ", ".join(missing) + ".")


# --------------------------------------------------------------------------- #
# Core pre-hash
# --------------------------------------------------------------------------- #
def _prehash(password: str) -> str:
    """
    Produce a fixed-length, bcrypt-safe representation of any password.

    Steps:
      1. UTF-8 encode.
      2. Prepend optional pepper (HMAC would also work).
      3. SHA-256 -> 32 raw bytes.
      4. Base64-encode -> 44 printable ASCII chars (<= 72 bytes, no NULs).

    Using base64 (not hex) keeps entropy density high while staying under
    bcrypt's 72-byte ceiling and avoiding embedded NUL bytes, which some
    bcrypt implementations truncate on.
    """
    if not isinstance(password, str):
        raise TypeError("Password must be a str.")
    digest = hashlib.sha256(_PEPPER + password.encode("utf-8")).digest()
    return base64.b64encode(digest).decode("ascii")


# --------------------------------------------------------------------------- #
# Public API
# --------------------------------------------------------------------------- #
def hash_password(password: str) -> str:
    """Hash a plaintext password for storage."""
    validate_password_strength(password)
    return pwd_context.hash(_prehash(password))


def verify_password(plain: str, hashed: str) -> bool:
    """
    Verify a plaintext password against a stored hash.

    Tries the current scheme (SHA-256 pre-hash -> bcrypt) first, then falls
    back to the legacy scheme (raw password -> bcrypt, truncated to 72 bytes)
    so existing users can still log in. Callers should rehash on success
    when ``needs_rehash`` returns True.

    Returns False instead of raising on malformed inputs to avoid leaking
    information via exception types.
    """
    if not plain or not hashed:
        return False

    # 1) New scheme
    try:
        if pwd_context.verify(_prehash(plain), hashed):
            return True
    except (ValueError, TypeError):
        pass

    # 2) Legacy fallback: raw password, truncated to 72 bytes (bcrypt's limit)
    try:
        legacy = plain.encode("utf-8")[:72].decode("utf-8", errors="ignore")
        return pwd_context.verify(legacy, hashed)
    except (ValueError, TypeError):
        return False


def _is_legacy_hash(plain: str, hashed: str) -> bool:
    """True if the hash verifies only under the legacy (no-prehash) scheme."""
    try:
        if pwd_context.verify(_prehash(plain), hashed):
            return False
    except (ValueError, TypeError):
        pass
    try:
        legacy = plain.encode("utf-8")[:72].decode("utf-8", errors="ignore")
        return pwd_context.verify(legacy, hashed)
    except (ValueError, TypeError):
        return False


def needs_rehash(hashed: str, plain: str | None = None) -> bool:
    """
    True if the stored hash should be upgraded.

    If ``plain`` is provided, also returns True when the hash was produced
    by the legacy (no-prehash) scheme so the caller can transparently
    migrate it on the next successful login.
    """
    try:
        if pwd_context.needs_update(hashed):
            return True
    except ValueError:
        return True
    if plain is not None and _is_legacy_hash(plain, hashed):
        return True
    return False


def generate_temporary_password(length: int = 16) -> str:
    """Cryptographically strong temporary password (URL-safe)."""
    if length < MIN_PASSWORD_LENGTH:
        length = MIN_PASSWORD_LENGTH
    return secrets.token_urlsafe(length)[:length]
