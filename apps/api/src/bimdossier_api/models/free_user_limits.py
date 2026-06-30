"""Per-user free-tier limit overrides — `public.free_user_limits`.

The free tier's quotas (projects / members / containers / storage) and its trial
window all default from env (`config.Settings.free_*`). This table lets a
super-admin lift (or tighten) those for a SINGLE account without a redeploy, and
exempt an account from the trial entirely (a permanent free account).

Each numeric column is NULLABLE: NULL means "fall back to the global env default"
(see `free_limits.resolve_free_limits`). A row only exists once an admin has
touched at least one knob for that user; absence of a row = pure defaults.

Unlike the other `free_*` tables this is CONTROL-PLANE data: only super-admin
(RLS-bypassing) sessions read or write it — the pooled `bim_app` free session
never touches it (the resolver runs on its own superuser probe, mirroring
`free_access.user_has_org_membership`). So it carries NO RLS policy and NO grant
to `bim_app`; a plain `public` table that only the superuser can see is exactly
the isolation we want.
"""

from datetime import datetime
from uuid import UUID

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Integer, func
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from bimdossier_api.db import MasterBase


class FreeUserLimits(MasterBase):
    __tablename__ = "free_user_limits"

    # One row per user (PK == FK). CASCADE so an anonymized/deleted user takes
    # its override row with it.
    user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.users.id", ondelete="CASCADE"),
        primary_key=True,
    )

    # Per-user overrides for the env defaults. NULL => use the global default.
    max_projects: Mapped[int | None] = mapped_column(Integer, nullable=True)
    max_members_per_project: Mapped[int | None] = mapped_column(Integer, nullable=True)
    max_documents: Mapped[int | None] = mapped_column(Integer, nullable=True)
    storage_max_bytes: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    account_max_age_days: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Permanent free account: ignore the trial window entirely (never expires),
    # regardless of `account_max_age_days`. Distinct from a very large day count
    # so the admin UI can show an explicit "exempt" toggle.
    expiry_exempt: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )

    # Audit: when and by whom the override was last changed.
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
    updated_by_user_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.users.id", ondelete="SET NULL"),
        nullable=True,
    )

    __table_args__ = ({"schema": "public"},)
