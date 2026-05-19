from enum import StrEnum
from typing import TYPE_CHECKING
from uuid import UUID, uuid4

from sqlalchemy import Enum as SAEnum
from sqlalchemy import ForeignKey, Index, String, Text
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from bimstitch_api.db import TenantBase
from bimstitch_api.models._mixins import TimestampMixin

if TYPE_CHECKING:
    from bimstitch_api.models.project import Project


class RiskCategory(StrEnum):
    # Neutral Bbl risk-assessment categories. Country-specific labels (NL:
    # "Constructieve veiligheid", "Brandveiligheid", …) live in the
    # jurisdiction registry. Other building-code regimes register their own
    # category labels under sibling jurisdictions (DE LBO etc.).
    structural_safety = "structural_safety"
    fire_safety = "fire_safety"
    health = "health"
    energy_efficiency = "energy_efficiency"
    usability = "usability"


class RiskLevel(StrEnum):
    # Neutral severity codes. Dutch labels (laag/midden/hoog) live in the
    # portal i18n catalog — these are project-static UI strings, not
    # jurisdiction data.
    low = "low"
    medium = "medium"
    high = "high"


class Risk(TimestampMixin, TenantBase):
    __tablename__ = "risks"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    project_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
    )
    category: Mapped[RiskCategory] = mapped_column(
        SAEnum(
            RiskCategory,
            name="riskcategory",
            values_callable=lambda enum: [m.value for m in enum],
        ),
        nullable=False,
    )
    level: Mapped[RiskLevel] = mapped_column(
        SAEnum(
            RiskLevel,
            name="risklevel",
            values_callable=lambda enum: [m.value for m in enum],
        ),
        nullable=False,
    )
    description: Mapped[str] = mapped_column(Text, nullable=False)
    mitigation: Mapped[str] = mapped_column(Text, nullable=False)
    responsible_party: Mapped[str | None] = mapped_column(String(255), nullable=True)
    bbl_article_ref: Mapped[str | None] = mapped_column(String(50), nullable=True)

    project: Mapped["Project"] = relationship()

    __table_args__ = (
        Index("ix_risks_project_id", "project_id"),
        Index(
            "ix_risks_project_category_level",
            "project_id",
            "category",
            "level",
        ),
    )
