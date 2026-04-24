from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from bimquantify_api.auth.tokens import TokenError, create_token, decode_token
from bimquantify_api.db import get_async_session
from bimquantify_api.models.user import User

router = APIRouter(prefix="/auth/jwt", tags=["auth"])


class RefreshRequest(BaseModel):
    refresh_token: str


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class AccessToken(BaseModel):
    access_token: str
    token_type: str = "bearer"


@router.post("/refresh", response_model=AccessToken)
async def refresh_access_token(
    payload: RefreshRequest,
    session: AsyncSession = Depends(get_async_session),
) -> AccessToken:
    try:
        user_id = decode_token(payload.refresh_token, expected_type="refresh")
    except TokenError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc

    user = await session.get(User, user_id)
    if user is None or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="user no longer active"
        )

    return AccessToken(access_token=create_token(user.id, "access"))
