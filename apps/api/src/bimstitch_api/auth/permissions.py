"""Project-role permission matrix.

Single source of truth for "what can each ProjectRole do to each Resource".
Pure module — no DB, no FastAPI deps — so it's importable from anywhere and
trivially unit-testable.

This is intentionally not wired into the routers yet. The 14 existing
`_require_role(...)` call-sites in routers/{projects,models,project_files}.py
continue to do their per-endpoint membership-role checks. A follow-up task
will refactor those to delegate to `has_permission()`.

Role and resource codes are jurisdiction-neutral; Dutch (or other locale)
display labels live in the portal i18n catalog. The semantic mapping for the
NL/WKB market is:

  - owner             — project creator; full control including member mgmt.
  - editor            — generic write role; pre-existing tier.
  - viewer            — generic read-only role; pre-existing tier.
  - inspector         — quality inspector (NL: kwaliteitsborger);
                        full inspect rights + sole sign authority.
  - contractor        — contractor (NL: aannemer); reads everything,
                        writes inspections, marks findings resolved.
  - client            — client / principal (NL: opdrachtgever);
                        reads most, no writes.

Resource codes follow the same rule: `assurance_plan` (NL: borgingsplan),
`completion_declaration` (NL: verklaring).
"""

from __future__ import annotations

from enum import StrEnum
from types import MappingProxyType
from typing import TYPE_CHECKING

from bimstitch_api.models.project_member import ProjectRole

if TYPE_CHECKING:
    from collections.abc import Mapping


class Resource(StrEnum):
    project = "project"
    model = "model"
    project_file = "project_file"
    member = "member"
    invitation = "invitation"
    inspection = "inspection"
    finding = "finding"
    assurance_plan = "assurance_plan"
    completion_declaration = "completion_declaration"
    audit_log = "audit_log"


class Action(StrEnum):
    read = "read"
    create = "create"
    update = "update"
    delete = "delete"
    archive = "archive"
    invite = "invite"
    sign = "sign"


_ALL: frozenset[Action] = frozenset(Action)
_READ: frozenset[Action] = frozenset({Action.read})
_READ_WRITE: frozenset[Action] = frozenset({Action.read, Action.create, Action.update})
_READ_WRITE_DELETE: frozenset[Action] = frozenset(
    {Action.read, Action.create, Action.update, Action.delete}
)
_NONE: frozenset[Action] = frozenset()


# Matrix: role -> resource -> allowed actions.
# Every (role, resource) pair must be present — see test_permissions for
# the totality check. Use `_NONE` to mean "explicitly denied", never omit.
_MATRIX: Mapping[ProjectRole, Mapping[Resource, frozenset[Action]]] = MappingProxyType(
    {
        ProjectRole.owner: MappingProxyType(
            {
                Resource.project: frozenset(
                    {Action.read, Action.update, Action.delete, Action.archive}
                ),
                Resource.model: _READ_WRITE_DELETE,
                Resource.project_file: _READ_WRITE_DELETE,
                Resource.member: frozenset(
                    {Action.read, Action.create, Action.update, Action.delete}
                ),
                Resource.invitation: frozenset(
                    {Action.read, Action.create, Action.delete, Action.invite}
                ),
                Resource.inspection: _READ_WRITE_DELETE,
                Resource.finding: _READ_WRITE_DELETE,
                Resource.assurance_plan: _READ_WRITE_DELETE,
                Resource.completion_declaration: _READ,
                Resource.audit_log: _READ,
            }
        ),
        ProjectRole.editor: MappingProxyType(
            {
                Resource.project: frozenset({Action.read, Action.update}),
                Resource.model: _READ_WRITE,
                Resource.project_file: _READ_WRITE,
                Resource.member: _READ,
                Resource.invitation: _READ,
                Resource.inspection: _READ_WRITE,
                Resource.finding: _READ_WRITE,
                Resource.assurance_plan: _READ_WRITE,
                Resource.completion_declaration: _READ,
                Resource.audit_log: _NONE,
            }
        ),
        ProjectRole.viewer: MappingProxyType(
            {
                Resource.project: _READ,
                Resource.model: _READ,
                Resource.project_file: _READ,
                Resource.member: _READ,
                Resource.invitation: _NONE,
                Resource.inspection: _READ,
                Resource.finding: _READ,
                Resource.assurance_plan: _READ,
                Resource.completion_declaration: _READ,
                Resource.audit_log: _NONE,
            }
        ),
        # Inspector (NL: kwaliteitsborger): full inspect rights + sole holder
        # of `sign` on the completion_declaration (legal constraint from
        # backlog #7). Cannot manage members or invite — that's the
        # owner/contractor's job.
        ProjectRole.inspector: MappingProxyType(
            {
                Resource.project: _READ,
                Resource.model: _READ,
                Resource.project_file: _READ,
                Resource.member: _READ,
                Resource.invitation: _NONE,
                Resource.inspection: _READ_WRITE_DELETE,
                Resource.finding: frozenset({Action.read, Action.create, Action.update}),
                Resource.assurance_plan: _READ_WRITE,
                # Sole signing authority — the legal core of the system.
                Resource.completion_declaration: frozenset(
                    {Action.read, Action.create, Action.update, Action.sign}
                ),
                Resource.audit_log: _READ,
            }
        ),
        # Contractor (NL: aannemer): reads all project data, writes
        # inspections, marks findings as resolved (modeled as `update` on
        # finding).
        ProjectRole.contractor: MappingProxyType(
            {
                Resource.project: _READ,
                Resource.model: _READ,
                Resource.project_file: _READ_WRITE,
                Resource.member: _READ,
                Resource.invitation: _NONE,
                Resource.inspection: _READ_WRITE,
                Resource.finding: frozenset({Action.read, Action.update}),
                Resource.assurance_plan: _READ,
                Resource.completion_declaration: _READ,
                Resource.audit_log: _NONE,
            }
        ),
        # Client / principal (NL: opdrachtgever): reads most things, writes
        # nothing.
        ProjectRole.client: MappingProxyType(
            {
                Resource.project: _READ,
                Resource.model: _READ,
                Resource.project_file: _READ,
                Resource.member: _READ,
                Resource.invitation: _NONE,
                Resource.inspection: _READ,
                Resource.finding: _READ,
                Resource.assurance_plan: _READ,
                Resource.completion_declaration: _READ,
                Resource.audit_log: _NONE,
            }
        ),
    }
)


def has_permission(role: ProjectRole, resource: Resource, action: Action) -> bool:
    """Return True iff `role` is allowed to perform `action` on `resource`."""
    return action in _MATRIX[role][resource]


__all__ = ["Action", "Resource", "has_permission"]
