import logging
from uuid import UUID

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect
from redis.asyncio import Redis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from bimdossier_api.auth.tokens import (
    TokenError,
    decode_token_full,
    token_predates_epoch,
)
from bimdossier_api.cache import get_redis
from bimdossier_api.cache.blocklist import is_revoked
from bimdossier_api.db import get_session_maker
from bimdossier_api.models.organization_member import (
    OrganizationMember,
    OrganizationMemberStatus,
)
from bimdossier_api.models.user import User
from bimdossier_api.notifications.manager import get_manager

logger = logging.getLogger(__name__)

router = APIRouter(tags=["ws-notifications"])


async def authenticate_ws_token(
    token: str,
    redis: Redis,
    session: AsyncSession,
) -> tuple[User, UUID] | str:
    """Resolve a WebSocket access token to (user, active_org_id), or return a
    string close-reason on rejection.

    Enforces the SAME gates as the HTTP auth path (``auth/strategy.py``):
    the per-JTI Redis blocklist, the user row existing AND ``is_active``, and
    the per-user ``tokens_valid_after`` epoch — plus a live org-membership
    re-check. Previously this path checked only the JTI blocklist, so a token
    invalidated by "sign out everywhere", a password change, or an account
    deactivation still granted a live notification stream until natural
    expiry, and a deprovisioned member kept receiving their old org's
    notifications. The org id always comes from the JWT ``org`` claim, never a
    client-supplied value.
    """
    try:
        decoded = decode_token_full(token, "access")
    except TokenError:
        return "invalid_token"

    if decoded.jti and await is_revoked(redis, decoded.jti):
        return "token_revoked"

    user = await session.get(User, decoded.user_id)
    if user is None or not user.is_active:
        return "user_not_found"

    # Per-user token epoch: reject tokens minted before a global sign-out /
    # password change — mirrors auth/strategy.py:read_token.
    if token_predates_epoch(decoded, getattr(user, "tokens_valid_after", None)):
        return "token_revoked"

    if decoded.active_organization_id is None:
        return "no_active_organization"
    org_id = decoded.active_organization_id

    # Re-verify the membership is still active (mirrors require_active_organization
    # on the HTTP side) so a suspended/removed member can't keep streaming.
    membership = (
        await session.execute(
            select(OrganizationMember.id).where(
                OrganizationMember.user_id == user.id,
                OrganizationMember.organization_id == org_id,
                OrganizationMember.status == OrganizationMemberStatus.active,
            )
        )
    ).scalar_one_or_none()
    if membership is None:
        return "org_membership_required"

    return user, org_id


@router.websocket("/ws/notifications")
async def ws_notifications(ws: WebSocket, token: str = Query(...)) -> None:
    redis = get_redis()
    async with get_session_maker()() as session:
        result = await authenticate_ws_token(token, redis, session)

    if isinstance(result, str):
        await ws.close(code=4001, reason=result)
        return
    _user, org_id = result

    manager = get_manager()
    await manager.connect(ws, org_id)

    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect(ws, org_id)
