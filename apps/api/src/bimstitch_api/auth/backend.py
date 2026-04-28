from fastapi_users.authentication import AuthenticationBackend, BearerTransport

from bimstitch_api.auth.strategy import BlocklistAwareJWTStrategy
from bimstitch_api.auth.tokens import ALGORITHM
from bimstitch_api.config import get_settings

bearer_transport = BearerTransport(tokenUrl="auth/jwt/login")


def get_jwt_strategy() -> BlocklistAwareJWTStrategy:
    settings = get_settings()
    return BlocklistAwareJWTStrategy(
        secret=settings.jwt_secret,
        lifetime_seconds=settings.jwt_access_ttl_seconds,
        algorithm=ALGORITHM,
        token_audience=["fastapi-users:auth"],
    )


auth_backend = AuthenticationBackend(
    name="jwt",
    transport=bearer_transport,
    get_strategy=get_jwt_strategy,
)
