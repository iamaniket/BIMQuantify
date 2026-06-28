"""H9 — credential-rotation events are audited.

forgot-password, reset-password, an authenticated `/users/me` password change,
and account activation each land exactly one forensic audit row (best-effort,
platform schema — same as `auth.login.*`). Guards the fastapi-users hook matrix
so a single reset does not double-count, and that an activate replay records
only once.
"""

import re
from uuid import UUID

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from bimdossier_api.email.transport import InMemoryEmailTransport
from tests.conftest import _audit_rows, make_test_user

NEW_PASSWORD = "fresh-horse-staple-77"


def _extract_token(body: str) -> str:
    match = re.search(r"Token:\s*(\S+)", body)
    assert match is not None, f"no token in email body: {body!r}"
    return match.group(1)


def _for_user(rows: list, user_id: str) -> list:
    return [r for r in rows if str(r.resource_id) == user_id]


async def test_forgot_password_records_audit(
    client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
    email_transport: InMemoryEmailTransport,
) -> None:
    email = "audit-forgot@example.com"
    user_id = await make_test_user(session_maker, email=email, is_verified=True)

    resp = await client.post("/auth/forgot-password", json={"email": email})
    assert resp.status_code == 202, resp.text

    rows = _for_user(await _audit_rows(session_maker, "auth.password.forgot"), user_id)
    assert len(rows) == 1, rows
    assert rows[0].resource_type == "user"
    assert rows[0].user_id == UUID(user_id)


async def test_reset_password_records_audit_no_double_count(
    client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
    email_transport: InMemoryEmailTransport,
) -> None:
    """A reset records exactly one `auth.password.reset` and — critically — zero
    `auth.password.changed` (fastapi-users' reset_password must not also fire the
    on_after_update hook)."""
    email = "audit-reset@example.com"
    user_id = await make_test_user(session_maker, email=email, is_verified=True)

    forgot = await client.post("/auth/forgot-password", json={"email": email})
    assert forgot.status_code == 202, forgot.text
    sent = email_transport.last_for(email)
    assert sent is not None
    token = _extract_token(sent.body)

    reset = await client.post(
        "/auth/reset-password", json={"token": token, "password": NEW_PASSWORD}
    )
    assert reset.status_code == 200, reset.text

    reset_rows = _for_user(await _audit_rows(session_maker, "auth.password.reset"), user_id)
    assert len(reset_rows) == 1, reset_rows
    assert reset_rows[0].user_id == UUID(user_id)

    changed_rows = _for_user(await _audit_rows(session_maker, "auth.password.changed"), user_id)
    assert changed_rows == [], "reset must not also emit auth.password.changed"


async def test_authenticated_password_change_records_audit(
    client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
    org_user: dict[str, str],
) -> None:
    """A self-service `/users/me` password edit emits `auth.password.changed`."""
    resp = await client.patch(
        "/users/me",
        json={"password": NEW_PASSWORD},
        headers={"Authorization": f"Bearer {org_user['access_token']}"},
    )
    assert resp.status_code == 200, resp.text

    rows = _for_user(await _audit_rows(session_maker, "auth.password.changed"), org_user["id"])
    assert len(rows) == 1, rows
    assert rows[0].user_id == UUID(org_user["id"])


async def test_activate_records_audit_once_even_on_replay(
    client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
    email_transport: InMemoryEmailTransport,
) -> None:
    """First activate → one `auth.activate`; an idempotent replay records nothing
    extra (the password is set exactly once, so the event fires exactly once)."""
    email = "audit-activate@example.com"
    user_id = await make_test_user(session_maker, email=email, is_verified=False)

    verify = await client.post("/auth/request-verify-token", json={"email": email})
    assert verify.status_code in (200, 202), verify.text
    sent = email_transport.last_for(email)
    assert sent is not None
    token = _extract_token(sent.body)

    first = await client.post("/auth/activate", json={"token": token, "password": NEW_PASSWORD})
    assert first.status_code == 204, first.text

    replay = await client.post(
        "/auth/activate", json={"token": token, "password": "different-password-99"}
    )
    assert replay.status_code == 204, replay.text

    rows = _for_user(await _audit_rows(session_maker, "auth.activate"), user_id)
    assert len(rows) == 1, rows
    assert rows[0].resource_type == "user"
    assert rows[0].user_id == UUID(user_id)
