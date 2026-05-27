import logging
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi_limiter import FastAPILimiter

from bimstitch_api.admin.invitation_expiry import InvitationExpirySweeper
from bimstitch_api.auth.routes import build_auth_router
from bimstitch_api.auth.tokens import TokenError, decode_token_full
from bimstitch_api.cache import close_redis, get_redis
from bimstitch_api.config import get_settings
from bimstitch_api.db import get_engine
from bimstitch_api.deadlines.reminder_engine import DeadlineReminderSweeper
from bimstitch_api.jobs.dispatcher import close_http_client
from bimstitch_api.migrations_check import check_pending_migrations
from bimstitch_api.notifications.manager import get_manager
from bimstitch_api.observability import init_sentry
from bimstitch_api.routers.access_requests import router as access_requests_router
from bimstitch_api.routers.activity import router as activity_router
from bimstitch_api.routers.admin_impersonate import router as admin_impersonate_router
from bimstitch_api.routers.admin_organizations import router as admin_organizations_router
from bimstitch_api.routers.borgingsplan import (
    moment_router as borgingsplan_moment_router,
)
from bimstitch_api.routers.borgingsplan import (
    plan_router as borgingsplan_plan_router,
)
from bimstitch_api.routers.capture_links import router as capture_links_router
from bimstitch_api.routers.capture_public import router as capture_public_router
from bimstitch_api.routers.compliance import (
    project_router as compliance_project_router,
)
from bimstitch_api.routers.compliance import (
    router as compliance_router,
)
from bimstitch_api.routers.contractors import router as contractors_router
from bimstitch_api.routers.deadline_notification_settings import (
    org_router as dl_notif_settings_org_router,
)
from bimstitch_api.routers.deadline_notification_settings import (
    project_router as dl_notif_settings_project_router,
)
from bimstitch_api.routers.deadlines import router as deadlines_router
from bimstitch_api.routers.documents import router as documents_router
from bimstitch_api.routers.health import router as health_router
from bimstitch_api.routers.inspection import router as inspection_router
from bimstitch_api.routers.jobs import router as jobs_router
from bimstitch_api.routers.jobs_internal import router as jobs_internal_router
from bimstitch_api.routers.jurisdictions import router as jurisdictions_router
from bimstitch_api.routers.me_invitations import (
    leave_router as me_memberships_router,
)
from bimstitch_api.routers.me_invitations import router as me_invitations_router
from bimstitch_api.routers.me_profile import router as me_profile_router
from bimstitch_api.routers.models import router as models_router
from bimstitch_api.routers.notifications import router as notifications_router
from bimstitch_api.routers.organization_members import router as organization_members_router
from bimstitch_api.routers.project_files import router as project_files_router
from bimstitch_api.routers.projects import router as projects_router
from bimstitch_api.routers.public import router as public_router
from bimstitch_api.routers.reports import router as reports_router
from bimstitch_api.routers.risks import router as risks_router
from bimstitch_api.routers.ws_notifications import router as ws_notifications_router
from bimstitch_api.storage import get_documents_bucket, get_storage

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    redis = get_redis()
    await FastAPILimiter.init(redis)
    manager = get_manager()
    await manager.start(redis)
    await check_pending_migrations(get_engine())
    try:
        storage = get_storage()
        await storage.ensure_bucket()
        await storage.ensure_bucket(bucket=get_documents_bucket())
    except Exception:
        logger.warning(
            "MinIO/S3 ensure_bucket failed; uploads will fail until storage is reachable",
            exc_info=True,
        )
    invitation_sweeper = InvitationExpirySweeper(settings.invitation_sweep_interval_minutes)
    invitation_sweeper.start()
    deadline_sweeper = DeadlineReminderSweeper(settings.deadline_sweep_interval_minutes)
    deadline_sweeper.start()
    try:
        yield
    finally:
        _storage = get_storage()
        if hasattr(_storage, "close"):
            await _storage.close()
        await close_http_client()
        await deadline_sweeper.stop()
        await invitation_sweeper.stop()
        await manager.stop()
        await FastAPILimiter.close()
        await close_redis()


async def _impersonator_middleware(
    request: Request, call_next: Callable[[Request], Awaitable[Response]]
) -> Response:
    """Stash the `imp` claim onto `request.state` for every authenticated
    request, so `audit.record(...)` can attribute mutations to the real
    super admin without each route threading the value manually.

    Malformed/missing tokens are silent — auth dependencies surface those
    later. This middleware is a side-effect-only enricher.
    """
    auth_header = request.headers.get("authorization") or request.headers.get("Authorization")
    if auth_header and auth_header.lower().startswith("bearer "):
        token = auth_header.split(" ", 1)[1].strip()
        try:
            decoded = decode_token_full(token, "access")
        except TokenError:
            decoded = None
        if decoded is not None:
            request.state.decoded_token = decoded
            if decoded.impersonator_user_id is not None:
                request.state.impersonator_user_id = decoded.impersonator_user_id
    return await call_next(request)


def create_app() -> FastAPI:
    settings = get_settings()
    init_sentry()
    app = FastAPI(title="BIMstitch API", version="0.0.1", lifespan=lifespan)

    app.middleware("http")(_impersonator_middleware)

    app.add_middleware(GZipMiddleware, minimum_size=500, compresslevel=5)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_origin_regex=settings.cors_origin_regex,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["Content-Disposition", "X-Total-Count"],
    )

    app.include_router(health_router)
    app.include_router(public_router)
    app.include_router(access_requests_router)
    app.include_router(jurisdictions_router)
    app.include_router(build_auth_router())
    app.include_router(admin_organizations_router)
    app.include_router(admin_impersonate_router)
    app.include_router(organization_members_router)
    app.include_router(me_invitations_router)
    app.include_router(me_memberships_router)
    app.include_router(me_profile_router)
    app.include_router(projects_router)
    app.include_router(contractors_router)
    app.include_router(models_router)
    app.include_router(project_files_router)
    app.include_router(jobs_internal_router)
    app.include_router(compliance_router)
    app.include_router(compliance_project_router)
    app.include_router(deadlines_router)
    app.include_router(dl_notif_settings_org_router)
    app.include_router(dl_notif_settings_project_router)
    app.include_router(risks_router)
    app.include_router(borgingsplan_plan_router)
    app.include_router(borgingsplan_moment_router)
    app.include_router(documents_router)
    app.include_router(capture_links_router)
    app.include_router(capture_public_router)
    app.include_router(inspection_router)
    app.include_router(jobs_router)
    app.include_router(reports_router)
    app.include_router(activity_router)
    app.include_router(notifications_router)
    app.include_router(ws_notifications_router)
    return app


app = create_app()
