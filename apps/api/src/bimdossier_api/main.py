import logging
import os
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi_limiter import FastAPILimiter
from sqlalchemy import text
from starlette.exceptions import HTTPException as StarletteHTTPException

from bimdossier_api.admin.invitation_expiry import InvitationExpirySweeper
from bimdossier_api.auth.ratelimit import default_rate_limit_identifier
from bimdossier_api.auth.routes import build_auth_router
from bimdossier_api.auth.tokens import TokenError, decode_token_full
from bimdossier_api.cache import close_redis, get_redis
from bimdossier_api.config import (
    get_settings,
    log_secret_sources,
    validate_production_config,
)
from bimdossier_api.data_lifecycle import (
    CaptureLinkExpirySweeper,
    PendingUploadSweeper,
)
from bimdossier_api.db import get_engine
from bimdossier_api.deadlines.reminder_engine import DeadlineReminderSweeper
from bimdossier_api.i18n.http_errors import (
    generic_exception_handler,
    http_exception_handler,
    validation_exception_handler,
)
from bimdossier_api.jobs.dispatcher import close_http_client
from bimdossier_api.jobs.reconcile import JobReconcileSweeper
from bimdossier_api.logging_config import configure_logging
from bimdossier_api.middleware import (
    RequestBodySizeLimitMiddleware,
    RequestIdMiddleware,
    SelectiveGZipMiddleware,
)
from bimdossier_api.migrations_check import (
    check_pending_migrations,
    check_tenant_schema_drift,
)
from bimdossier_api.notifications.manager import get_manager
from bimdossier_api.observability import init_sentry
from bimdossier_api.routers.access_requests import router as access_requests_router
from bimdossier_api.routers.activity import router as activity_router
from bimdossier_api.routers.admin_blog import router as admin_blog_router
from bimdossier_api.routers.admin_impersonate import router as admin_impersonate_router
from bimdossier_api.routers.admin_jobs import router as admin_jobs_router
from bimdossier_api.routers.admin_organizations import router as admin_organizations_router
from bimdossier_api.routers.aligned_sheets import router as aligned_sheets_router
from bimdossier_api.routers.attachments import router as attachments_router
from bimdossier_api.routers.bcf import router as bcf_router
from bimdossier_api.routers.borgingsplan import (
    moment_router as borgingsplan_moment_router,
)
from bimdossier_api.routers.borgingsplan import (
    plan_router as borgingsplan_plan_router,
)
from bimdossier_api.routers.calendar import router as calendar_router
from bimdossier_api.routers.capture_links import router as capture_links_router
from bimdossier_api.routers.capture_public import router as capture_public_router
from bimdossier_api.routers.certificates import router as certificates_router
from bimdossier_api.routers.compliance import (
    project_router as compliance_project_router,
)
from bimdossier_api.routers.compliance import (
    router as compliance_router,
)
from bimdossier_api.routers.deadline_notification_settings import (
    org_router as dl_notif_settings_org_router,
)
from bimdossier_api.routers.deadline_notification_settings import (
    project_router as dl_notif_settings_project_router,
)
from bimdossier_api.routers.deadlines import router as deadlines_router
from bimdossier_api.routers.documents import router as documents_router
from bimdossier_api.routers.element_inspections import router as element_inspections_router
from bimdossier_api.routers.finding import router as finding_router
from bimdossier_api.routers.finding_comment import router as finding_comment_router
from bimdossier_api.routers.health import router as health_router
from bimdossier_api.routers.inspection import router as inspection_router
from bimdossier_api.routers.jobs import router as jobs_router
from bimdossier_api.routers.jobs_internal import router as jobs_internal_router
from bimdossier_api.routers.jurisdictions import router as jurisdictions_router
from bimdossier_api.routers.levels import router as levels_router
from bimdossier_api.routers.me_invitations import (
    leave_router as me_memberships_router,
)
from bimdossier_api.routers.me_invitations import router as me_invitations_router
from bimdossier_api.routers.me_profile import router as me_profile_router
from bimdossier_api.routers.notifications import router as notifications_router
from bimdossier_api.routers.org_certificates import router as org_certificates_router
from bimdossier_api.routers.org_templates import router as org_templates_router
from bimdossier_api.routers.organization_image import (
    admin_router as org_image_admin_router,
)
from bimdossier_api.routers.organization_image import (
    org_router as org_image_router,
)
from bimdossier_api.routers.organization_members import router as organization_members_router
from bimdossier_api.routers.organization_settings import router as org_settings_router
from bimdossier_api.routers.permissions import router as permissions_router
from bimdossier_api.routers.project_files import (
    project_viewer_router,
)
from bimdossier_api.routers.project_files import (
    router as project_files_router,
)
from bimdossier_api.routers.projects import router as projects_router
from bimdossier_api.routers.public import router as public_router
from bimdossier_api.routers.reports import router as reports_router
from bimdossier_api.routers.risks import router as risks_router
from bimdossier_api.routers.storeys import router as storeys_router
from bimdossier_api.routers.ws_notifications import router as ws_notifications_router
from bimdossier_api.security_headers import (
    API_CSP,
    DOCS_CSP,
    DOCS_PATH_PREFIXES,
    STATIC_SECURITY_HEADERS,
    hsts_value,
)
from bimdossier_api.storage import get_attachments_bucket, get_storage

logger = logging.getLogger(__name__)


def _startup_fatal(header: str, errors: list[str]) -> None:
    """Log a clear error block and terminate immediately.

    Uses ``os._exit(1)`` instead of ``SystemExit`` to avoid the massive
    ``merged_lifespan`` traceback that FastAPI produces when a lifespan
    context manager raises.
    """
    logger.error("=" * 60)
    logger.error("STARTUP FAILED — %s:", header)
    for err in errors:
        logger.error("  • %s", err)
    logger.error("=" * 60)
    logging.shutdown()
    os._exit(1)


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    errors: list[str] = []

    # --- Redis ---
    redis = get_redis()
    try:
        await redis.ping()
    except Exception as exc:
        errors.append(f"Redis ({settings.redis_url}): {exc}")

    # --- Database ---
    engine = get_engine()
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
    except Exception as exc:
        errors.append(f"Database: {exc}")

    if errors:
        _startup_fatal("cannot reach required services", errors)

    # --- Production config guard ---
    # Production is the default posture: refuse to boot with known dev-default
    # secrets / wildcard CORS unless DEPLOY_REGION is *explicitly* "dev", so a
    # forgotten env var fails loudly instead of silently shipping a public
    # credential. log_secret_sources first records env-vs-default per secret and
    # warns loudly if the guard is in dev-skip mode.
    log_secret_sources(settings)
    insecure = validate_production_config(settings)
    if insecure:
        _startup_fatal("insecure production configuration", insecure)

    # --- Rate limiter ---
    try:
        await FastAPILimiter.init(redis, identifier=default_rate_limit_identifier)
    except Exception:
        logger.warning("Rate limiter init failed; rate limiting disabled", exc_info=True)

    # --- Notification manager ---
    manager = get_manager()
    try:
        await manager.start(redis)
    except Exception:
        logger.warning("Notification manager failed to start", exc_info=True)

    # --- Database migration check ---
    try:
        await check_pending_migrations(engine)
    except Exception as exc:
        _startup_fatal("database migration check failed", [str(exc)])

    # --- Tenant-schema drift probe (WARN-only, never blocks boot) ---
    # The master check above covers only the public chain. This surfaces the
    # separate per-tenant chain so a deploy that ran `alembic upgrade head` but
    # forgot `migrate_all` is loud in the logs instead of 500ing existing orgs.
    try:
        await check_tenant_schema_drift(engine)
    except Exception:
        logger.warning("Could not verify tenant-schema migration state", exc_info=True)

    # --- S3/MinIO storage ---
    # Buckets are a hard dependency — uploads, viewer artifacts, reports, and BCF
    # snapshots all live in object storage. Fail the boot if they're unreachable
    # (same posture as Redis/DB/migrations) rather than booting "healthy" and
    # 500ing on the first request that touches storage.
    try:
        storage = get_storage()
        await storage.ensure_bucket()
        await storage.ensure_bucket(bucket=get_attachments_bucket())
    except Exception as exc:
        _startup_fatal("object storage (S3/MinIO) is unreachable", [str(exc)])

    # --- Background sweepers ---
    invitation_sweeper = InvitationExpirySweeper(settings.invitation_sweep_interval_minutes)
    invitation_sweeper.start()
    deadline_sweeper = DeadlineReminderSweeper(settings.deadline_sweep_interval_minutes)
    deadline_sweeper.start()
    job_reconcile_sweeper = JobReconcileSweeper(
        settings.job_reconcile_interval_minutes,
        settings.job_stuck_timeout_minutes,
    )
    job_reconcile_sweeper.start()
    # Data-lifecycle reapers (L11): abandoned pending uploads + expired/revoked
    # unused capture links.
    pending_upload_sweeper = PendingUploadSweeper(
        settings.pending_upload_sweep_interval_minutes,
        settings.pending_upload_timeout_minutes,
    )
    pending_upload_sweeper.start()
    capture_link_sweeper = CaptureLinkExpirySweeper(
        settings.capture_link_sweep_interval_minutes,
    )
    capture_link_sweeper.start()
    logger.info("Startup complete — all services connected")
    try:
        yield
    finally:
        _storage = get_storage()
        if hasattr(_storage, "close"):
            await _storage.close()
        await close_http_client()
        await capture_link_sweeper.stop()
        await pending_upload_sweeper.stop()
        await job_reconcile_sweeper.stop()
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


async def _security_headers_middleware(
    request: Request, call_next: Callable[[Request], Awaitable[Response]]
) -> Response:
    """Attach security-response headers to every response (finding B5).

    Registered LAST in ``create_app`` so it runs OUTERMOST: it sees the final
    response after GZip compression, CORS, and the localized exception handlers,
    so the headers land on error responses (4xx/5xx) too. HSTS is gated on the
    request scheme being https (set from ``X-Forwarded-Proto`` via uvicorn
    ``--proxy-headers``) so local http dev and the ASGITransport test client
    (base_url ``http://test``) never receive it.
    """
    response = await call_next(request)

    # CSP: strict for the JSON API, relaxed for the interactive docs so the
    # Swagger-UI / ReDoc CDN bundles keep rendering.
    if request.url.path.startswith(DOCS_PATH_PREFIXES):
        response.headers["Content-Security-Policy"] = DOCS_CSP
    else:
        response.headers["Content-Security-Policy"] = API_CSP

    for name, value in STATIC_SECURITY_HEADERS.items():
        response.headers[name] = value

    # Only emit HSTS over https — never instruct an http dev client to force TLS.
    if request.url.scheme == "https":
        settings = get_settings()  # lru_cache'd; cheap
        response.headers["Strict-Transport-Security"] = hsts_value(settings.hsts_max_age_seconds)

    return response


def create_app() -> FastAPI:
    settings = get_settings()
    # Structured logging first so startup log lines (and everything after) use
    # the configured format instead of uvicorn's inherited plaintext (M-obs1).
    configure_logging(settings)
    init_sentry()
    app = FastAPI(title="BimDossier API", version="0.0.1", lifespan=lifespan)

    app.middleware("http")(_impersonator_middleware)

    # GZip everything EXCEPT auth responses — those return tokens and reflect
    # caller input in their error envelopes, so compressing them is a BREACH
    # oracle (L7). SelectiveGZipMiddleware takes the same slot/kwargs as the bare
    # GZipMiddleware, so the middleware ordering below is unchanged.
    app.add_middleware(SelectiveGZipMiddleware, minimum_size=500, compresslevel=5)

    # Reject oversized request bodies before any downstream layer buffers them
    # (B3 DoS backstop). Registered after GZip / before CORS so the resulting
    # outer→inner order is CORS → body-limit → GZip → impersonator → app: CORS
    # stays outermost (the 413 still gets its Access-Control headers so browsers
    # can read it), while body-limit runs before the first body-aware layer.
    app.add_middleware(
        RequestBodySizeLimitMiddleware,
        max_bytes=settings.request_body_max_bytes,
    )

    # CORS is restricted to the configured allowlist (CORS_ORIGINS, optional
    # CORS_ORIGIN_REGEX). A wildcard here together with allow_credentials=True
    # would defeat the allowlist the config already wires up — never re-introduce
    # allow_origins=["*"]. Dev keeps working via the localhost default.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_origin_regex=settings.cors_origin_regex,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=[
            "Content-Disposition",
            "X-Total-Count",
            "X-Message-Code",
            "X-Message",
            "X-Request-Id",
        ],
    )

    # Registered LAST so it runs OUTERMOST: security headers are stamped on the
    # final response after GZip/CORS and after the exception handlers render, so
    # they appear on every response (including 4xx/5xx and CORS preflight).
    app.middleware("http")(_security_headers_middleware)

    # Request-id correlation runs OUTERMOST of all (registered last): it binds
    # the request-scoped id for the logging filter / audit row / Sentry tag
    # before any inner layer runs, and stamps the X-Request-Id response header on
    # every response — including CORS preflight, the body-limit 413, and error
    # envelopes (M-obs1). The id is exposed cross-origin via CORS expose_headers.
    app.add_middleware(RequestIdMiddleware)

    # Localize error responses: turn HTTPException codes (and 422 validation
    # errors) into a { code, message<localized>, detail } envelope. Registered
    # for the Starlette base so both FastAPI and Starlette HTTPExceptions (incl.
    # unmatched-route 404s) flow through. `detail` is preserved unchanged.
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)
    app.add_exception_handler(RequestValidationError, validation_exception_handler)
    # Catch-all: any non-HTTPException error becomes the same localized envelope
    # (a 500 with code INTERNAL_ERROR) instead of Starlette's bare text response.
    # Starlette routes the base-Exception handler to ServerErrorMiddleware, which
    # re-raises after responding, so Sentry/server logging still capture it.
    app.add_exception_handler(Exception, generic_exception_handler)

    app.include_router(health_router)
    app.include_router(public_router)
    app.include_router(access_requests_router)
    app.include_router(jurisdictions_router)
    app.include_router(permissions_router)
    app.include_router(build_auth_router())
    app.include_router(admin_organizations_router)
    app.include_router(admin_jobs_router)
    app.include_router(admin_blog_router)
    app.include_router(admin_impersonate_router)
    app.include_router(org_image_admin_router)
    app.include_router(org_image_router)
    app.include_router(org_settings_router)
    app.include_router(organization_members_router)
    app.include_router(me_invitations_router)
    app.include_router(me_memberships_router)
    app.include_router(me_profile_router)
    app.include_router(projects_router)
    app.include_router(documents_router)
    app.include_router(levels_router)
    app.include_router(storeys_router)
    app.include_router(aligned_sheets_router)
    app.include_router(project_files_router)
    app.include_router(project_viewer_router)
    app.include_router(jobs_internal_router)
    app.include_router(compliance_router)
    app.include_router(compliance_project_router)
    app.include_router(deadlines_router)
    app.include_router(calendar_router)
    app.include_router(dl_notif_settings_org_router)
    app.include_router(dl_notif_settings_project_router)
    app.include_router(risks_router)
    app.include_router(bcf_router)
    app.include_router(finding_router)
    app.include_router(finding_comment_router)
    app.include_router(org_templates_router)
    app.include_router(borgingsplan_plan_router)
    app.include_router(borgingsplan_moment_router)
    app.include_router(attachments_router)
    app.include_router(certificates_router)
    app.include_router(org_certificates_router)
    app.include_router(capture_links_router)
    app.include_router(capture_public_router)
    app.include_router(element_inspections_router)
    app.include_router(inspection_router)
    app.include_router(jobs_router)
    app.include_router(reports_router)
    app.include_router(activity_router)
    app.include_router(notifications_router)
    app.include_router(ws_notifications_router)
    return app


app = create_app()
