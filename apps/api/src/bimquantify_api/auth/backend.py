from fastapi_users.authentication import AuthenticationBackend, BearerTransport, JWTStrategy

from bimquantify_api.auth.tokens import ALGORITHM
from bimquantify_api.config import get_settings

bearer_transport = BearerTransport(tokenUrl="auth/jwt/login")


def get_jwt_strategy() -> JWTStrategy:
    settings = get_settings()
    return JWTStrategy(
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
