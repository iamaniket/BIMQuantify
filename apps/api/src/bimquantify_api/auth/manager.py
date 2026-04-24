from collections.abc import AsyncGenerator
from uuid import UUID

from fastapi import Depends, Request
from fastapi_users import BaseUserManager, UUIDIDMixin
from fastapi_users.db import SQLAlchemyUserDatabase
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from bimquantify_api.config import get_settings
from bimquantify_api.db import get_session_maker, get_user_db
from bimquantify_api.email.transport import get_email_transport
from bimquantify_api.models.organization import Organization
from bimquantify_api.models.user import User


class UserManager(UUIDIDMixin, BaseUserManager[User, UUID]):
    reset_password_token_secret = ""
    verification_token_secret = ""

    def __init__(self, user_db: SQLAlchemyUserDatabase) -> None:
        super().__init__(user_db)
        settings = get_settings()
        self.reset_password_token_secret = settings.jwt_secret
        self.verification_token_secret = settings.jwt_secret

    async def on_after_register(self, user: User, request: Request | None = None) -> None:
        organization_name = self._pop_organization_name(request)
        if organization_name:
            await self._link_to_organization(user, organization_name)
        await self.request_verify(user, request)

    async def on_after_request_verify(
        self, user: User, token: str, request: Request | None = None
    ) -> None:
        settings = get_settings()
        verify_url = f"{settings.frontend_verify_url}?token={token}"
        body = (
            f"Hi {user.full_name or user.email},\n\n"
            f"Confirm your BIMQuantify account: {verify_url}\n\n"
            f"Token: {token}\n"
        )
        await get_email_transport().send(
            to=user.email, subject="Verify your BIMQuantify account", body=body
        )

    async def on_after_forgot_password(
        self, user: User, token: str, request: Request | None = None
    ) -> None:
        settings = get_settings()
        reset_url = f"{settings.frontend_reset_password_url}?token={token}"
        body = (
            f"Password reset requested for {user.email}.\n\n"
            f"Reset link: {reset_url}\n\nToken: {token}\n"
        )
        await get_email_transport().send(
            to=user.email, subject="Reset your BIMQuantify password", body=body
        )

    @staticmethod
    def _pop_organization_name(request: Request | None) -> str | None:
        if request is None:
            return None
        raw = getattr(request.state, "organization_name", None)
        if isinstance(raw, str) and raw.strip():
            return raw.strip()
        return None

    async def _link_to_organization(self, user: User, name: str) -> None:
        async with get_session_maker()() as session:
            result = await session.execute(select(Organization).where(Organization.name == name))
            organization = result.scalar_one_or_none()
            if organization is None:
                organization = Organization(name=name)
                session.add(organization)
                try:
                    await session.flush()
                except IntegrityError:
                    await session.rollback()
                    result = await session.execute(
                        select(Organization).where(Organization.name == name)
                    )
                    organization = result.scalar_one()

            db_user = await session.get(User, user.id)
            if db_user is not None:
                db_user.organization_id = organization.id
            user.organization_id = organization.id
            await session.commit()


async def get_user_manager(
    user_db: SQLAlchemyUserDatabase = Depends(get_user_db),
) -> AsyncGenerator[UserManager, None]:
    yield UserManager(user_db)
