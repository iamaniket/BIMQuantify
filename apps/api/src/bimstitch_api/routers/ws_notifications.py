import logging

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect
from sqlalchemy import select

from bimstitch_api.auth.tokens import TokenError, decode_token_full
from bimstitch_api.cache import get_redis
from bimstitch_api.cache.blocklist import is_revoked
from bimstitch_api.db import get_session_maker
from bimstitch_api.models.user import User
from bimstitch_api.notifications.manager import get_manager

logger = logging.getLogger(__name__)

router = APIRouter(tags=["ws-notifications"])


@router.websocket("/ws/notifications")
async def ws_notifications(ws: WebSocket, token: str = Query(...)) -> None:
    try:
        decoded = decode_token_full(token, "access")
    except TokenError:
        await ws.close(code=4001, reason="invalid_token")
        return

    redis = get_redis()
    if decoded.jti and await is_revoked(redis, decoded.jti):
        await ws.close(code=4001, reason="token_revoked")
        return

    async with get_session_maker()() as session:
        user = (
            await session.execute(select(User).where(User.id == decoded.user_id))
        ).scalar_one_or_none()

    if user is None:
        await ws.close(code=4001, reason="user_not_found")
        return

    # Active org for the WS subscription comes from the JWT, not the user row.
    if decoded.active_organization_id is None:
        await ws.close(code=4001, reason="no_active_organization")
        return
    org_id = decoded.active_organization_id
    manager = get_manager()
    await manager.connect(ws, org_id)

    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect(ws, org_id)
