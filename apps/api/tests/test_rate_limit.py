from httpx import AsyncClient

from bimstitch_api.config import get_settings


async def test_login_rate_limit_returns_429(rate_limited_client: AsyncClient) -> None:
    settings = get_settings()
    limit = settings.rate_limit_login_per_min
    last_status: int | None = None

    for _ in range(limit + 1):
        response = await rate_limited_client.post(
            "/auth/jwt/login",
            data={"username": "missing@example.com", "password": "whatever"},
        )
        last_status = response.status_code

    assert last_status == 429
