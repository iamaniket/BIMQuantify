from __future__ import annotations

from datetime import date
from typing import TYPE_CHECKING
from uuid import UUID, uuid4

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Date,
    ForeignKey,
    Index,
    String,
    Text,
)
from sqlalchemy import (
    Enum as SAEnum,
)
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from bimdossier_api.db import TenantBase
from bimdossier_api.models._mixins import SoftDeleteMixin, TimestampMixin
from bimdossier_api.models.certificate import (
    CERTIFICATE_ALLOWED_EXTENSIONS,
    CertificateStatus,
    CertificateType,
)

if TYPE_CHECKING:
    from bimdossier_api.models.org_certificate_tag import OrgCertificateTag
    from bimdossier_api.models.user import User

ORG_CERTIFICATE_ALLOWED_EXTENSIONS = CERTIFICATE_ALLOWED_EXTENSIONS


class OrgCertificate(TimestampMixin, SoftDeleteMixin, TenantBase):
    __tablename__ = "org_certificates"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    uploaded_by_user_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.users.id", ondelete="RESTRICT"),
        nullable=True,
    )

    storage_key: Mapped[str] = mapped_column(String(512), unique=True, nullable=False)
    original_filename: Mapped[str] = mapped_column(String(512), nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    content_type: Mapped[str] = mapped_column(String(255), nullable=False)
    content_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)

    certificate_type: Mapped[CertificateType] = mapped_column(
        SAEnum(
            CertificateType,
            name="certificatetype",
            values_callable=lambda enum: [m.value for m in enum],
            create_type=False,
        ),
        nullable=False,
    )
    status: Mapped[CertificateStatus] = mapped_column(
        SAEnum(
            CertificateStatus,
            name="certificatestatus",
            values_callable=lambda enum: [m.value for m in enum],
            create_type=False,
        ),
        nullable=False,
        default=CertificateStatus.pending,
    )
    rejection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    certificate_number: Mapped[str | None] = mapped_column(String(255), nullable=True)
    issuer: Mapped[str | None] = mapped_column(String(255), nullable=True)
    subject: Mapped[str | None] = mapped_column(Text, nullable=True)
    valid_from: Mapped[date | None] = mapped_column(Date, nullable=True)
    valid_until: Mapped[date | None] = mapped_column(Date, nullable=True)

    product_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    supplier_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    replaced_by_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("org_certificates.id", ondelete="SET NULL"),
        nullable=True,
    )

    uploaded_by_user: Mapped[User | None] = relationship(
        foreign_keys=[uploaded_by_user_id], lazy="raise"
    )
    replaced_by: Mapped[OrgCertificate | None] = relationship(
        foreign_keys=[replaced_by_id], lazy="raise", remote_side=[id]
    )
    # Tags — normalize the former `tags` JSONB array into rows. Eager-loaded so
    # the read-only `tags` property is always populated when serialized.
    tag_rows: Mapped[list[OrgCertificateTag]] = relationship(
        back_populates="org_certificate",
        cascade="all, delete-orphan",
        order_by="OrgCertificateTag.position",
        lazy="selectin",
    )

    @property
    def uploaded_by_name(self) -> str | None:
        if self.uploaded_by_user is None:
            return None
        return self.uploaded_by_user.full_name

    @property
    def tags(self) -> list[str]:
        return [row.name for row in self.tag_rows]

    __table_args__ = (
        CheckConstraint("size_bytes >= 0", name="ck_org_certificates_size_non_negative"),
        Index("ix_org_certificates_uploaded_by", "uploaded_by_user_id"),
        Index("ix_org_certificates_type", "certificate_type"),
        Index(
            "ix_org_certificates_valid_until",
            "valid_until",
            postgresql_where="valid_until IS NOT NULL AND deleted_at IS NULL",
        ),
        Index(
            "ix_org_certificates_active",
            "created_at",
            postgresql_where="deleted_at IS NULL",
        ),
    )
