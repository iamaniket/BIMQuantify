from __future__ import annotations

from datetime import date
from enum import StrEnum
from typing import TYPE_CHECKING
from uuid import UUID, uuid4

from sqlalchemy import (
    CheckConstraint,
    Date,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    text,
)
from sqlalchemy import (
    Enum as SAEnum,
)
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from bimstitch_api.db import TenantBase
from bimstitch_api.models._mixins import FileBackedMixin, SoftDeleteMixin, TimestampMixin

if TYPE_CHECKING:
    from bimstitch_api.models.model import Model
    from bimstitch_api.models.org_certificate import OrgCertificate
    from bimstitch_api.models.project import Project
    from bimstitch_api.models.project_file import ProjectFile
    from bimstitch_api.models.user import User


class CertificateType(StrEnum):
    """Proof-of-conformity classes the Wkb dossier draws on.

    Neutral codes; Dutch labels (productcertificaat, keuringsrapport, …) live
    in the portal i18n catalog, same rule as ``AttachmentCategory``.
    """

    product = "product"
    installation_test = "installation_test"
    inspection = "inspection"
    warranty = "warranty"
    other = "other"


class CertificateStatus(StrEnum):
    pending = "pending"
    ready = "ready"
    rejected = "rejected"


CERTIFICATE_ALLOWED_EXTENSIONS: frozenset[str] = frozenset(
    {".pdf", ".jpg", ".jpeg", ".png", ".docx", ".xlsx"}
)


class Certificate(TimestampMixin, SoftDeleteMixin, FileBackedMixin, TenantBase):
    __tablename__ = "certificates"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    project_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
    )
    uploaded_by_user_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.users.id", ondelete="RESTRICT"),
        nullable=True,
    )

    # storage_key / original_filename / size_bytes / content_type /
    # content_sha256 come from FileBackedMixin.

    certificate_type: Mapped[CertificateType] = mapped_column(
        SAEnum(
            CertificateType,
            name="certificatetype",
            values_callable=lambda enum: [m.value for m in enum],
        ),
        nullable=False,
    )
    status: Mapped[CertificateStatus] = mapped_column(
        SAEnum(
            CertificateStatus,
            name="certificatestatus",
            values_callable=lambda enum: [m.value for m in enum],
        ),
        nullable=False,
        default=CertificateStatus.pending,
    )
    rejection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Structured conformity metadata — what makes a certificate filterable and
    # expiry-aware rather than a generic blob.
    certificate_number: Mapped[str | None] = mapped_column(String(255), nullable=True)
    issuer: Mapped[str | None] = mapped_column(String(255), nullable=True)
    subject: Mapped[str | None] = mapped_column(Text, nullable=True)
    valid_from: Mapped[date | None] = mapped_column(Date, nullable=True)
    valid_until: Mapped[date | None] = mapped_column(Date, nullable=True)

    linked_element_global_id: Mapped[str | None] = mapped_column(String(22), nullable=True)
    linked_model_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("models.id", ondelete="SET NULL"),
        nullable=True,
    )
    linked_file_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("project_files.id", ondelete="SET NULL"),
        nullable=True,
    )
    org_certificate_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("org_certificates.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Immutable versioning (#35), mirroring Attachment. A logical certificate is
    # a group of rows sharing a root: the first upload is the root
    # (parent_certificate_id IS NULL); every superseding version points its
    # parent at the root, and version_number orders them. The head is the
    # highest non-deleted version_number in the group.
    version_number: Mapped[int] = mapped_column(
        Integer, default=1, server_default="1", nullable=False
    )
    parent_certificate_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("certificates.id", ondelete="SET NULL"),
        nullable=True,
    )

    project: Mapped[Project] = relationship(foreign_keys=[project_id], lazy="raise")
    uploaded_by_user: Mapped[User | None] = relationship(
        foreign_keys=[uploaded_by_user_id], lazy="raise"
    )
    linked_model: Mapped[Model | None] = relationship(foreign_keys=[linked_model_id], lazy="raise")
    linked_file: Mapped[ProjectFile | None] = relationship(
        foreign_keys=[linked_file_id], lazy="raise"
    )
    org_certificate: Mapped[OrgCertificate | None] = relationship(
        foreign_keys=[org_certificate_id], lazy="raise"
    )
    parent_certificate: Mapped[Certificate | None] = relationship(
        foreign_keys=[parent_certificate_id], remote_side=[id], lazy="raise"
    )

    @property
    def uploaded_by_name(self) -> str | None:
        if self.uploaded_by_user is None:
            return None
        return self.uploaded_by_user.full_name

    __table_args__ = (
        CheckConstraint("size_bytes >= 0", name="ck_certificates_size_non_negative"),
        Index("ix_certificates_project_id", "project_id"),
        Index("ix_certificates_project_type", "project_id", "certificate_type"),
        Index("ix_certificates_uploaded_by", "uploaded_by_user_id"),
        # Drives the expiry filter (?expiring_before / ?expired) and the
        # future cross-project obligations view.
        Index(
            "ix_certificates_valid_until",
            "valid_until",
            postgresql_where="valid_until IS NOT NULL AND deleted_at IS NULL",
        ),
        Index(
            "ix_certificates_active",
            "project_id",
            "created_at",
            postgresql_where="deleted_at IS NULL",
        ),
        Index(
            "ix_certificates_linked_element",
            "linked_model_id",
            "linked_element_global_id",
            postgresql_where="linked_model_id IS NOT NULL AND linked_element_global_id IS NOT NULL",
        ),
        Index(
            "ix_certificates_org_certificate_id",
            "org_certificate_id",
            postgresql_where="org_certificate_id IS NOT NULL",
        ),
        # Version group = coalesce(parent_certificate_id, id). Same shape as
        # attachments: unique (group, version_number) + a partial parent index.
        Index(
            "ux_certificates_version_group",
            text("coalesce(parent_certificate_id, id), version_number"),
            unique=True,
        ),
        Index(
            "ix_certificates_parent",
            "parent_certificate_id",
            postgresql_where="parent_certificate_id IS NOT NULL",
        ),
    )
