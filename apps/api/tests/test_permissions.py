"""Unit tests for the project-role permission matrix.

Pure tests — no DB fixtures, no app fixtures. They pin the matrix so
accidental policy changes show up in PR diffs.
"""

from __future__ import annotations

from bimdossier_api.auth.permissions import (
    _MATRIX,
    Action,
    Resource,
    has_permission,
    serialize_matrix,
)
from bimdossier_api.models.project_member import ProjectRole

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


def test_serialize_matrix_covers_every_role_and_resource() -> None:
    """The wire payload served to the portal must mirror the matrix exactly:
    every role, every resource, action codes matching `has_permission`."""
    serialized = serialize_matrix()
    assert set(serialized.keys()) == {role.value for role in ProjectRole}
    for role in ProjectRole:
        role_map = serialized[role.value]
        assert set(role_map.keys()) == {resource.value for resource in Resource}
        for resource in Resource:
            expected = {a.value for a in Action if has_permission(role, resource, a)}
            assert set(role_map[resource.value]) == expected
            # Sorted + JSON-safe: a plain list of strings, deterministic order.
            assert role_map[resource.value] == sorted(role_map[resource.value])


def test_has_permission_never_raises() -> None:
    """Sanity: every (role, resource, action) triple resolves to a bool.

    Previously parametrized as 432 individual tests (6 roles x 12 resources
    x 6 actions). Collapsed into a single loop — same coverage, ~150s faster
    because we avoid 431 extra ``_clean_tables`` teardowns.
    """
    for role in ProjectRole:
        for resource in Resource:
            for action in Action:
                result = has_permission(role, resource, action)
                assert isinstance(result, bool), (
                    f"has_permission({role}, {resource}, {action}) returned {type(result)}"
                )


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


def test_contractor_can_create_and_update_findings_but_not_delete() -> None:
    # Aannemer-first: the contractor logs findings manually from the KB's
    # emailed/PDF report (create) and works them through resolution (update),
    # but cannot delete them. Mirrors the inspector's finding cell.
    assert has_permission(ProjectRole.contractor, Resource.finding, Action.create)
    assert has_permission(ProjectRole.contractor, Resource.finding, Action.update)
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


def test_only_owner_can_publish_assurance_plan() -> None:
    for role in ProjectRole:
        allowed = has_permission(role, Resource.assurance_plan, Action.publish)
        if role is ProjectRole.owner:
            assert allowed, "owner must be able to publish"
        else:
            assert not allowed, f"{role.value} must NOT publish"


def test_risk_crud_requires_owner_or_editor() -> None:
    for role in ProjectRole:
        can_create = has_permission(role, Resource.risk, Action.create)
        can_update = has_permission(role, Resource.risk, Action.update)
        can_delete = has_permission(role, Resource.risk, Action.delete)
        if role in (ProjectRole.owner, ProjectRole.editor):
            assert can_create and can_update and can_delete
        else:
            assert not can_create and not can_update and not can_delete


def test_certificate_upload_requires_write_role() -> None:
    # The subcontractor (contractor) uploads his own proof-of-conformity
    # certificates; the inspector (kwaliteitsborger) and client only consume
    # them as evidence and cannot create. Read is universal.
    for role in ProjectRole:
        assert has_permission(role, Resource.certificate, Action.read)
    can_create = {r for r in ProjectRole if has_permission(r, Resource.certificate, Action.create)}
    assert can_create == {
        ProjectRole.owner,
        ProjectRole.editor,
        ProjectRole.contractor,
    }
    assert not has_permission(ProjectRole.inspector, Resource.certificate, Action.create)
    assert not has_permission(ProjectRole.viewer, Resource.certificate, Action.create)
    assert not has_permission(ProjectRole.client, Resource.certificate, Action.create)


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
            "deadline": {"read", "update"},
            "risk": {"read", "create", "update", "delete"},
            "assurance_plan": {"read", "create", "update", "delete", "publish"},
            "completion_declaration": {"read"},
            "audit_log": {"read"},
            "attachment": {"read", "create", "update", "delete"},
            "certificate": {"read", "create", "update", "delete"},
            "capture_link": {"read", "create", "update", "delete"},
            "compliance": {"read", "create"},
            "report": {"read", "create"},
            "bcf_topic": {"read", "create", "update", "delete"},
        },
        "editor": {
            "project": {"read", "update"},
            "model": {"read", "create", "update"},
            "project_file": {"read", "create", "update", "delete"},
            "member": {"read"},
            "invitation": {"read"},
            "inspection": {"read", "create", "update", "delete"},
            "finding": {"read", "create", "update"},
            "deadline": {"read", "update"},
            "risk": {"read", "create", "update", "delete"},
            "assurance_plan": {"read", "create", "update", "delete"},
            "completion_declaration": {"read"},
            "audit_log": set(),
            "attachment": {"read", "create", "update", "delete"},
            "certificate": {"read", "create", "update", "delete"},
            "capture_link": {"read", "create", "update"},
            "compliance": {"read", "create"},
            "report": {"read", "create"},
            "bcf_topic": {"read", "create", "update", "delete"},
        },
        "viewer": {
            "project": {"read"},
            "model": {"read"},
            "project_file": {"read"},
            "member": {"read"},
            "invitation": set(),
            "inspection": {"read"},
            "finding": {"read"},
            "deadline": {"read"},
            "risk": {"read"},
            "assurance_plan": {"read"},
            "completion_declaration": {"read"},
            "audit_log": set(),
            "attachment": {"read"},
            "certificate": {"read"},
            "capture_link": {"read"},
            "compliance": {"read"},
            "report": {"read"},
            "bcf_topic": {"read"},
        },
        "inspector": {
            "project": {"read"},
            "model": {"read"},
            "project_file": {"read"},
            "member": {"read"},
            "invitation": set(),
            "inspection": {"read", "create", "update", "delete"},
            "finding": {"read", "create", "update"},
            "deadline": {"read", "update"},
            "risk": {"read"},
            "assurance_plan": {"read", "create", "update"},
            "completion_declaration": {"read", "create", "update", "sign"},
            "audit_log": {"read"},
            "attachment": {"read", "create", "update"},
            "certificate": {"read"},
            "capture_link": {"read"},
            "compliance": {"read", "create"},
            "report": {"read", "create"},
            "bcf_topic": {"read", "create", "update"},
        },
        "contractor": {
            "project": {"read"},
            "model": {"read"},
            "project_file": {"read", "create", "update"},
            "member": {"read"},
            "invitation": set(),
            "inspection": {"read"},
            "finding": {"read", "create", "update"},
            "deadline": {"read", "update"},
            "risk": {"read"},
            "assurance_plan": {"read"},
            "completion_declaration": {"read"},
            "audit_log": set(),
            "attachment": {"read", "create", "update"},
            "certificate": {"read", "create", "update"},
            "capture_link": {"read"},
            "compliance": {"read"},
            "report": {"read"},
            "bcf_topic": {"read", "create", "update"},
        },
        "client": {
            "project": {"read"},
            "model": {"read"},
            "project_file": {"read"},
            "member": {"read"},
            "invitation": set(),
            "inspection": {"read"},
            "finding": {"read"},
            "deadline": {"read"},
            "risk": {"read"},
            "assurance_plan": {"read"},
            "completion_declaration": {"read"},
            "audit_log": set(),
            "attachment": {"read"},
            "certificate": {"read"},
            "capture_link": {"read"},
            "compliance": {"read"},
            "report": {"read"},
            "bcf_topic": {"read"},
        },
    }

    for role in ProjectRole:
        for resource in Resource:
            actual = {a.value for a in Action if has_permission(role, resource, a)}
            assert actual == expected[role.value][resource.value], (
                f"snapshot drift: role={role.value} resource={resource.value} "
                f"expected={expected[role.value][resource.value]} actual={actual}"
            )
