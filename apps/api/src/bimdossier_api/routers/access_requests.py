"""Public endpoint for prospects to request demo access.

Stores a lead row that admins approve later. No user or organization is
created here — approval is a separate flow that mints both.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from bimdossier_api.auth.ratelimit import ResilientRateLimiter
from bimdossier_api.db import get_async_session
from bimdossier_api.models.access_request import AccessRequest, AccessRequestStatus
from bimdossier_api.schemas.access_request import (
    AccessRequestCreate,
    AccessRequestRead,
)

logger = logging.getLogger(__name__)

# Limit to 5 submissions per hour per IP. The blocklist on free-email
# providers covers most accidental misuse; rate limit covers scripted spam.
ACCESS_REQUEST_RATE_LIMITER = ResilientRateLimiter(times=5, seconds=3600)

router = APIRouter(prefix="/access-requests", tags=["access-requests"])


async def _detect_duplicate(
    session: AsyncSession, work_email: str
) -> AccessRequest | None:
    """Return any blocking prior row for this email — `new` or `approved`.
    Rejected rows are skipped so retries are allowed."""
    stmt = (
        select(AccessRequest)
        .where(AccessRequest.work_email == work_email)
        .where(
            AccessRequest.status.in_(
                [AccessRequestStatus.new, AccessRequestStatus.approved]
            )
        )
        .order_by(AccessRequest.created_at.desc())
        .limit(1)
    )
    return (await session.execute(stmt)).scalar_one_or_none()


def _duplicate_detail(existing: AccessRequest) -> str:
    if existing.status == AccessRequestStatus.new:
        return "ACCESS_REQUEST_PENDING_DUPLICATE"
    return "ACCESS_REQUEST_ALREADY_APPROVED"


@router.post(
    "",
    response_model=AccessRequestRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(ACCESS_REQUEST_RATE_LIMITER)],
)
async def create_access_request(
    payload: AccessRequestCreate,
    session: AsyncSession = Depends(get_async_session),
) -> AccessRequestRead:
    # `payload.work_email` is already lowercased by AccessRequestCreate's
    # validator, so a direct equality comparison is correct.
    existing = await _detect_duplicate(session, payload.work_email)
    if existing is not None:
        raise HTTPException(status_code=409, detail=_duplicate_detail(existing))

    row = AccessRequest(
        name=payload.name,
        work_email=payload.work_email,
        company=payload.company,
        role=payload.role,
        company_size=payload.company_size,
        country=payload.country,
        notes=payload.notes,
    )
    session.add(row)
    try:
        await session.commit()
    except IntegrityError:
        # Race: two concurrent submissions both passed the SELECT and both
        # tried to INSERT. The partial unique index
        # `ux_access_requests_active_email` catches the loser. Re-query so
        # we know which detail code to surface.
        await session.rollback()
        existing = await _detect_duplicate(session, payload.work_email)
        if existing is not None:
            raise HTTPException(
                status_code=409, detail=_duplicate_detail(existing)
            ) from None
        raise  # unexpected — let it bubble as 500
    await session.refresh(row)
    logger.info("access_request_created id=%s email=%s", row.id, row.work_email)
    return AccessRequestRead.model_validate(row)
