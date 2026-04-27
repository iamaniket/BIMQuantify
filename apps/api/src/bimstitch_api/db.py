from collections.abc import AsyncGenerator

from fastapi import Depends
from fastapi_users.db import SQLAlchemyUserDatabase
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from bimstitch_api.config import get_settings


class Base(DeclarativeBase):
    pass


_engine: AsyncEngine | None = None
_session_maker: async_sessionmaker[AsyncSession] | None = None


def get_engine() -> AsyncEngine:
    global _engine, _session_maker
    if _engine is None:
        settings = get_settings()
        _engine = create_async_engine(settings.database_url, future=True)
        _session_maker = async_sessionmaker(_engine, expire_on_commit=False)
    return _engine


def get_session_maker() -> async_sessionmaker[AsyncSession]:
    if _session_maker is None:
        get_engine()
    assert _session_maker is not None
    return _session_maker


async def get_async_session() -> AsyncGenerator[AsyncSession, None]:
    async with get_session_maker()() as session:
        yield session


async def get_user_db(
    session: AsyncSession = Depends(get_async_session),
) -> AsyncGenerator[SQLAlchemyUserDatabase, None]:
    from bimstitch_api.models.user import User

    yield SQLAlchemyUserDatabase(session, User)
