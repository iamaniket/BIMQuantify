from datetime import date
from enum import StrEnum
from typing import TYPE_CHECKING, Any
from uuid import UUID, uuid4

from sqlalchemy import Date, ForeignKey, Index, String, Text
from sqlalchemy import Enum as SAEnum
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from bimstitch_api.db import TenantBase
from bimstitch_api.models._mixins import SoftDeleteMixin, TimestampMixin
from bimstitch_api.models.user import User

if TYPE_CHECKING:
    from bimstitch_api.models.project import Project


class FindingSeverity(StrEnum):
    # Neutral severity codes. Dutch labels (laag/midden/hoog) live in the
    # portal i18n catalog — these are project-static UI strings, not
    # jurisdiction data. Dedicated to findings (not shared with RiskLevel)
    # so the two domains can diverge without coupling.
    low = "low"
    medium = "medium"
    high = "high"


class FindingStatus(StrEnum):
    # Language-neutral lifecycle codes (cf. ProjectStatus). Dutch display
    # labels live in the portal i18n catalog:
    #   open -> "open", in_progress -> "in behandeling",
    #   resolved -> "opgelost", verified -> "geverifieerd".
    # The full set is declared now so the #26 status state-machine needs no
    # migration; #25 only ever writes `draft` and `open`.
    draft = "draft"
    open = "open"
    in_progress = "in_progress"
    resolved = "resolved"
    verified = "verified"


class Finding(TimestampMixin, SoftDeleteMixin, TenantBase):
    """A bevinding — a human inspection finding/defect.

    First-class object (not a sub-record of an inspection): one defect is
    tracked across multiple borgingsmomenten / phases. Manual findings leave
    `source_checklist_item_id` null; the future auto-draft hook (#22, KB mode)
    sets it to dedupe one draft per failed checklist item.
    """

    __tablename__ = "findings"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    project_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    severity: Mapped[FindingSeverity] = mapped_column(
        SAEnum(
            FindingSeverity,
            name="findingseverity",
            values_callable=lambda enum: [m.value for m in enum],
        ),
        nullable=False,
        default=FindingSeverity.medium,
    )
    status: Mapped[FindingStatus] = mapped_column(
        SAEnum(
            FindingStatus,
            name="findingstatus",
            values_callable=lambda enum: [m.value for m in enum],
        ),
        nullable=False,
        default=FindingStatus.draft,
    )
    assignee_user_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.users.id", ondelete="RESTRICT"),
        nullable=True,
    )
    deadline_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    bbl_article_ref: Mapped[str | None] = mapped_column(String(50), nullable=True)
    created_by_user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.users.id", ondelete="RESTRICT"),
        nullable=False,
    )
    source_checklist_item_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("checklist_items.id", ondelete="SET NULL"),
        nullable=True,
    )
    borgingsmoment_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("borgingsmomenten.id", ondelete="SET NULL"),
        nullable=True,
    )
    # Version-independent element identity (#N9): findings attach to an IFC
    # element by (model, GlobalId), not to one file version. `linked_file_id`
    # below stays as provenance — "first raised on this version" — while
    # `linked_model_id` is what the element panels query so a finding follows
    # the element across re-uploaded versions. Mirrors Attachment/Certificate.
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
    linked_element_global_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    photo_ids: Mapped[list[Any] | None] = mapped_column(JSONB, nullable=True)
    # Resolution evidence (#26/#27): a transition into `resolved` requires both
    # a written note and >=1 attachment id. `resolution_evidence_ids` mirrors
    # `photo_ids` — a JSONB string list, kept JSON-serializable.
    resolution_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    resolution_evidence_ids: Mapped[list[Any] | None] = mapped_column(JSONB, nullable=True)

    project: Mapped["Project"] = relationship()
    assignee: Mapped[User | None] = relationship(User, foreign_keys=[assignee_user_id])
    created_by: Mapped[User] = relationship(User, foreign_keys=[created_by_user_id])

    __table_args__ = (
        Index("ix_findings_project_id", "project_id"),
        Index("ix_findings_project_status", "project_id", "status"),
        # Drives the version-independent element lookup
        # (?linked_model_id=&linked_element_global_id=). Partial so only
        # element-linked findings are indexed. Mirrors ix_attachments_linked_element.
        Index(
            "ix_findings_linked_element",
            "linked_model_id",
            "linked_element_global_id",
            postgresql_where="linked_model_id IS NOT NULL AND linked_element_global_id IS NOT NULL",
        ),
    )
