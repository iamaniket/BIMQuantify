"""Reconciliation backstop for stuck free-tier extractions.

`JobReconcileSweeper` walks per-org tenant schemas and only sees tenant `Job`
rows — free extractions have no `Job` row and live in `public.pooled_project_files`,
so they need their own sweep. If the worker dies between the `running` and
terminal free callback (or the terminal POST is lost), a free file sits in
`queued`/`running` forever and the free viewer spins.

This sweep force-fails any free file stuck in a non-terminal extraction state
whose `updated_at` (the timestamp of its last state change — set when it flips
to `queued`/`running`) is older than the stuck-job timeout. Idempotent: the
query only matches non-terminal rows. Runs as the superuser (RLS-bypassing,
cross-user) — the deliberate pattern for a background job with no request-scoped
user context, mirroring `jobs/reconcile.py`.

The idle reaper keys on the CONTAINER (`pooled_documents.last_viewed_at`, stamped
by the viewer-bundle GET): an untouched container past the TTL is deleted (its
files + snags cascade) along with its object prefix.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Any

from sqlalchemy import and_, or_, select
from sqlalchemy import delete as sql_delete
from sqlalchemy import update as sql_update

from bimdossier_api.background.periodic import PeriodicSweeper
from bimdossier_api.db import get_session_maker
from bimdossier_api.models.pooled_document import PooledDocument
from bimdossier_api.models.pooled_project_file import PooledProjectFile
from bimdossier_api.storage import get_storage

if TYPE_CHECKING:
    from sqlalchemy import ColumnElement
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    from bimdossier_api.storage import StorageBackend

logger = logging.getLogger(__name__)

_STUCK_STATES = ("queued", "running")
_REASON = (
    "Force-failed by the free-tier reconciliation sweep: extraction exceeded the "
    "stuck-job timeout without a terminal callback (the worker likely crashed or "
    "its callback never arrived)."
)


async def sweep_stuck_pooled_extractions(stuck_timeout_minutes: int) -> int:
    """Force-fail abandoned free extractions. Returns the number flipped."""
    session_maker = get_session_maker()
    now = datetime.now(UTC)
    cutoff = now - timedelta(minutes=stuck_timeout_minutes)

    async with session_maker() as session, session.begin():
        # FOR UPDATE SKIP LOCKED: the live free callback locks the row with
        # `with_for_update` and re-checks terminal state, so skip any row a
        # callback is actively finishing rather than clobber it (same M-con1
        # rationale as jobs/reconcile.py).
        stuck = list(
            (
                await session.execute(
                    select(PooledProjectFile)
                    .where(
                        PooledProjectFile.extraction_status.in_(_STUCK_STATES),
                        PooledProjectFile.updated_at < cutoff,
                    )
                    .with_for_update(skip_locked=True)
                )
            )
            .scalars()
            .all()
        )
        for row in stuck:
            row.extraction_status = "failed"
            row.extraction_error = _REASON

    if stuck:
        logger.info("pooled_reconcile: force-failed %d stuck free extractions", len(stuck))
    return len(stuck)


async def sweep_stuck_pooled_reports(stuck_timeout_minutes: int) -> int:
    """Force-fail abandoned free snag-list report renders. The pooled report
    callback is the only happy path to a terminal state — a worker crash (or a
    lost terminal POST) leaves the row queued/running forever and the portal
    polls indefinitely. Twin of ``sweep_stuck_pooled_extractions``; keyed on
    ``updated_at`` (bumped on the running callback). Returns the number flipped."""
    from bimdossier_api.models.pooled_report import PooledReport

    session_maker = get_session_maker()
    cutoff = datetime.now(UTC) - timedelta(minutes=stuck_timeout_minutes)

    async with session_maker() as session, session.begin():
        stuck = list(
            (
                await session.execute(
                    select(PooledReport)
                    .where(
                        PooledReport.status.in_(_STUCK_STATES),
                        PooledReport.updated_at < cutoff,
                    )
                    .with_for_update(skip_locked=True)
                )
            )
            .scalars()
            .all()
        )
        for row in stuck:
            row.status = "failed"
            row.error = _REASON
            row.finished_at = datetime.now(UTC)

    if stuck:
        logger.info("pooled_reconcile: force-failed %d stuck free reports", len(stuck))
    return len(stuck)


class PooledExtractionReconcileSweeper(PeriodicSweeper):
    """Runs ``sweep_stuck_pooled_extractions`` + ``sweep_stuck_pooled_reports`` on
    an interval. Leader-elected via advisory lock (only one instance runs each
    cycle). ``interval_minutes=0`` disables it."""

    def __init__(self, interval_minutes: int, stuck_timeout_minutes: int) -> None:
        super().__init__(
            name="pooled_extraction_reconcile_sweeper",
            interval_seconds=interval_minutes * 60,
            lock_key="sweep:pooled_reconcile",
        )
        self.stuck_timeout_minutes = stuck_timeout_minutes

    async def run_once(self) -> None:
        await sweep_stuck_pooled_extractions(self.stuck_timeout_minutes)
        await sweep_stuck_pooled_reports(self.stuck_timeout_minutes)


def _idle_before(cutoff: datetime) -> ColumnElement[bool]:
    """Container idleness predicate: last viewed (or created, if never viewed)
    before ``cutoff``."""
    return or_(
        PooledDocument.last_viewed_at < cutoff,
        and_(
            PooledDocument.last_viewed_at.is_(None),
            PooledDocument.created_at < cutoff,
        ),
    )


async def _warn_idle_pooled_containers(
    session_maker: async_sessionmaker[AsyncSession],
    now: datetime,
    ttl_days: int,
    warning_days: int,
) -> int:
    """One-time deletion-warning pass: email each owner about containers idle past
    ``warning_days`` but not yet past ``ttl_days`` (those go straight to the delete
    pass — don't warn the doomed). Stamps ``idle_warning_sent_at`` ONLY on a
    successful send, so a failed email retries next cycle. Returns owners warned."""
    from bimdossier_api.email.pooled_idle import send_idle_containers_warning_email
    from bimdossier_api.i18n import coerce_locale
    from bimdossier_api.models.user import User

    warn_cutoff = now - timedelta(days=warning_days)
    ttl_cutoff = now - timedelta(days=ttl_days)

    async with session_maker() as session:
        rows = (
            await session.execute(
                # fastapi-users declares User.email as a plain attribute, so the
                # typed select() overloads can't match — same untyped-select
                # pattern as pooled_projects._resolve_pooled_user_names.
                select(  # type: ignore[call-overload]
                    PooledDocument.id,
                    PooledDocument.name,
                    User.email,
                    User.full_name,
                    User.locale,
                )
                .join(User, User.id == PooledDocument.owner_user_id)
                .where(
                    _idle_before(warn_cutoff),
                    ~_idle_before(ttl_cutoff),
                    PooledDocument.idle_warning_sent_at.is_(None),
                    PooledDocument.deleted_at.is_(None),
                )
            )
        ).all()

    by_owner: dict[str, dict[str, Any]] = {}
    for doc_id, name, email, full_name, locale in rows:
        entry = by_owner.setdefault(
            email, {"full_name": full_name, "locale": locale, "docs": []}
        )
        entry["docs"].append((doc_id, name))

    warned = 0
    for email, entry in by_owner.items():
        names = "\n".join(f"  - {name}" for _, name in entry["docs"])
        try:
            await send_idle_containers_warning_email(
                to=email,
                full_name=entry["full_name"],
                locale=coerce_locale(entry["locale"]),
                container_names=names,
                days_idle=warning_days,
                days_until_delete=max(1, ttl_days - warning_days),
            )
        except Exception:
            logger.exception(
                "pooled_reconcile: idle warning email to %s failed (will retry)", email
            )
            continue
        doc_ids = [doc_id for doc_id, _ in entry["docs"]]
        async with session_maker() as session, session.begin():
            await session.execute(
                sql_update(PooledDocument)
                .where(PooledDocument.id.in_(doc_ids))
                .values(idle_warning_sent_at=now)
            )
        warned += 1

    if warned:
        logger.info("pooled_reconcile: sent %d idle-deletion warning emails", warned)
    return warned


async def sweep_idle_pooled_containers(
    ttl_days: int,
    storage: StorageBackend | None = None,
    warning_days: int = 0,
) -> int:
    """Delete free containers with no viewer activity for ``ttl_days`` + their S3
    objects. Idle = ``last_viewed_at`` older than the cutoff, or never viewed and
    created before it. Storage cleanup is best-effort (logged on failure); the DB
    row delete cascades pooled_project_files + pooled_findings. ``storage`` is injectable
    for tests.

    ``warning_days`` > 0 enables a WARN pass before the delete pass: owners of
    containers idle past the warning threshold (but under the TTL) get a one-time
    deletion-warning email (stamped in ``idle_warning_sent_at``, reset when the
    container is viewed again).

    Returns the number of containers reaped.
    """
    session_maker = get_session_maker()
    store = storage if storage is not None else get_storage()
    now = datetime.now(UTC)
    cutoff = now - timedelta(days=ttl_days)

    if warning_days > 0:
        await _warn_idle_pooled_containers(session_maker, now, ttl_days, warning_days)

    async with session_maker() as session:
        rows = (
            await session.execute(
                select(PooledDocument.id, PooledDocument.owner_user_id).where(
                    _idle_before(cutoff)
                )
            )
        ).all()

    reaped = 0
    for document_id, owner_id in rows:
        prefix = f"free/{owner_id}/{document_id}/"
        try:
            await store.delete_prefix(prefix)
        except Exception:
            logger.exception(
                "pooled_reconcile: idle reap could not delete objects for %s", document_id
            )
        async with session_maker() as session, session.begin():
            await session.execute(
                sql_delete(PooledDocument).where(PooledDocument.id == document_id)
            )
        reaped += 1

    if reaped:
        logger.info("pooled_reconcile: idle-reaped %d free containers", reaped)
    return reaped


class IdlePooledContainerSweeper(PeriodicSweeper):
    """Deletes idle free containers (+ objects) past the TTL on an interval,
    after a one-time warning email at the warning threshold (0 disables the
    warn pass). Leader-elected; ``interval_minutes=0`` disables it."""

    def __init__(
        self, interval_minutes: int, idle_ttl_days: int, idle_warning_days: int = 0
    ) -> None:
        super().__init__(
            name="idle_pooled_container_sweeper",
            interval_seconds=interval_minutes * 60,
            lock_key="sweep:pooled_idle",
        )
        self.idle_ttl_days = idle_ttl_days
        self.idle_warning_days = idle_warning_days

    async def run_once(self) -> None:
        await sweep_idle_pooled_containers(
            self.idle_ttl_days, warning_days=self.idle_warning_days
        )
