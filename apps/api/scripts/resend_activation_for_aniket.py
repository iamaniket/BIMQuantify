"""One-off: re-dispatch the activation email for aniketgw47@gmail.com.

The org was provisioned before the fix landed that wires `request_verify`
into the admin org-create flow, so no email was ever sent. Run from
apps/api with:

    uv run python scripts/resend_activation_for_aniket.py
"""

from __future__ import annotations

import asyncio
import logging

from sqlalchemy import func, select

from fastapi_users.db import SQLAlchemyUserDatabase

from bimstitch_api.auth.manager import UserManager
from bimstitch_api.db import get_session_maker
from bimstitch_api.models.user import User

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("resend")


TARGET_EMAIL = "aniketgw47@gmail.com"


async def main() -> None:
    session_maker = get_session_maker()
    async with session_maker() as session:
        stmt = select(User).where(func.lower(User.email) == TARGET_EMAIL.lower())
        user = (await session.execute(stmt)).scalar_one_or_none()
        if user is None:
            logger.error("user %s not found", TARGET_EMAIL)
            return
        if user.is_verified:
            logger.info("user %s is already verified; nothing to resend", TARGET_EMAIL)
            return

        user_db = SQLAlchemyUserDatabase(session, User)
        manager = UserManager(user_db)
        await manager.request_verify(user, request=None)
        logger.info(
            "activation email dispatched to %s (check MailHog at http://localhost:8025)",
            TARGET_EMAIL,
        )


if __name__ == "__main__":
    asyncio.run(main())
