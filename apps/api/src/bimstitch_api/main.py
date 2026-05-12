import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi_limiter import FastAPILimiter

from bimstitch_api.auth.routes import build_auth_router
from bimstitch_api.cache import close_redis, get_redis
from bimstitch_api.config import get_settings
from bimstitch_api.notifications.manager import get_manager
from bimstitch_api.observability import init_sentry
from bimstitch_api.routers.access_requests import router as access_requests_router
from bimstitch_api.routers.compliance import (
    project_router as compliance_project_router,
)
from bimstitch_api.routers.compliance import (
    router as compliance_router,
)
from bimstitch_api.routers.contractors import router as contractors_router
from bimstitch_api.routers.jobs_internal import router as jobs_internal_router
from bimstitch_api.routers.health import router as health_router
from bimstitch_api.routers.jobs import router as jobs_router
from bimstitch_api.routers.models import router as models_router
from bimstitch_api.routers.notifications import router as notifications_router
from bimstitch_api.routers.project_files import router as project_files_router
from bimstitch_api.routers.projects import router as projects_router
from bimstitch_api.routers.public import router as public_router
from bimstitch_api.routers.reports import router as reports_router
from bimstitch_api.routers.ws_notifications import router as ws_notifications_router
from bimstitch_api.storage import get_storage

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    redis = get_redis()
    await FastAPILimiter.init(redis)
    manager = get_manager()
    await manager.start(redis)
    try:
        await get_storage().ensure_bucket()
    except Exception:
        logger.warning(
            "MinIO/S3 ensure_bucket failed; uploads will fail until storage is reachable",
            exc_info=True,
        )
    try:
        yield
    finally:
        await manager.stop()
        await FastAPILimiter.close()
        await close_redis()


def create_app() -> FastAPI:
    settings = get_settings()
    init_sentry()
    app = FastAPI(title="BIMstitch API", version="0.0.1", lifespan=lifespan)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_origin_regex=settings.cors_origin_regex,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["Content-Disposition"],
    )

    app.include_router(health_router)
    app.include_router(public_router)
    app.include_router(access_requests_router)
    app.include_router(build_auth_router())
    app.include_router(projects_router)
    app.include_router(contractors_router)
    app.include_router(models_router)
    app.include_router(project_files_router)
    app.include_router(jobs_internal_router)
    app.include_router(compliance_router)
    app.include_router(compliance_project_router)
    app.include_router(jobs_router)
    app.include_router(reports_router)
    app.include_router(notifications_router)
    app.include_router(ws_notifications_router)
    return app


app = create_app()
