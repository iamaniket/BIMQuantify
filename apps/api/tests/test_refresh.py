import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from bimdossier_api.config import get_settings
from tests.conftest import _TEST_PASSWORD, make_test_user


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _login(
    client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
    email: str,
) -> dict[str, str]:
    await make_test_user(session_maker, email=email)
    response = await client.post(
        "/auth/jwt/login",
        data={"username": email, "password": _TEST_PASSWORD},
    )
    assert response.status_code == 200, response.text
    return response.json()


async def test_refresh_issues_new_access_token(
    client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    tokens = await _login(client, session_maker, "ivy@example.com")
    response = await client.post(
        "/auth/jwt/refresh", json={"refresh_token": tokens["refresh_token"]}
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["access_token"]
    assert body["access_token"] != tokens["access_token"] or body["token_type"] == "bearer"


async def test_refresh_rejects_access_token(
    client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    tokens = await _login(client, session_maker, "jane@example.com")
    response = await client.post(
        "/auth/jwt/refresh", json={"refresh_token": tokens["access_token"]}
    )
    assert response.status_code == 401


async def test_refresh_rejects_garbage(
    client: AsyncClient,
) -> None:
    response = await client.post("/auth/jwt/refresh", json={"refresh_token": "not-a-jwt"})
    assert response.status_code == 401


# ---------------------------------------------------------------------------
# M-auth2 — refresh-token rotation + reuse detection.
# ---------------------------------------------------------------------------


async def test_refresh_rotates_the_refresh_token(
    client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """Each refresh returns a NEW refresh token, and the new one works."""
    tokens = await _login(client, session_maker, "rot-basic@example.com")

    resp = await client.post("/auth/jwt/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert resp.status_code == 200, resp.text
    new_refresh = resp.json()["refresh_token"]
    assert new_refresh, "refresh response must carry a rotated refresh token"
    assert new_refresh != tokens["refresh_token"], "the refresh token must rotate"

    # The successor works as a refresh token.
    again = await client.post("/auth/jwt/refresh", json={"refresh_token": new_refresh})
    assert again.status_code == 200, again.text


async def test_refresh_reuse_signs_out_everywhere(
    client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Replaying a retired refresh token outside the grace window is treated as
    theft: reuse detection bumps the token epoch, killing EVERY session — even a
    second, independent session that was never presented to the refresh endpoint.
    """
    # Disable the grace window so the immediate replay is reuse, not a re-issue.
    monkeypatch.setattr(get_settings(), "refresh_rotation_grace_seconds", 0)

    email = "rot-reuse@example.com"
    await make_test_user(session_maker, email=email)

    async def _fresh_login() -> dict[str, str]:
        r = await client.post(
            "/auth/jwt/login", data={"username": email, "password": _TEST_PASSWORD}
        )
        assert r.status_code == 200, r.text
        return r.json()

    session_a = await _fresh_login()
    session_b = await _fresh_login()  # independent session, never refreshed

    # Rotate A's refresh token (R1 -> R2).
    rotated = await client.post(
        "/auth/jwt/refresh", json={"refresh_token": session_a["refresh_token"]}
    )
    assert rotated.status_code == 200, rotated.text
    r2 = rotated.json()["refresh_token"]

    # Replay the retired R1 → reuse detected.
    replay = await client.post(
        "/auth/jwt/refresh", json={"refresh_token": session_a["refresh_token"]}
    )
    assert replay.status_code == 401, replay.text
    assert replay.json()["detail"] == "REFRESH_TOKEN_REUSED"

    # The whole family is dead: R2 (minted before the epoch bump) no longer works.
    r2_after = await client.post("/auth/jwt/refresh", json={"refresh_token": r2})
    assert r2_after.status_code == 401, r2_after.text

    # And session B — never involved in the reuse — is signed out too (pure epoch
    # signal: B's tokens were never blocklisted).
    me_b = await client.get("/users/me", headers=_auth(session_b["access_token"]))
    assert me_b.status_code == 401, me_b.text


async def test_refresh_grace_window_reissues_same_successor(
    client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Within the grace window, replaying the just-rotated token is benign (a
    cross-tab race / retry): it re-issues the SAME successor instead of tripping
    reuse detection, so neither client is logged out."""
    monkeypatch.setattr(get_settings(), "refresh_rotation_grace_seconds", 60)

    tokens = await _login(client, session_maker, "rot-grace@example.com")

    first = await client.post("/auth/jwt/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert first.status_code == 200, first.text
    r2 = first.json()["refresh_token"]

    # Immediate replay of the retired token → SAME successor, fresh access, 200.
    replay = await client.post("/auth/jwt/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert replay.status_code == 200, replay.text
    assert replay.json()["refresh_token"] == r2

    # The successor still works (no family kill happened).
    ok = await client.post("/auth/jwt/refresh", json={"refresh_token": r2})
    assert ok.status_code == 200, ok.text
