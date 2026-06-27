"""Hard-purge soft-deleted organizations — phase 2 of the org lifecycle.

Wipes a soft-deleted org's MinIO/S3 objects and DROPs its tenant schema, closing
the GDPR Art. 17 / DLC-1 storage-orphan gap. Phase 1 (soft-delete) is the admin
``DELETE /admin/organizations/{id}`` endpoint; this script is the manual phase-2
teardown for orgs that have cleared the retention window (``ORG_RETENTION_DAYS``).
The same teardown is also reachable from the super-admin portal UI
(``POST /admin/organizations/{id}/purge``); both call ``purge_organization``.

Usage::

    # Dry-run (default): list what WOULD be purged, delete nothing.
    uv run python -m bimdossier_api.scripts.purge_organizations --due
    uv run python -m bimdossier_api.scripts.purge_organizations --org <uuid>

    # Execute (required to actually delete):
    uv run python -m bimdossier_api.scripts.purge_organizations --due --execute
    uv run python -m bimdossier_api.scripts.purge_organizations --org <uuid> --execute

    # Erasure-on-request: ignore the retention window for ONE org.
    uv run python -m bimdossier_api.scripts.purge_organizations --org <uuid> --now --execute

Exactly one of ``--due`` / ``--org`` is required. ``--now`` is only valid with
``--org`` (refusing to mass-erase every soft-deleted org ignoring retention).
Purge is IRREVERSIBLE — the dry-run default and the explicit ``--execute`` flag
are the guard rails.

Exit codes: ``0`` = clean (all targets purged / listed); ``1`` = at least one
purge failed, the run lock was held, or the flags were invalid; ``130`` =
interrupted.
"""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import sys
from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import select

from bimdossier_api.admin.provisioning import (
    PURGE_DONE,
    PURGE_DRY_RUN,
    PurgeResult,
    purge_organization,
)
from bimdossier_api.config import get_settings
from bimdossier_api.db import get_admin_engine, get_engine, get_session_maker
from bimdossier_api.models.organization import Organization
from bimdossier_api.storage import get_storage

_LOCK_KEY = "purge_organizations:lock"
_LOCK_TTL_SECONDS = 3600
_DEFAULT_CONCURRENCY = 4


async def _list_candidate_ids(args: argparse.Namespace, retention_days: int) -> list[UUID]:
    """Org ids to attempt. For ``--org`` the single id is returned verbatim —
    ``purge_organization`` applies the guards (not-deleted / not-due / already-
    purged) and reports the reason. For ``--due`` it is every soft-deleted,
    not-yet-purged org past the retention window."""
    if args.org is not None:
        return [args.org]
    cutoff = datetime.now(UTC) - timedelta(days=retention_days)
    stmt = (
        select(Organization.id)
        .where(
            Organization.purged_at.is_(None),
            Organization.deleted_at.is_not(None),
            Organization.deleted_at < cutoff,
        )
        .order_by(Organization.deleted_at)
    )
    async with get_session_maker()() as session:
        return [row[0] for row in (await session.execute(stmt)).all()]


async def _purge_one(
    org_id: UUID,
    *,
    now: bool,
    dry_run: bool,
    retention_days: int,
    sem: asyncio.Semaphore,
) -> PurgeResult:
    async with sem:
        try:
            return await purge_organization(
                organization_id=org_id,
                now=now,
                dry_run=dry_run,
                retention_days=retention_days,
            )
        except Exception as exc:  # one bad org must not sink the batch
            return PurgeResult(org_id, f"error: {type(exc).__name__}: {exc}")


def _summarize(results: list[PurgeResult], *, dry_run: bool) -> int:
    by_status: dict[str, int] = {}
    failed = 0
    for r in results:
        by_status[r.status] = by_status.get(r.status, 0) + 1
        if r.status.startswith("error"):
            failed += 1
            print(f"  FAILED {r.organization_id}: {r.status}", file=sys.stderr)
        elif dry_run and r.status == PURGE_DRY_RUN:
            print(f"  WOULD PURGE {r.organization_id} (schema={r.schema_name}):")
            for target in r.targets:
                print(f"      - {target}")
        elif r.status == PURGE_DONE:
            print(
                f"  purged {r.organization_id} (schema={r.schema_name}, "
                f"{r.deleted_object_count} object(s) deleted)"
            )
        else:
            print(f"  {r.status}: {r.organization_id}")
    print("\nSummary:")
    for status_label, count in sorted(by_status.items()):
        print(f"  {status_label}: {count}")
    return 1 if failed else 0


async def _run(args: argparse.Namespace, retention_days: int) -> int:
    try:
        ids = await _list_candidate_ids(args, retention_days)
        if not ids:
            print("No organizations match the criteria.")
            return 0

        mode = "EXECUTE" if args.execute else "DRY-RUN (nothing will be deleted)"
        print(
            f"purge_organizations [{mode}] — {len(ids)} candidate org(s), "
            f"retention={retention_days}d, now={args.now}"
        )
        if args.execute:
            print("  *** This PERMANENTLY deletes tenant data (storage + schema). ***")

        sem = asyncio.Semaphore(max(1, args.concurrency))
        results = await asyncio.gather(
            *[
                _purge_one(
                    org_id,
                    now=args.now,
                    dry_run=not args.execute,
                    retention_days=retention_days,
                    sem=sem,
                )
                for org_id in ids
            ]
        )
        return _summarize(results, dry_run=not args.execute)
    finally:
        # Close the storage client + engines bound to this loop so the process
        # exits cleanly (no "Unclosed client session" / cross-loop warnings).
        close = getattr(get_storage(), "close", None)
        if close is not None:
            with contextlib.suppress(Exception):
                await close()
        await get_engine().dispose()
        await get_admin_engine().dispose()


async def _acquire_lock(url: str) -> bool | None:
    """True = acquired, False = another run holds it, None = Redis unavailable.
    Throwaway client so it never shares a loop with the global engine."""
    try:
        from redis.asyncio import Redis

        async with Redis.from_url(url, decode_responses=True) as client:
            return bool(await client.set(_LOCK_KEY, "1", nx=True, ex=_LOCK_TTL_SECONDS))
    except Exception as exc:
        print(f"WARN: Redis lock unavailable ({exc}); proceeding without it.", file=sys.stderr)
        return None


async def _release_lock(url: str) -> None:
    try:
        from redis.asyncio import Redis

        async with Redis.from_url(url, decode_responses=True) as client:
            await client.delete(_LOCK_KEY)
    except Exception:
        pass


def _parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Hard-purge soft-deleted organizations (storage wipe + DROP SCHEMA)."
    )
    parser.add_argument("--org", type=UUID, default=None, help="Target one org by id.")
    parser.add_argument(
        "--due", action="store_true", help="Target every org past the retention window."
    )
    parser.add_argument(
        "--now",
        action="store_true",
        help="Ignore the retention window (only valid with --org).",
    )
    parser.add_argument(
        "--execute",
        "--yes",
        dest="execute",
        action="store_true",
        help="Actually purge. Without it the script is a dry run.",
    )
    parser.add_argument(
        "--retention-days",
        type=int,
        default=None,
        help="Override ORG_RETENTION_DAYS for this run.",
    )
    parser.add_argument(
        "--concurrency",
        type=int,
        default=_DEFAULT_CONCURRENCY,
        help=f"Max concurrent purges. Default {_DEFAULT_CONCURRENCY}.",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)

    # Flag validation: exactly one target selector; --now is single-org only.
    if (args.org is not None) == bool(args.due):
        print("error: exactly one of --org / --due is required.", file=sys.stderr)
        return 1
    if args.now and args.org is None:
        print(
            "error: --now requires --org (refusing to skip retention for a batch).",
            file=sys.stderr,
        )
        return 1

    settings = get_settings()
    retention_days = (
        args.retention_days if args.retention_days is not None else settings.org_retention_days
    )

    # Lock only when executing — a dry run never touches storage or the schema.
    holding = False
    if args.execute:
        lock = asyncio.run(_acquire_lock(settings.redis_url))
        if lock is False:
            print("Another purge_organizations run is in progress; exiting.", file=sys.stderr)
            return 1
        holding = lock is True
    try:
        return asyncio.run(_run(args, retention_days))
    finally:
        if holding:
            asyncio.run(_release_lock(settings.redis_url))


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(130)
