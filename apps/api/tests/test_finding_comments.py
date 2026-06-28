"""HTTP-level integration tests for Finding discussion comments.

Acceptance: a flat, chronological thread per finding; read by any project
member; create/edit/delete gated on the Resource.finding matrix (author-only
edit, author-or-moderator delete); @mentions notify only the mentioned member
(targeted), drop non-members, never self-notify, and don't re-notify on edit;
soft-delete hides a comment; tenant isolation; audit trail.
"""

from __future__ import annotations

from typing import TYPE_CHECKING
from uuid import uuid4

from tests.conftest import _add_member, _audit_rows, _auth, _create_project

if TYPE_CHECKING:
    from httpx import AsyncClient
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _create_finding(
    client: AsyncClient, token: str, project_id: str, **overrides: object
) -> dict:
    payload: dict[str, object] = {
        "title": "Brandwerende doorvoer ontbreekt",
        "description": "Doorvoer in brandscheiding nabij meterkast niet afgewerkt.",
    }
    payload.update(overrides)
    resp = await client.post(
        f"/projects/{project_id}/findings", json=payload, headers=_auth(token)
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _mention(user_id: str, name: str = "X") -> str:
    return f"@[{name}]({user_id})"


async def _ensure_member(
    client: AsyncClient, owner_token: str, project_id: str, user_id: str, role: str
) -> None:
    """Add a member, tolerating 409 — org admins are auto-enrolled in projects."""
    resp = await client.post(
        f"/projects/{project_id}/members",
        json={"user_id": user_id, "role": role},
        headers=_auth(owner_token),
    )
    assert resp.status_code in (201, 409), resp.text


def _comments_url(project_id: str, finding_id: str) -> str:
    return f"/projects/{project_id}/findings/{finding_id}/comments"


async def _post_comment(
    client: AsyncClient,
    token: str,
    project_id: str,
    finding_id: str,
    text: str,
    *,
    expect: int = 201,
):
    resp = await client.post(
        _comments_url(project_id, finding_id),
        json={"text": text},
        headers=_auth(token),
    )
    assert resp.status_code == expect, resp.text
    return resp


async def _list_comments(
    client: AsyncClient, token: str, project_id: str, finding_id: str
) -> list[dict]:
    resp = await client.get(_comments_url(project_id, finding_id), headers=_auth(token))
    assert resp.status_code == 200, resp.text
    return resp.json()


async def _mention_notifs(client: AsyncClient, token: str) -> list[dict]:
    resp = await client.get("/notifications", headers=_auth(token))
    assert resp.status_code == 200, resp.text
    return [n for n in resp.json()["items"] if n["event_type"] == "finding_mentioned"]


# ---------------------------------------------------------------------------
# Create + list
# ---------------------------------------------------------------------------


async def test_create_comment(client: AsyncClient, org_user: dict[str, str]) -> None:
    token = org_user["access_token"]
    project = await _create_project(client, token)
    finding = await _create_finding(client, token, project["id"])
    resp = await _post_comment(client, token, project["id"], finding["id"], "Dit moet hersteld.")
    body = resp.json()
    assert body["comment_text"] == "Dit moet hersteld."
    assert body["finding_id"] == finding["id"]
    assert body["created_by_user_id"] == org_user["id"]
    assert body["actor_email"] == "alice@example.com"
    assert body["mentions"] == []
    assert body["modified_date"] is None
    assert "id" in body and "created_at" in body


async def test_create_comment_strips_and_rejects_whitespace(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    token = org_user["access_token"]
    project = await _create_project(client, token)
    finding = await _create_finding(client, token, project["id"])
    # Surrounding whitespace is trimmed.
    resp = await _post_comment(client, token, project["id"], finding["id"], "  hi  ")
    assert resp.json()["comment_text"] == "hi"
    # Whitespace-only collapses to "" -> 422.
    await _post_comment(client, token, project["id"], finding["id"], "   ", expect=422)


async def test_create_comment_max_length(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    token = org_user["access_token"]
    project = await _create_project(client, token)
    finding = await _create_finding(client, token, project["id"])
    await _post_comment(client, token, project["id"], finding["id"], "x" * 4001, expect=422)


async def test_list_comments_chronological(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    token = org_user["access_token"]
    project = await _create_project(client, token)
    finding = await _create_finding(client, token, project["id"])
    for text in ("first", "second", "third"):
        await _post_comment(client, token, project["id"], finding["id"], text)
    comments = await _list_comments(client, token, project["id"], finding["id"])
    assert [c["comment_text"] for c in comments] == ["first", "second", "third"]


async def test_list_comments_read_only_role(
    client: AsyncClient,
    org_user: dict[str, str],
    same_org_non_admin_user: dict[str, str],
) -> None:
    # A viewer (read-only) can read the thread — list reuses finding-read.
    token = org_user["access_token"]
    project = await _create_project(client, token)
    await _add_member(client, token, project["id"], same_org_non_admin_user["id"], "viewer")
    finding = await _create_finding(client, token, project["id"])
    await _post_comment(client, token, project["id"], finding["id"], "kijk hier")
    comments = await _list_comments(
        client, same_org_non_admin_user["access_token"], project["id"], finding["id"]
    )
    assert len(comments) == 1


async def test_create_comment_forbidden_for_viewer(
    client: AsyncClient,
    org_user: dict[str, str],
    same_org_non_admin_user: dict[str, str],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    token = org_user["access_token"]
    project = await _create_project(client, token)
    await _add_member(client, token, project["id"], same_org_non_admin_user["id"], "viewer")
    finding = await _create_finding(client, token, project["id"])
    await _post_comment(
        client,
        same_org_non_admin_user["access_token"],
        project["id"],
        finding["id"],
        "ik mag niet",
        expect=403,
    )
    rows = await _audit_rows(
        session_maker, "permission.denied", user_id=same_org_non_admin_user["id"]
    )
    assert len(rows) >= 1


# ---------------------------------------------------------------------------
# Edit
# ---------------------------------------------------------------------------


async def test_edit_comment_author_only(
    client: AsyncClient,
    org_user: dict[str, str],
    same_org_non_admin_user: dict[str, str],
) -> None:
    token = org_user["access_token"]
    other = same_org_non_admin_user
    project = await _create_project(client, token)
    # editor: holds finding.update but is NOT the comment author.
    await _add_member(client, token, project["id"], other["id"], "editor")
    finding = await _create_finding(client, token, project["id"])
    created = (await _post_comment(client, token, project["id"], finding["id"], "origineel")).json()

    # Author edits -> 200, modified_* stamped.
    ok = await client.patch(
        f"{_comments_url(project['id'], finding['id'])}/{created['id']}",
        json={"text": "bijgewerkt"},
        headers=_auth(token),
    )
    assert ok.status_code == 200, ok.text
    assert ok.json()["comment_text"] == "bijgewerkt"
    assert ok.json()["modified_date"] is not None

    # A different member (with update perm) cannot edit it.
    denied = await client.patch(
        f"{_comments_url(project['id'], finding['id'])}/{created['id']}",
        json={"text": "kaping"},
        headers=_auth(other["access_token"]),
    )
    assert denied.status_code == 403, denied.text


# ---------------------------------------------------------------------------
# Delete
# ---------------------------------------------------------------------------


async def test_delete_comment_author(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    token = org_user["access_token"]
    project = await _create_project(client, token)
    finding = await _create_finding(client, token, project["id"])
    created = (await _post_comment(client, token, project["id"], finding["id"], "weg ermee")).json()
    resp = await client.delete(
        f"{_comments_url(project['id'], finding['id'])}/{created['id']}",
        headers=_auth(token),
    )
    assert resp.status_code == 204, resp.text
    # Hidden from the thread (soft-deleted).
    assert await _list_comments(client, token, project["id"], finding["id"]) == []


async def test_delete_comment_moderator(
    client: AsyncClient,
    org_user: dict[str, str],
    same_org_non_admin_user: dict[str, str],
) -> None:
    # The project owner (sole holder of finding.delete) moderates another
    # member's comment.
    token = org_user["access_token"]
    other = same_org_non_admin_user
    project = await _create_project(client, token)
    await _add_member(client, token, project["id"], other["id"], "contractor")
    finding = await _create_finding(client, token, project["id"])
    created = (
        await _post_comment(
            client, other["access_token"], project["id"], finding["id"], "van de aannemer"
        )
    ).json()
    resp = await client.delete(
        f"{_comments_url(project['id'], finding['id'])}/{created['id']}",
        headers=_auth(token),
    )
    assert resp.status_code == 204, resp.text


async def test_delete_comment_forbidden_for_non_author_non_moderator(
    client: AsyncClient,
    org_user: dict[str, str],
    same_org_non_admin_user: dict[str, str],
) -> None:
    # A contractor lacks finding.delete -> can't delete someone else's comment,
    # but CAN delete their own.
    token = org_user["access_token"]
    other = same_org_non_admin_user
    project = await _create_project(client, token)
    await _add_member(client, token, project["id"], other["id"], "contractor")
    finding = await _create_finding(client, token, project["id"])
    owners = (
        await _post_comment(client, token, project["id"], finding["id"], "owner comment")
    ).json()

    denied = await client.delete(
        f"{_comments_url(project['id'], finding['id'])}/{owners['id']}",
        headers=_auth(other["access_token"]),
    )
    assert denied.status_code == 403, denied.text

    mine = (
        await _post_comment(
            client, other["access_token"], project["id"], finding["id"], "mijn comment"
        )
    ).json()
    ok = await client.delete(
        f"{_comments_url(project['id'], finding['id'])}/{mine['id']}",
        headers=_auth(other["access_token"]),
    )
    assert ok.status_code == 204, ok.text


# ---------------------------------------------------------------------------
# @mentions
# ---------------------------------------------------------------------------


async def test_mention_notifies_targeted_member(
    client: AsyncClient,
    org_user: dict[str, str],
    same_org_non_admin_user: dict[str, str],
) -> None:
    token = org_user["access_token"]
    other = same_org_non_admin_user
    project = await _create_project(client, token)
    await _add_member(client, token, project["id"], other["id"], "contractor")
    finding = await _create_finding(client, token, project["id"])
    body = (
        await _post_comment(
            client,
            token,
            project["id"],
            finding["id"],
            f"Kun je hiernaar kijken {_mention(other['id'], 'Bob')}?",
        )
    ).json()
    assert {m["user_id"] for m in body["mentions"]} == {other["id"]}

    # The mentioned member sees a targeted notification...
    assert len(await _mention_notifs(client, other["access_token"])) == 1
    # ...the author does not (targeted + author-excluded).
    assert await _mention_notifs(client, token) == []


async def test_mention_non_member_dropped(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    token = org_user["access_token"]
    project = await _create_project(client, token)
    finding = await _create_finding(client, token, project["id"])
    ghost = str(uuid4())
    body = (
        await _post_comment(
            client, token, project["id"], finding["id"], f"hallo {_mention(ghost)}"
        )
    ).json()
    assert body["mentions"] == []


async def test_self_mention_records_but_does_not_notify(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    token = org_user["access_token"]
    project = await _create_project(client, token)
    finding = await _create_finding(client, token, project["id"])
    body = (
        await _post_comment(
            client, token, project["id"], finding["id"], f"memo {_mention(org_user['id'])}"
        )
    ).json()
    # Mention is recorded (the author IS a project member)...
    assert {m["user_id"] for m in body["mentions"]} == {org_user["id"]}
    # ...but no self-notification.
    assert await _mention_notifs(client, token) == []


async def test_edit_adds_mention_notifies_new_only(
    client: AsyncClient,
    org_user: dict[str, str],
    same_org_non_admin_user: dict[str, str],
    same_org_admin_user: dict[str, str],
) -> None:
    token = org_user["access_token"]
    a = same_org_non_admin_user
    b = same_org_admin_user
    project = await _create_project(client, token)
    await _ensure_member(client, token, project["id"], a["id"], "contractor")
    await _ensure_member(client, token, project["id"], b["id"], "editor")
    finding = await _create_finding(client, token, project["id"])

    created = (
        await _post_comment(
            client, token, project["id"], finding["id"], f"hoi {_mention(a['id'])}"
        )
    ).json()
    assert len(await _mention_notifs(client, a["access_token"])) == 1

    edit = await client.patch(
        f"{_comments_url(project['id'], finding['id'])}/{created['id']}",
        json={"text": f"hoi {_mention(a['id'])} en {_mention(b['id'])}"},
        headers=_auth(token),
    )
    assert edit.status_code == 200, edit.text

    # B is newly notified; A is NOT re-notified (diff-based).
    assert len(await _mention_notifs(client, b["access_token"])) == 1
    assert len(await _mention_notifs(client, a["access_token"])) == 1


# ---------------------------------------------------------------------------
# Audit + isolation + edge cases
# ---------------------------------------------------------------------------


async def test_concurrent_mention_sync_no_duplicate_500(
    client: AsyncClient,
    org_user: dict[str, str],
) -> None:
    """M-con4: two mention syncs for the same (comment, user) racing on an empty
    existing-set must not collide on the composite PK. ON CONFLICT DO NOTHING
    makes the insert idempotent, so neither 500s and exactly one row lands.
    """
    import asyncio
    from uuid import UUID

    from sqlalchemy import func, select

    from bimdossier_api.models.finding_comment import FindingCommentMention
    from bimdossier_api.routers.finding_comment import _sync_mentions
    from bimdossier_api.tenancy import open_tenant_session, schema_name_for

    token = org_user["access_token"]
    org_id = UUID(org_user["organization_id"])
    user_id = UUID(org_user["id"])
    schema = schema_name_for(org_id)

    project = await _create_project(client, token)
    finding = await _create_finding(client, token, project["id"])
    comment = (
        await _post_comment(client, token, project["id"], finding["id"], "hi")
    ).json()
    comment_id = UUID(comment["id"])
    project_id = UUID(project["id"])
    raw = {user_id}  # self-mention: the owner is a project member, so it resolves

    async def _sync() -> None:
        async with open_tenant_session(schema, org_id, user_id) as session:
            await _sync_mentions(
                session,
                comment_id=comment_id,
                project_id=project_id,
                raw_ids=raw,
                author_user_id=user_id,
            )

    # Both insert the same mention concurrently; without ON CONFLICT one 500s.
    await asyncio.gather(_sync(), _sync())

    async with open_tenant_session(schema, org_id, user_id) as session:
        count = await session.scalar(
            select(func.count())
            .select_from(FindingCommentMention)
            .where(FindingCommentMention.comment_id == comment_id)
        )
    assert count == 1


async def test_create_comment_writes_audit(
    client: AsyncClient,
    org_user: dict[str, str],
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    token = org_user["access_token"]
    project = await _create_project(client, token)
    finding = await _create_finding(client, token, project["id"])
    created = (await _post_comment(client, token, project["id"], finding["id"], "trace mij")).json()
    rows = await _audit_rows(session_maker, "finding_comment.created", resource_id=created["id"])
    assert len(rows) == 1
    assert str(rows[0].project_id) == project["id"]


async def test_comment_sibling_finding_404(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    token = org_user["access_token"]
    project = await _create_project(client, token)
    f1 = await _create_finding(client, token, project["id"])
    f2 = await _create_finding(client, token, project["id"])
    created = (await _post_comment(client, token, project["id"], f1["id"], "op f1")).json()
    # Same comment id, wrong finding -> 404.
    resp = await client.patch(
        f"{_comments_url(project['id'], f2['id'])}/{created['id']}",
        json={"text": "verkeerd"},
        headers=_auth(token),
    )
    assert resp.status_code == 404, resp.text


async def test_comment_tenant_isolation(
    client: AsyncClient,
    org_user: dict[str, str],
    other_org_user: dict[str, str],
) -> None:
    token = org_user["access_token"]
    project = await _create_project(client, token)
    finding = await _create_finding(client, token, project["id"])
    await _post_comment(client, token, project["id"], finding["id"], "geheim")
    # A user from another org can't see the project (404, no row leak).
    resp = await client.get(
        _comments_url(project["id"], finding["id"]),
        headers=_auth(other_org_user["access_token"]),
    )
    assert resp.status_code == 404, resp.text


async def test_comment_on_deleted_finding_404(
    client: AsyncClient, org_user: dict[str, str]
) -> None:
    token = org_user["access_token"]
    project = await _create_project(client, token)
    finding = await _create_finding(client, token, project["id"])
    delete_resp = await client.delete(
        f"/projects/{project['id']}/findings/{finding['id']}", headers=_auth(token)
    )
    assert delete_resp.status_code == 204, delete_resp.text
    await _post_comment(client, token, project["id"], finding["id"], "te laat", expect=404)
    resp = await client.get(_comments_url(project["id"], finding["id"]), headers=_auth(token))
    assert resp.status_code == 404, resp.text
