import asyncio
import contextlib
import logging
from collections.abc import Awaitable, Callable
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
from bimdossier_api.config import get_settings
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


# Application close codes. 4001 (RFC 6455 private range) = the connection is no
# longer authorized — the client should NOT silently retry with the same token.
# 1000 (normal) = a benign lifetime-cap recycle; the client reconnects, picking up
# a refreshed access token if one was rotated meanwhile.
WS_CLOSE_AUTH_FAILED = 4001
WS_CLOSE_SESSION_REFRESH = 1000
# 4029 (private range) = this (org, user) is already at the per-user connection
# cap (M-en3). The client should back off, not hammer-reconnect — the cap won't
# clear until one of its existing sockets closes.
WS_CLOSE_TOO_MANY = 4029


class _OneShotCloser:
    """Funnel every socket close through a single close frame.

    Starlette raises ``RuntimeError`` if a WebSocket is closed twice, and both the
    revalidation loop (auth rejection / lifetime cap) and ``manager.stop()`` (app
    shutdown) can race to close the same socket. The first call wins; later calls
    are no-ops, and a close against an already-disconnected peer is suppressed.
    """

    def __init__(self, ws: WebSocket) -> None:
        self._ws = ws
        self._closed = False

    async def __call__(self, code: int, reason: str) -> None:
        if self._closed:
            return
        self._closed = True
        with contextlib.suppress(RuntimeError, WebSocketDisconnect, OSError):
            await self._ws.close(code=code, reason=reason)


# A WS auth callable: resolves a token to a non-str success (the org path returns
# (User, org_id); the free path returns just User) or a string close-reason. The
# revalidation loop only cares whether the result is a str (reject) or not (ok), so
# it stays generic over the success type.
WsAuthFn = Callable[[str, Redis, AsyncSession], Awaitable[object]]


async def _revalidation_loop(
    token: str,
    *,
    authenticate: WsAuthFn = authenticate_ws_token,
    close: Callable[[int, str], Awaitable[None]],
    interval_seconds: float,
    max_lifetime_seconds: float,
) -> None:
    """Re-run the handshake auth gates on an already-open socket, on an interval.

    The handshake authenticates only once; without this loop a socket keeps
    streaming after a logout-everywhere / password change / account deactivation /
    org-deprovision until the access token's natural expiry (H5). Each cycle opens
    a SHORT-LIVED session (never held across the sleep — that would pin a pool
    connection) and reuses the same ``authenticate`` callable as the handshake, so
    the gate set stays identical. A hard lifetime cap closes the socket with a
    benign ``session_refresh`` so the client reconnects with a fresh token before
    the current one can expire mid-stream.
    """
    loop = asyncio.get_running_loop()
    deadline = loop.time() + max_lifetime_seconds  # monotonic; immune to clock jumps
    while True:
        remaining = deadline - loop.time()
        if remaining <= 0:
            await close(WS_CLOSE_SESSION_REFRESH, "session_refresh")
            return
        await asyncio.sleep(min(interval_seconds, remaining))
        if loop.time() >= deadline:
            await close(WS_CLOSE_SESSION_REFRESH, "session_refresh")
            return
        try:
            async with get_session_maker()() as session:
                result = await authenticate(token, get_redis(), session)
        except asyncio.CancelledError:
            raise
        except Exception:
            # Transient DB/Redis blip: fail open for this one cycle (the hard
            # lifetime cap still bounds the worst case). Mirrors the sweepers and
            # the pub/sub listener.
            logger.exception("ws revalidation cycle failed; retrying next interval")
            continue
        if isinstance(result, str):
            await close(WS_CLOSE_AUTH_FAILED, result)
            return


def _resolve_ws_token(
    subprotocols: list[str], query_token: str | None
) -> tuple[str | None, str | None]:
    """Resolve the access token and the subprotocol to echo on accept.

    Prefer the ``Sec-WebSocket-Protocol: bearer, <token>`` handshake — the
    browser's only way to attach a credential WITHOUT putting it in the URL
    (M-ws) — over the legacy ``?token=`` query param, which proxies, the uvicorn
    access log, and browser history record in the clear. Returns
    ``(token, accept_subprotocol)``; ``accept_subprotocol`` is ``"bearer"`` only
    when the token arrived that way, so the server echoes ``bearer`` and never
    reflects the token itself back in the response header.
    """
    if len(subprotocols) >= 2 and subprotocols[0] == "bearer":
        return subprotocols[1], "bearer"
    if query_token:
        logger.warning(
            "ws/notifications authenticated via the deprecated ?token= query param "
            "(logged by proxies); migrate the client to the 'bearer' "
            "Sec-WebSocket-Protocol handshake"
        )
        return query_token, None
    return None, None


@router.websocket("/ws/notifications")
async def ws_notifications(ws: WebSocket, token: str | None = Query(default=None)) -> None:
    auth_token, accept_subprotocol = _resolve_ws_token(ws.scope.get("subprotocols", []), token)
    if auth_token is None:
        # No credential on either channel — reject the handshake.
        await ws.close(code=WS_CLOSE_AUTH_FAILED, reason="missing_token")
        return

    redis = get_redis()
    async with get_session_maker()() as session:
        result = await authenticate_ws_token(auth_token, redis, session)

    if isinstance(result, str):
        await ws.close(code=WS_CLOSE_AUTH_FAILED, reason=result)
        return
    user, org_id = result

    settings = get_settings()
    manager = get_manager()
    # Pass the authenticated user id so the manager can scope targeted
    # notifications to this user's sockets only (L9) and enforce the per-(org,user)
    # connection cap (M-en3). A False return = over the cap → refuse the handshake
    # without accepting, so an in-org actor can't open unbounded sockets. The
    # negotiated subprotocol (echoed only for the bearer handshake) is set on
    # accept so the browser's WebSocket resolves rather than failing (M-ws).
    accepted = await manager.connect(
        ws,
        org_id,
        user.id,
        max_per_user=settings.ws_max_connections_per_user,
        subprotocol=accept_subprotocol,
    )
    if not accepted:
        await ws.close(code=WS_CLOSE_TOO_MANY, reason="too_many_connections")
        return

    safe_close = _OneShotCloser(ws)

    async def _drain() -> None:
        # The only reliable disconnect detector for an idle org: a pub/sub push
        # only notices a dead socket when there is a message to send.
        try:
            while True:
                await ws.receive_text()
        except WebSocketDisconnect:
            return

    drain_task = asyncio.create_task(_drain(), name="ws-notif-drain")
    revalidate_task = asyncio.create_task(
        _revalidation_loop(
            auth_token,
            authenticate=authenticate_ws_token,
            close=safe_close,
            interval_seconds=settings.ws_revalidate_interval_seconds,
            max_lifetime_seconds=settings.ws_max_lifetime_seconds,
        ),
        name="ws-notif-revalidate",
    )
    try:
        await asyncio.wait({drain_task, revalidate_task}, return_when=asyncio.FIRST_COMPLETED)
    finally:
        # Whichever finished first, tear down the other. Cancelling an
        # already-done task is a no-op; gather(return_exceptions) retrieves every
        # result/exception so none is left "never retrieved".
        drain_task.cancel()
        revalidate_task.cancel()
        await asyncio.gather(drain_task, revalidate_task, return_exceptions=True)
        manager.disconnect(ws, org_id)


async def authenticate_ws_free_token(
    token: str,
    redis: Redis,
    session: AsyncSession,
) -> User | str:
    """Resolve a WebSocket access token to the free (org-less) ``User``, or a
    string close-reason.

    Enforces the SAME token gates as the org path (``authenticate_ws_token``) —
    per-JTI blocklist, the user row existing AND ``is_active``, and the per-user
    ``tokens_valid_after`` epoch — but DROPS the org-membership check (a free
    account has no org). No participation check is needed: a free socket only ever
    subscribes to its own ``notifications:free:user:<uid>`` channel, so it can never
    receive another user's notification regardless of project membership.
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

    if token_predates_epoch(decoded, getattr(user, "tokens_valid_after", None)):
        return "token_revoked"

    return user


@router.websocket("/ws/free-notifications")
async def ws_free_notifications(ws: WebSocket, token: str | None = Query(default=None)) -> None:
    """Free-tier notification stream — per-user channel, no org.

    Mirrors ``ws_notifications`` but authenticates via ``authenticate_ws_free_token``
    (no org membership) and registers on the manager's per-user free index so a push
    on ``notifications:free:user:<uid>`` reaches only this user's sockets.
    """
    auth_token, accept_subprotocol = _resolve_ws_token(ws.scope.get("subprotocols", []), token)
    if auth_token is None:
        await ws.close(code=WS_CLOSE_AUTH_FAILED, reason="missing_token")
        return

    redis = get_redis()
    async with get_session_maker()() as session:
        result = await authenticate_ws_free_token(auth_token, redis, session)

    if isinstance(result, str):
        await ws.close(code=WS_CLOSE_AUTH_FAILED, reason=result)
        return
    user = result

    settings = get_settings()
    manager = get_manager()
    accepted = await manager.connect_free(
        ws,
        user.id,
        max_per_user=settings.ws_max_connections_per_user,
        subprotocol=accept_subprotocol,
    )
    if not accepted:
        await ws.close(code=WS_CLOSE_TOO_MANY, reason="too_many_connections")
        return

    safe_close = _OneShotCloser(ws)

    async def _drain() -> None:
        try:
            while True:
                await ws.receive_text()
        except WebSocketDisconnect:
            return

    drain_task = asyncio.create_task(_drain(), name="ws-free-notif-drain")
    revalidate_task = asyncio.create_task(
        _revalidation_loop(
            auth_token,
            authenticate=authenticate_ws_free_token,
            close=safe_close,
            interval_seconds=settings.ws_revalidate_interval_seconds,
            max_lifetime_seconds=settings.ws_max_lifetime_seconds,
        ),
        name="ws-free-notif-revalidate",
    )
    try:
        await asyncio.wait({drain_task, revalidate_task}, return_when=asyncio.FIRST_COMPLETED)
    finally:
        drain_task.cancel()
        revalidate_task.cancel()
        await asyncio.gather(drain_task, revalidate_task, return_exceptions=True)
        manager.disconnect_free(ws, user.id)
