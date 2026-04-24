from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from bimquantify_api.auth.routes import build_auth_router
from bimquantify_api.config import get_settings
from bimquantify_api.routers.health import router as health_router


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="BIMQuantify API", version="0.0.1")

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
