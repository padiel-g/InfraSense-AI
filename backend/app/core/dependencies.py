"""FastAPI dependencies — extract and validate the current user from cookies."""

import logging

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.models.user import User
from app.core.security import decode_token

logger = logging.getLogger("app.auth")


def _unauthorized(reason: str, *, path: str) -> HTTPException:
    """Log the precise reason a request was rejected, then raise 401.

    Logged at WARNING so it is visible during development without enabling
    DEBUG-level logging on every dependency.
    """
    logger.warning("auth: 401 on %s — %s", path, reason)
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=reason,
    )


async def get_current_user(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> User:
    path = request.url.path
    token = request.cookies.get("access_token")
    if not token:
        raise _unauthorized("missing access token cookie", path=path)

    payload = decode_token(token)
    if payload is None:
        raise _unauthorized("invalid or expired access token", path=path)
    if payload.get("type") != "access":
        raise _unauthorized("token is not an access token", path=path)

    email: str | None = payload.get("sub")
    if not email:
        raise _unauthorized("token missing subject claim", path=path)

    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()

    if user is None:
        raise _unauthorized(f"no user matching token subject ({email})", path=path)
    if not user.is_active:
        raise _unauthorized(f"user {email} is inactive", path=path)

    return user
