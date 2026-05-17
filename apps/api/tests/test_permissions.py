"""Unit tests for the project-role permission matrix.

Pure tests — no DB fixtures, no app fixtures. They pin the matrix so
accidental policy changes show up in PR diffs.
"""

from __future__ import annotations

import pytest

from bimstitch_api.auth.permissions import _MATRIX, Action, Resource, has_permission
from bimstitch_api.models.project_member import ProjectRole

# ---------------------------------------------------------------------------
# Totality: every (role, resource) pair is defined.
# ---------------------------------------------------------------------------


def test_matrix_covers_every_role() -> None:
    assert set(_MATRIX.keys()) == set(ProjectRole)


def test_matrix_covers_every_resource_for_every_role() -> None:
    for role in ProjectRole:
        assert set(_MATRIX[role].keys()) == set(Resource), (
            f"role={role.value} is missing entries for: {set(Resource) - set(_MATRIX[role].keys())}"
        )


@pytest.mark.parametrize("role", list(ProjectRole))
@pytest.mark.parametrize("resource", list(Resource))
@pytest.mark.parametrize("action", list(Action))
def test_has_permission_never_raises(role: ProjectRole, resource: Resource, action: Action) -> None:
    """Sanity: every (role, resource, action) triple resolves to a bool."""
    result = has_permission(role, resource, action)
    assert isinstance(result, bool)


# ---------------------------------------------------------------------------
# Owner / viewer invariants.
# ---------------------------------------------------------------------------


def test_owner_can_read_every_resource() -> None:
    for resource in Resource:
        assert has_permission(ProjectRole.owner, resource, Action.read)


def test_owner_has_at_least_one_write_action_on_writable_resources() -> None:
    """Owner has *some* write capability on every resource except the two
    intentionally read-only ones:
      * completion_declaration — only inspector can sign.
      * audit_log              — append-only by design (#36).
    """
    write_actions = {a for a in Action if a is not Action.read}
    read_only_for_owner = {Resource.completion_declaration, Resource.audit_log}
    for resource in Resource:
        if resource in read_only_for_owner:
            continue
        granted = {a for a in write_actions if has_permission(ProjectRole.owner, resource, a)}
        assert granted, f"owner has no write actions on {resource.value}"


def test_owner_cannot_sign_completion_declaration() -> None:
    assert not has_permission(ProjectRole.owner, Resource.completion_declaration, Action.sign)


def test_viewer_has_zero_write_actions() -> None:
    write_actions = {a for a in Action if a is not Action.read}
    for resource in Resource:
        for action in write_actions:
            assert not has_permission(ProjectRole.viewer, resource, action), (
                f"viewer should not have {action.value} on {resource.value}"
            )


# ---------------------------------------------------------------------------
# WKB-domain role invariants (jurisdiction-neutral codes; NL semantics).
# ---------------------------------------------------------------------------


def test_only_inspector_can_sign_completion_declaration() -> None:
    for role in ProjectRole:
        allowed = has_permission(role, Resource.completion_declaration, Action.sign)
        if role is ProjectRole.inspector:
            assert allowed, "inspector must hold sign authority"
        else:
            assert not allowed, f"{role.value} must NOT hold sign authority"


def test_only_owner_can_invite() -> None:
    for role in ProjectRole:
        allowed = has_permission(role, Resource.invitation, Action.invite)
        if role is ProjectRole.owner:
            assert allowed
        else:
            assert not allowed


def test_contractor_can_write_inspections_and_update_findings() -> None:
    assert has_permission(ProjectRole.contractor, Resource.inspection, Action.create)
    assert has_permission(ProjectRole.contractor, Resource.inspection, Action.update)
    assert has_permission(ProjectRole.contractor, Resource.finding, Action.update)
    # But cannot delete findings — only owner.
    assert not has_permission(ProjectRole.contractor, Resource.finding, Action.delete)


def test_client_is_read_only() -> None:
    write_actions = {a for a in Action if a is not Action.read}
    for resource in Resource:
        for action in write_actions:
            assert not has_permission(ProjectRole.client, resource, action), (
                f"client should be read-only, but has {action.value} on {resource.value}"
            )


def test_audit_log_is_append_only() -> None:
    """No role can update or delete audit_log entries through the matrix.

    Foundation for backlog #36 (10-year retention, evidentiary defense).
    """
    for role in ProjectRole:
        assert not has_permission(role, Resource.audit_log, Action.update)
        assert not has_permission(role, Resource.audit_log, Action.delete)


# ---------------------------------------------------------------------------
# Snapshot: pin the current matrix.
# ---------------------------------------------------------------------------


def test_matrix_snapshot() -> None:
    """Pin the current policy. If you intentionally change the matrix,
    update this fixture and call it out in the PR description."""
    expected: dict[str, dict[str, set[str]]] = {
        "owner": {
            "project": {"read", "update", "delete", "archive"},
            "model": {"read", "create", "update", "delete"},
            "project_file": {"read", "create", "update", "delete"},
            "member": {"read", "create", "update", "delete"},
            "invitation": {"read", "create", "delete", "invite"},
            "inspection": {"read", "create", "update", "delete"},
            "finding": {"read", "create", "update", "delete"},
            "assurance_plan": {"read", "create", "update", "delete"},
            "completion_declaration": {"read"},
            "audit_log": {"read"},
        },
        "editor": {
            "project": {"read", "update"},
            "model": {"read", "create", "update"},
            "project_file": {"read", "create", "update"},
            "member": {"read"},
            "invitation": {"read"},
            "inspection": {"read", "create", "update"},
            "finding": {"read", "create", "update"},
            "assurance_plan": {"read", "create", "update"},
            "completion_declaration": {"read"},
            "audit_log": set(),
        },
        "viewer": {
            "project": {"read"},
            "model": {"read"},
            "project_file": {"read"},
            "member": {"read"},
            "invitation": set(),
            "inspection": {"read"},
            "finding": {"read"},
            "assurance_plan": {"read"},
            "completion_declaration": {"read"},
            "audit_log": set(),
        },
        "inspector": {
            "project": {"read"},
            "model": {"read"},
            "project_file": {"read"},
            "member": {"read"},
            "invitation": set(),
            "inspection": {"read", "create", "update", "delete"},
            "finding": {"read", "create", "update"},
            "assurance_plan": {"read", "create", "update"},
            "completion_declaration": {"read", "create", "update", "sign"},
            "audit_log": {"read"},
        },
        "contractor": {
            "project": {"read"},
            "model": {"read"},
            "project_file": {"read", "create", "update"},
            "member": {"read"},
            "invitation": set(),
            "inspection": {"read", "create", "update"},
            "finding": {"read", "update"},
            "assurance_plan": {"read"},
            "completion_declaration": {"read"},
            "audit_log": set(),
        },
        "client": {
            "project": {"read"},
            "model": {"read"},
            "project_file": {"read"},
            "member": {"read"},
            "invitation": set(),
            "inspection": {"read"},
            "finding": {"read"},
            "assurance_plan": {"read"},
            "completion_declaration": {"read"},
            "audit_log": set(),
        },
    }

    for role in ProjectRole:
        for resource in Resource:
            actual = {a.value for a in Action if has_permission(role, resource, a)}
            assert actual == expected[role.value][resource.value], (
                f"snapshot drift: role={role.value} resource={resource.value} "
                f"expected={expected[role.value][resource.value]} actual={actual}"
            )
