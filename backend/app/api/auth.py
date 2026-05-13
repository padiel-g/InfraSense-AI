"""
Auth router — cookie-based JWT authentication.

Endpoints
---------
POST /api/auth/register   — create account, return user info
POST /api/auth/login      — set access + refresh cookies, return user
POST /api/auth/refresh    — silently rotate access_token cookie
POST /api/auth/logout     — delete both cookies
GET  /api/auth/me         — return current user (requires valid access cookie)
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, EmailStr
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import func, select
from sqlalchemy.exc import SQLAlchemyError

from app.config import get_settings
from app.database import async_session_factory, get_db
from app.models.user import User
from app.core.security import (
    hash_password,
    verify_password,
    password_matches_current_scheme,
    create_access_token,
    create_refresh_token,
    decode_token,
)
from app.core.dependencies import get_current_user

settings = get_settings()
router = APIRouter()

# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str
    full_name: str | None = None


class LoginRequest(BaseModel):
    email: EmailStr
    password: str
    remember_me: bool = False


class UserOut(BaseModel):
    id: str
    email: str
    full_name: str | None

    class Config:
        from_attributes = True


# ---------------------------------------------------------------------------
# Cookie helpers
# ---------------------------------------------------------------------------

_SECURE = settings.COOKIE_SECURE
_SAMESITE = settings.COOKIE_SAMESITE


def _set_access_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key="access_token",
        value=token,
        httponly=True,
        secure=_SECURE,
        samesite=_SAMESITE,
        max_age=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        path="/",
    )


def _set_refresh_cookie(response: Response, token: str, remember_me: bool) -> None:
    days = (
        settings.REMEMBER_ME_REFRESH_EXPIRE_DAYS
        if remember_me
        else settings.REFRESH_TOKEN_EXPIRE_DAYS
    )
    # Path="/" so the Next.js middleware (which only sees cookies sent with the
    # page request) can detect that the user still has a valid refresh token,
    # even after the short-lived access token expires. Without this, expiry of
    # access_token causes an immediate /login redirect before the axios refresh
    # interceptor ever runs.
    response.set_cookie(
        key="refresh_token",
        value=token,
        httponly=True,
        secure=_SECURE,
        samesite=_SAMESITE,
        max_age=days * 24 * 3600,
        path="/",
    )


def _delete_cookies(response: Response) -> None:
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("refresh_token", path="/")
    # Also clear the legacy cookie path used by older builds so logout is clean.
    response.delete_cookie("refresh_token", path="/api/auth/refresh")


def _database_unavailable_error() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail=(
            "Database is not ready. Please restart the backend or run the "
            "database migrations, then try again."
        ),
    )


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.post("/register", status_code=status.HTTP_201_CREATED)
async def register(
    body: RegisterRequest,
    response: Response,
):
    email = str(body.email).strip().lower()

    if len(body.password) < 8:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Password must be at least 8 characters.",
        )

    try:
        async with async_session_factory() as db:
            async with db.begin():
                result = await db.execute(select(User).where(func.lower(User.email) == email))
                if result.scalar_one_or_none():
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="An account with this email already exists.",
                    )

                user = User(
                    email=email,
                    hashed_password=hash_password(body.password),
                    full_name=body.full_name or "",
                )
                db.add(user)
                await db.flush()
                await db.refresh(user)

            user_out = {
                "id": user.id,
                "email": user.email,
                "full_name": user.full_name,
                "is_active": user.is_active,
            }
    except HTTPException:
        raise
    except SQLAlchemyError as exc:
        print(f"[!] Register failed because the database is not ready: {exc}")
        raise _database_unavailable_error() from exc

    access_token = create_access_token({"sub": user_out["email"]})
    refresh_token = create_refresh_token({"sub": user_out["email"]})

    _set_access_cookie(response, access_token)
    _set_refresh_cookie(response, refresh_token, remember_me=False)

    return {"user": user_out}


@router.post("/login")
async def login(
    body: LoginRequest,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    email = str(body.email).strip().lower()
    try:
        result = await db.execute(select(User).where(func.lower(User.email) == email))
        user = result.scalar_one_or_none()
    except SQLAlchemyError as exc:
        print(f"[!] Login failed because the database is not ready: {exc}")
        raise _database_unavailable_error() from exc

    if user is None or not verify_password(body.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )

    if not password_matches_current_scheme(body.password, user.hashed_password):
        user.hashed_password = hash_password(body.password)
        await db.flush()

    access_token = create_access_token({"sub": user.email})
    refresh_token = create_refresh_token({"sub": user.email}, remember_me=body.remember_me)

    _set_access_cookie(response, access_token)
    _set_refresh_cookie(response, refresh_token, remember_me=body.remember_me)

    return {"user": {"id": user.id, "email": user.email, "full_name": user.full_name}}


@router.post("/refresh")
async def refresh(
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    token = request.cookies.get("refresh_token")
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="No refresh token",
        )

    payload = decode_token(token)
    if payload is None or payload.get("type") != "refresh":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired refresh token",
        )

    email: str | None = payload.get("sub")
    if not email:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Bad token")

    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")

    # Issue new access token (sliding window)
    _set_access_cookie(response, create_access_token({"sub": user.email}))

    # Rotate refresh token only if it expires in less than 24 hours
    exp = payload.get("exp", 0)
    expires_in = exp - datetime.now(timezone.utc).timestamp()
    if expires_in < 86400:
        _set_refresh_cookie(
            response,
            create_refresh_token({"sub": user.email}),
            remember_me=False,
        )

    return {"ok": True}


@router.post("/logout")
async def logout(response: Response):
    _delete_cookies(response)
    return {"ok": True}


@router.get("/me")
async def me(current_user: User = Depends(get_current_user)):
    return {
        "id": current_user.id,
        "email": current_user.email,
        "full_name": current_user.full_name,
        "is_active": current_user.is_active,
    }
