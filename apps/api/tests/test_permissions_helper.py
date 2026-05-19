from __future__ import annotations

import pytest
from fastapi import HTTPException

from bimstitch_api.auth.permissions import (
    Action,
    Resource,
    has_permission,
    require_permission,
)
from bimstitch_api.models.project_member import ProjectRole


# Override conftest's autouse DB/Redis fixtures — pure-unit test.
@pytest.fixture(autouse=True)
def _clean_tables() -> None:
    return None


@pytest.fixture(autouse=True)
def _flush_redis() -> None:
    return None


@pytest.fixture(autouse=True)
def _stub_extraction_dispatcher() -> None:
    return None


def test_require_permission_returns_none_when_allowed() -> None:
    # Owner can update a project — should not raise.
    assert (
        require_permission(ProjectRole.owner, Resource.project, Action.update) is None
    )


def test_require_permission_raises_403_when_denied() -> None:
    with pytest.raises(HTTPException) as exc:
        require_permission(ProjectRole.viewer, Resource.project, Action.update)
    assert exc.value.status_code == 403
    detail = exc.value.detail
    assert isinstance(detail, dict)
    assert detail["code"] == "PERMISSION_DENIED"
    assert detail["role"] == "viewer"
    assert detail["resource"] == "project"
    assert detail["action"] == "update"


def test_require_permission_consistent_with_has_permission() -> None:
    # The helper should never disagree with the underlying matrix.
    for role in ProjectRole:
        for resource in Resource:
            for action in Action:
                allowed = has_permission(role, resource, action)
                if allowed:
                    assert require_permission(role, resource, action) is None
                else:
                    with pytest.raises(HTTPException) as exc:
                        require_permission(role, resource, action)
                    assert exc.value.status_code == 403


def test_only_inspector_can_sign_via_helper() -> None:
    # No-raise for inspector.
    require_permission(
        ProjectRole.inspector, Resource.completion_declaration, Action.sign
    )
    # 403 for all other roles.
    for role in ProjectRole:
        if role is ProjectRole.inspector:
            continue
        with pytest.raises(HTTPException):
            require_permission(role, Resource.completion_declaration, Action.sign)
