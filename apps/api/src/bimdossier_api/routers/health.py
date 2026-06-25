import logging
from datetime import UTC, datetime

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from sqlalchemy import text as sa_text

from bimdossier_api.cache import get_redis
from bimdossier_api.db import get_session_maker
from bimdossier_api.storage import get_storage

logger = logging.getLogger(__name__)

router = APIRouter(tags=["health"])


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "timestamp": datetime.now(tz=UTC).isoformat()}


@router.get("/health/ready")
async def readiness() -> JSONResponse:
    checks: dict[str, str] = {}
    healthy = True

    # Postgres
    try:
        async with get_session_maker()() as session:
            await session.execute(sa_text("SELECT 1"))
        checks["postgres"] = "ok"
    except Exception:
        logger.warning("Readiness: postgres unreachable", exc_info=True)
        checks["postgres"] = "unreachable"
        healthy = False

    # Redis
    try:
        await get_redis().ping()
        checks["redis"] = "ok"
    except Exception:
        logger.warning("Readiness: redis unreachable", exc_info=True)
        checks["redis"] = "unreachable"
        healthy = False

    # S3 / MinIO
    try:
        storage = get_storage()
        await storage.ensure_bucket()
        checks["storage"] = "ok"
    except Exception:
        logger.warning("Readiness: storage unreachable", exc_info=True)
        checks["storage"] = "unreachable"
        healthy = False

    status_code = 200 if healthy else 503
    return JSONResponse(
        status_code=status_code,
        content={
            "status": "ready" if healthy else "degraded",
            "checks": checks,
            "timestamp": datetime.now(tz=UTC).isoformat(),
        },
    )
