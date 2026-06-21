"""Pure payload-builder helpers for the reports router.

These functions build the dict snapshots shipped to the stateless worker. They
take already-loaded ORM instances (no DB/session access) and return plain dicts
or strings. The session-touching loaders/resolvers and the endpoints live in
`endpoints.py`.
"""

from bimstitch_api.i18n import coerce_locale, t
from bimstitch_api.jurisdictions import find_instrument
from bimstitch_api.models.borgingsplan import Borgingsplan
from bimstitch_api.models.certificate import Certificate
from bimstitch_api.models.contractor import Contractor
from bimstitch_api.models.finding import Finding
from bimstitch_api.models.org_template import OrgTemplate
from bimstitch_api.models.project import Project
from bimstitch_api.models.project_file import ProjectFile
from bimstitch_api.models.report import ReportType
from bimstitch_api.models.risk import Risk
from bimstitch_api.models.user import User
from bimstitch_api.storage import get_attachments_bucket


def _report_title(report_type: ReportType, project_name: str, locale: str) -> str:
    return t(
        f"notifications.report.{report_type.value}.title",
        coerce_locale(locale),
        name=project_name,
    )


def _report_notification_body(report_type: ReportType, locale: str) -> str:
    # The notification body templates don't take {name}; passing a stray
    # `name` through `t()` is harmless because we omit vars when none are
    # needed (see `t()`'s no-vars branch).
    return t(
        f"notifications.report.{report_type.value}.body",
        coerce_locale(locale),
    )


def _project_payload(project: Project, contractor: Contractor | None) -> dict[str, object]:
    """Snapshot of project metadata the worker uses to render the PDF cover.
    Worker is stateless — everything it renders comes from this payload."""
    return {
        "id": str(project.id),
        "name": project.name,
        "country": project.country,
        "reference_code": project.reference_code,
        "status": project.status.value,
        "phase": project.phase.value if project.phase is not None else None,
        "address": {
            "country": project.country,
            "street": project.street,
            "house_number": project.house_number,
            "postal_code": project.postal_code,
            "city": project.city,
            "municipality": project.municipality,
            "bag_id": project.bag_id,
        },
        "permit_number": project.permit_number,
        "delivery_date": project.delivery_date.isoformat() if project.delivery_date else None,
        "contractor": (
            {
                "name": contractor.name,
                "kvk_number": contractor.kvk_number,
                "contact_email": contractor.contact_email,
                "contact_phone": contractor.contact_phone,
            }
            if contractor is not None
            else None
        ),
    }


def _template_payload(tpl: OrgTemplate) -> dict[str, object]:
    """The template config shipped to the worker. Branding asset keys travel with
    their bucket (the worker fetches logo/cover from MinIO by key); sections and
    text blocks travel inline and are applied/interpolated at render time."""
    config = tpl.config or {}
    branding = dict(config.get("branding") or {})
    branding["bucket"] = get_attachments_bucket()
    return {
        "id": str(tpl.id),
        "branding": branding,
        "sections": config.get("sections") or [],
        "options": config.get("options") or {},
    }


# Construction-phase ordering for borgingsmomenten on the rendered plan.
_PHASE_RANK: dict[str, int] = {
    "foundation": 0,
    "shell": 1,
    "roof": 2,
    "finishing": 3,
    "handover": 4,
    "other": 5,
}


def _instrument_payload(project: Project) -> dict[str, object] | None:
    """The project's toegelaten instrument resolved from the jurisdiction
    registry — name/provider/methodology for the report cover. None if the
    project hasn't picked one yet (aannemer-first: 'KB will select')."""
    if project.instrument_id is None:
        return None
    inst = find_instrument(project.country, project.instrument_id)
    if inst is None:
        return None
    return {
        "id": inst.id,
        "name": inst.name,
        "provider": inst.provider,
        "methodology_url": inst.methodology_url,
    }


def _user_display_name(u: User | None) -> str | None:
    """Display name (full_name, else email) for an eager-loaded User, or None."""
    if u is None:
        return None
    return u.full_name or u.email


def _assurance_plan_payload(plan: Borgingsplan) -> dict[str, object]:
    """Snapshot the borgingsplan + its moments/checklist items for rendering.
    moments + checklist_items are selectin-loaded with the plan; `created_by`
    and each moment's `responsible` are eager-loaded by the resolver."""
    moments = sorted(
        plan.moments,
        key=lambda m: (_PHASE_RANK.get(m.phase.value, 99), m.sequence_in_phase),
    )
    return {
        "version_number": plan.version_number,
        "status": plan.status.value,
        "created_by": _user_display_name(plan.created_by),
        "published_at": plan.published_at.isoformat() if plan.published_at else None,
        "notes": plan.notes,
        "moments": [
            {
                "phase": m.phase.value,
                "name": m.name,
                "planned_date": m.planned_date.isoformat(),
                "actual_date": m.actual_date.isoformat() if m.actual_date else None,
                "responsible": _user_display_name(m.responsible),
                "status": m.status.value,
                "checklist_items": [
                    {
                        "description": ci.description,
                        "evidence_type": ci.evidence_type.value,
                        "bbl_article_ref": ci.bbl_article_ref,
                        "pass_fail_criteria": ci.pass_fail_criteria,
                    }
                    for ci in sorted(m.checklist_items, key=lambda c: c.sequence)
                ],
            }
            for m in moments
        ],
    }


def _risk_payload(risk: Risk) -> dict[str, object]:
    return {
        "category": risk.category.value,
        "level": risk.level.value,
        "description": risk.description,
        "mitigation": risk.mitigation,
        "responsible_party": risk.responsible_party,
        "bbl_article_ref": risk.bbl_article_ref,
    }


def _declaration_payload(
    user: User,
    *,
    signed: bool,
    signed_at: str | None,
    signature_hash: str | None,
) -> dict[str, object]:
    """The verklaring's declarant + signing state. Unsigned at generate time;
    the sign endpoint re-renders with signed=True + the stamp fields."""
    return {
        "kwaliteitsborger": _user_display_name(user),
        "kwaliteitsborger_email": user.email,
        "signed": signed,
        "signed_at": signed_at,
        "signature_hash": signature_hash,
    }


def _dossier_finding_payload(
    finding: Finding, atts: dict[str, ProjectFile]
) -> dict[str, object]:
    """A finding + its resolution + image-attachment storage keys (the worker
    embeds those photos). Only image attachments are embedded."""
    photos: list[dict[str, str]] = []
    seen: set[str] = set()
    for aid in list(finding.photo_ids or []) + list(finding.resolution_evidence_ids or []):
        key = str(aid)
        if key in seen:
            continue
        seen.add(key)
        att = atts.get(key)
        if att is None or not att.content_type.startswith("image/"):
            continue
        photos.append({"storage_key": att.storage_key, "content_type": att.content_type})
    return {
        "title": finding.title,
        "description": finding.description,
        "severity": finding.severity.value,
        "status": finding.status.value,
        "deadline_date": finding.deadline_date.isoformat() if finding.deadline_date else None,
        "bbl_article_ref": finding.bbl_article_ref,
        "resolution_note": finding.resolution_note,
        # Anchored BIM element identity + location (the "snap" GUID/location the
        # dossier surfaces per finding). Coordinates are the only location stored
        # on a finding — there is no human-readable storey name.
        "linked_element_global_id": finding.linked_element_global_id,
        "linked_model_id": str(finding.linked_model_id)
        if finding.linked_model_id is not None
        else None,
        "linked_file_type": finding.linked_file_type,
        "anchor_page": finding.anchor_page,
        "anchor_x": finding.anchor_x,
        "anchor_y": finding.anchor_y,
        "anchor_z": finding.anchor_z,
        "photos": photos,
    }


def _dossier_certificate_payload(cert: Certificate) -> dict[str, object]:
    """A certificate's metadata + storage key (the worker merges PDF certs)."""
    return {
        "certificate_type": cert.certificate_type.value,
        "certificate_number": cert.certificate_number,
        "issuer": cert.issuer,
        "subject": cert.subject,
        "valid_from": cert.valid_from.isoformat() if cert.valid_from else None,
        "valid_until": cert.valid_until.isoformat() if cert.valid_until else None,
        "filename": cert.original_filename,
        "content_type": cert.content_type,
        "storage_key": cert.storage_key,
    }
