from typing import TYPE_CHECKING, Any

from fastapi_users.authentication import JWTStrategy

from bimstitch_api.auth.tokens import TokenError, decode_token_full
from bimstitch_api.cache import get_redis
from bimstitch_api.cache.blocklist import is_revoked

if TYPE_CHECKING:
    from fastapi_users import BaseUserManager


class BlocklistAwareJWTStrategy(JWTStrategy[Any, Any]):
    async def read_token(
        self,
        token: str | None,
        user_manager: "BaseUserManager[Any, Any]",
    ) -> Any:
        if token is None:
            return None
        try:
            decoded = decode_token_full(token, "access")
        except TokenError:
            return await super().read_token(token, user_manager)

        if await is_revoked(get_redis(), decoded.jti):
            return None

        return await super().read_token(token, user_manager)
