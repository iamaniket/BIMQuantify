"""Pydantic-level tests for the M-input field-size caps.

These assert the schema guards directly (no DB / HTTP) — the global body-size
middleware (B3) is too coarse (100 MB) to bound a single ballooning JSONB column
or a list field that fans out to one row per item (BCF labels).
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from bimdossier_api.schemas.attachment import (
    AttachmentUpdateRequest,
    CaptureMetadataInput,
    ExifData,
)
from bimdossier_api.schemas.bcf import (
    BcfComponentsSchema,
    BcfTopicCreate,
    BcfViewpointCreate,
)
from bimdossier_api.schemas.project import ProjectCreate, ProjectUpdate

_VIEWPOINT_BASE = {
    "guid": "g",
    "camera_type": "perspective",
    "camera_view_point": {},
    "camera_direction": {},
    "camera_up_vector": {},
}


# --- Project.description -----------------------------------------------------


def test_project_description_at_cap_ok() -> None:
    ProjectCreate(name="P", description="a" * 4000)


def test_project_create_description_over_cap_rejected() -> None:
    with pytest.raises(ValidationError):
        ProjectCreate(name="P", description="a" * 4001)


def test_project_update_description_over_cap_rejected() -> None:
    with pytest.raises(ValidationError):
        ProjectUpdate(description="a" * 4001)


# --- BCF labels (each label fans out to one BcfTopicLabel row) ---------------


def test_bcf_labels_at_cap_ok() -> None:
    BcfTopicCreate(title="T", labels=["x"] * 50)


def test_bcf_labels_over_count_cap_rejected() -> None:
    with pytest.raises(ValidationError):
        BcfTopicCreate(title="T", labels=["x"] * 51)


def test_bcf_label_over_length_cap_rejected() -> None:
    with pytest.raises(ValidationError):
        BcfTopicCreate(title="T", labels=["a" * 65])


# --- BCF viewpoint element-id / geometry lists -------------------------------


def test_bcf_selection_over_count_cap_rejected() -> None:
    with pytest.raises(ValidationError):
        BcfComponentsSchema(selection=["x"] * 50_001)


def test_bcf_element_id_over_length_cap_rejected() -> None:
    with pytest.raises(ValidationError):
        BcfComponentsSchema(visibility_exceptions=["a" * 65])


def test_bcf_measurements_over_count_cap_rejected() -> None:
    with pytest.raises(ValidationError):
        BcfViewpointCreate(**_VIEWPOINT_BASE, measurements=[{"type": "distance"}] * 1_001)


def test_bcf_clipping_planes_over_count_cap_rejected() -> None:
    with pytest.raises(ValidationError):
        BcfViewpointCreate(
            **_VIEWPOINT_BASE,
            clipping_planes=[{"location": {}, "direction": {}}] * 101,
        )


def test_bcf_normal_viewpoint_ok() -> None:
    BcfViewpointCreate(
        **_VIEWPOINT_BASE,
        components={"selection": ["1A", "2B"], "visibility_exceptions": []},
        measurements=[{"type": "distance", "points": [{}, {}]}],
    )


# --- Free-form JSONB dicts (serialized-byte caps) ----------------------------


def test_attachment_annotation_state_at_reasonable_size_ok() -> None:
    AttachmentUpdateRequest(annotation_state={"shapes": ["x"] * 100})


def test_attachment_annotation_state_over_byte_cap_rejected() -> None:
    with pytest.raises(ValidationError):
        AttachmentUpdateRequest(annotation_state={"blob": "x" * (1024 * 1024)})


def test_capture_device_small_ok() -> None:
    CaptureMetadataInput(device={"ua": "Mozilla/5.0", "platform": "iOS"})


def test_capture_device_over_byte_cap_rejected() -> None:
    with pytest.raises(ValidationError):
        CaptureMetadataInput(device={"blob": "x" * (16 * 1024)})


def test_exif_string_field_over_length_cap_rejected() -> None:
    with pytest.raises(ValidationError):
        ExifData(make="a" * 256)


# --- Report.params / template config / checklist extra_data (JSONB byte caps) --


def test_report_params_small_ok() -> None:
    from bimdossier_api.schemas.report import ReportCreateRequest

    ReportCreateRequest(params={"file_ids": ["a", "b"]})


def test_report_params_over_byte_cap_rejected() -> None:
    from bimdossier_api.schemas.report import ReportCreateRequest

    with pytest.raises(ValidationError):
        ReportCreateRequest(params={"blob": "x" * (16 * 1024 + 1)})


def test_checklist_extra_data_over_byte_cap_rejected() -> None:
    from bimdossier_api.schemas.borgingsplan import ChecklistItemUpdate

    with pytest.raises(ValidationError):
        ChecklistItemUpdate(extra_data={"blob": "x" * (64 * 1024 + 1)})


def test_org_template_config_over_byte_cap_rejected() -> None:
    from bimdossier_api.schemas.org_template import OrgTemplateUpdate

    with pytest.raises(ValidationError):
        OrgTemplateUpdate(config={"blob": "x" * (256 * 1024 + 1)})


# --- Org-certificate tags (each fans out to one OrgCertificateTag row) --------


def test_org_certificate_tags_at_cap_ok() -> None:
    from bimdossier_api.schemas.org_certificate import OrgCertificateUpdateRequest

    OrgCertificateUpdateRequest(tags=["x"] * 50)


def test_org_certificate_tags_over_count_cap_rejected() -> None:
    from bimdossier_api.schemas.org_certificate import OrgCertificateUpdateRequest

    with pytest.raises(ValidationError):
        OrgCertificateUpdateRequest(tags=["x"] * 51)


def test_org_certificate_tag_over_length_cap_rejected() -> None:
    from bimdossier_api.schemas.org_certificate import OrgCertificateUpdateRequest

    with pytest.raises(ValidationError):
        OrgCertificateUpdateRequest(tags=["a" * 65])


# --- Finding attachment-id lists (each id fans out to one link row) -----------


def test_finding_photo_ids_over_count_cap_rejected() -> None:
    from bimdossier_api.schemas.finding import FindingUpdate

    with pytest.raises(ValidationError):
        FindingUpdate(photo_ids=["a"] * 201)


def test_finding_photo_id_over_length_cap_rejected() -> None:
    from bimdossier_api.schemas.finding import FindingUpdate

    with pytest.raises(ValidationError):
        FindingUpdate(photo_ids=["a" * 65])
