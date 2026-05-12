"""Public endpoint for prospects to request demo access.

Stores a lead row that admins approve later. No user or organization is
created here — approval is a separate flow that mints both.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, status
from fastapi_limiter.depends import RateLimiter
from sqlalchemy.ext.asyncio import AsyncSession

from bimstitch_api.db import get_async_session
from bimstitch_api.models.access_request import AccessRequest
from bimstitch_api.schemas.access_request import (
    AccessRequestCreate,
    AccessRequestRead,
)

logger = logging.getLogger(__name__)

# Limit to 5 submissions per hour per IP. The blocklist on free-email
# providers covers most accidental misuse; rate limit covers scripted spam.
ACCESS_REQUEST_RATE_LIMITER = RateLimiter(times=5, seconds=3600)

router = APIRouter(prefix="/access-requests", tags=["access-requests"])


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
    await session.commit()
    await session.refresh(row)
    logger.info("access_request_created id=%s email=%s", row.id, row.work_email)
    return AccessRequestRead.model_validate(row)
