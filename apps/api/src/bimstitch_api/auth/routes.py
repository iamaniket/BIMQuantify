from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordRequestForm
from fastapi_limiter.depends import RateLimiter
from fastapi_users.exceptions import UserAlreadyExists

from bimstitch_api.auth.fastapi_users import fastapi_users
from bimstitch_api.auth.logout import router as logout_router
from bimstitch_api.auth.manager import UserManager, get_user_manager
from bimstitch_api.auth.refresh import TokenPair
from bimstitch_api.auth.refresh import router as refresh_router
from bimstitch_api.auth.tokens import create_token
from bimstitch_api.config import get_settings
from bimstitch_api.schemas.user import UserCreate, UserRead, UserUpdate

LOGIN_RATE_LIMITER = RateLimiter(times=get_settings().rate_limit_login_per_min, seconds=60)
REGISTER_RATE_LIMITER = RateLimiter(times=get_settings().rate_limit_register_per_hour, seconds=3600)
FORGOT_RATE_LIMITER = RateLimiter(times=get_settings().rate_limit_forgot_per_hour, seconds=3600)


def build_auth_router() -> APIRouter:
    router = APIRouter()

    # --- registration ------------------------------------------------------
    register_router = APIRouter(prefix="/auth", tags=["auth"])

    @register_router.post(
        "/register",
        response_model=UserRead,
        status_code=status.HTTP_201_CREATED,
        dependencies=[Depends(REGISTER_RATE_LIMITER)],
    )
    async def register(
        request: Request,
        user_create: UserCreate,
        user_manager: UserManager = Depends(get_user_manager),
    ) -> UserRead:
        request.state.organization_name = user_create.organization_name
        try:
            created = await user_manager.create(user_create, safe=True, request=request)
        except UserAlreadyExists as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="REGISTER_USER_ALREADY_EXISTS",
            ) from exc
        return UserRead.model_validate(created, from_attributes=True)

    router.include_router(register_router)

    # --- login returning access + refresh ---------------------------------
    login_router = APIRouter(prefix="/auth/jwt", tags=["auth"])

    @login_router.post(
        "/login",
        response_model=TokenPair,
        dependencies=[Depends(LOGIN_RATE_LIMITER)],
    )
    async def login(
        credentials: OAuth2PasswordRequestForm = Depends(),
        user_manager: UserManager = Depends(get_user_manager),
    ) -> TokenPair:
        user = await user_manager.authenticate(credentials)
        if user is None or not user.is_active:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="LOGIN_BAD_CREDENTIALS",
            )
        if not user.is_verified:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="LOGIN_USER_NOT_VERIFIED",
            )
        return TokenPair(
            access_token=create_token(user.id, "access"),
            refresh_token=create_token(user.id, "refresh"),
        )

    router.include_router(login_router)

    # --- FastAPI Users built-in routers -----------------------------------
    router.include_router(fastapi_users.get_verify_router(UserRead), prefix="/auth", tags=["auth"])
    router.include_router(
        fastapi_users.get_reset_password_router(),
        prefix="/auth",
        tags=["auth"],
        dependencies=[Depends(FORGOT_RATE_LIMITER)],
    )
    router.include_router(
        fastapi_users.get_users_router(UserRead, UserUpdate),
        prefix="/users",
        tags=["users"],
    )

    # --- custom refresh + logout endpoints --------------------------------
    router.include_router(refresh_router)
    router.include_router(logout_router)

    return router
