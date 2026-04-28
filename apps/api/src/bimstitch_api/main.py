from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi_limiter import FastAPILimiter

from bimstitch_api.auth.routes import build_auth_router
from bimstitch_api.cache import close_redis, get_redis
from bimstitch_api.config import get_settings
from bimstitch_api.routers.health import router as health_router


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    redis = get_redis()
    await FastAPILimiter.init(redis)
    try:
        yield
    finally:
        await FastAPILimiter.close()
        await close_redis()


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="BIMstitch API", version="0.0.1", lifespan=lifespan)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(health_router)
    app.include_router(build_auth_router())
    return app


app = create_app()
