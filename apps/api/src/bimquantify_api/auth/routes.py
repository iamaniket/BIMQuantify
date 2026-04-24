from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordRequestForm
from fastapi_users.exceptions import UserAlreadyExists

from bimquantify_api.auth.fastapi_users import fastapi_users
from bimquantify_api.auth.manager import UserManager, get_user_manager
from bimquantify_api.auth.refresh import TokenPair
from bimquantify_api.auth.refresh import router as refresh_router
from bimquantify_api.auth.tokens import create_token
from bimquantify_api.schemas.user import UserCreate, UserRead, UserUpdate


def build_auth_router() -> APIRouter:
    router = APIRouter()

    # --- registration ------------------------------------------------------
    register_router = APIRouter(prefix="/auth", tags=["auth"])

    @register_router.post(
        "/register",
        response_model=UserRead,
        status_code=status.HTTP_201_CREATED,
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

    @login_router.post("/login", response_model=TokenPair)
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
    router.include_router(fastapi_users.get_reset_password_router(), prefix="/auth", tags=["auth"])
    router.include_router(
        fastapi_users.get_users_router(UserRead, UserUpdate),
        prefix="/users",
        tags=["users"],
    )

    # --- custom refresh endpoint ------------------------------------------
    router.include_router(refresh_router)

    return router
