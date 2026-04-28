"""Per-request tenant scoping for RLS.

`get_tenant_session` opens a session, begins a transaction, and sets two
session-local GUCs (`app.current_org_id`, `app.current_user_id`) that the
Postgres RLS policies key off. Endpoint code under this dependency MUST NOT
call `session.commit()` itself — committing closes the txn and drops the
GUCs, breaking RLS for any subsequent query in the same request. The wrapping
`async with session.begin():` handles commit/rollback automatically.
"""

from collections.abc import AsyncGenerator

from fastapi import Depends, HTTPException, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from bimstitch_api.auth.fastapi_users import current_verified_user
from bimstitch_api.db import get_session_maker
from bimstitch_api.models.user import User


async def require_org_user(user: User = Depends(current_verified_user)) -> User:
    if user.organization_id is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="USER_HAS_NO_ORGANIZATION",
        )
    return user


async def get_tenant_session(
    user: User = Depends(require_org_user),
) -> AsyncGenerator[AsyncSession, None]:
    session_maker = get_session_maker()
    async with session_maker() as session, session.begin():
        # Drop into the non-bypass app role so RLS actually enforces.
        # See bimstitch_api/_rls_sql.py for why this is necessary.
        await session.execute(text("SET LOCAL ROLE bim_app"))
        await session.execute(
            text("SELECT set_config('app.current_org_id', :org, true)"),
            {"org": str(user.organization_id)},
        )
        await session.execute(
            text("SELECT set_config('app.current_user_id', :uid, true)"),
            {"uid": str(user.id)},
        )
        yield session
