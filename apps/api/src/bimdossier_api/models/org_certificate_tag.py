from __future__ import annotations

from typing import TYPE_CHECKING
from uuid import UUID, uuid4

from sqlalchemy import ForeignKey, Index, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from bimdossier_api.db import TenantBase
from bimdossier_api.models._mixins import TimestampMixin

if TYPE_CHECKING:
    from bimdossier_api.models.org_certificate import OrgCertificate


class OrgCertificateTag(TimestampMixin, TenantBase):
    """One tag on an org certificate, normalizing the former ``tags`` JSONB array.

    A per-entity tag row (the tag name is stored directly) so the library can be
    filtered by tag (``EXISTS``) and offer autocomplete (``SELECT DISTINCT name``).
    ``position`` preserves the order the tags were entered.
    """

    __tablename__ = "org_certificate_tags"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    org_certificate_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("org_certificates.id", ondelete="CASCADE"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    org_certificate: Mapped[OrgCertificate] = relationship(back_populates="tag_rows")

    __table_args__ = (
        UniqueConstraint("org_certificate_id", "name", name="uq_org_certificate_tag"),
        Index("ix_org_certificate_tags_cert", "org_certificate_id"),
        # Drives tag autocomplete (prefix match) and tag filtering.
        Index("ix_org_certificate_tags_name", "name"),
    )
