"""
Reset a user's password directly in the database.
Run from the backend/ directory:
    python -m scripts.reset_password
"""
import asyncio
from sqlalchemy import select, update
from app.database import async_session_factory, init_db
from app.models.user import User
from app.core.security import hash_password

# ── Change these ────────────────────────────────────────────
TARGET_EMAIL = "gpadiel88@gmail.com"
NEW_PASSWORD = "Admin1234!"   # must be 8+ chars
# ────────────────────────────────────────────────────────────


async def reset():
    await init_db()
    async with async_session_factory() as db:
        async with db.begin():
            result = await db.execute(select(User).where(User.email == TARGET_EMAIL))
            user = result.scalar_one_or_none()

            if user is None:
                print(f"[✗] No user found with email: {TARGET_EMAIL}")
                return

            user.hashed_password = hash_password(NEW_PASSWORD)
            print(f"[✓] Password reset for {TARGET_EMAIL}")
            print(f"    New password: {NEW_PASSWORD}")
            print()
            print("Test login with:")
            print(f'  POST /api/v1/auth/login')
            print(f'  {{"email": "{TARGET_EMAIL}", "password": "{NEW_PASSWORD}"}}')


if __name__ == "__main__":
    asyncio.run(reset())
