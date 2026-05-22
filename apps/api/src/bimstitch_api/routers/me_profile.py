"""Endpoints for the current user's profile.

Thin layer — lets the user view/update their own name and avatar without
going through the FastAPI Users ``/users/me`` machinery (which we don't
expose to the portal).
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, UploadFile, status
from pydantic import BaseModel
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from bimstitch_api.auth.fastapi_users import current_active_user
from bimstitch_api.db import get_async_session
from bimstitch_api.models.user import User
from bimstitch_api.storage import StorageBackend, get_storage

router = APIRouter(prefix="/me", tags=["profile"])

AVATAR_MAX_BYTES = 2 * 1024 * 1024  # 2 MB
AVATAR_ALLOWED_TYPES = {"image/png", "image/jpeg", "image/webp"}
AVATAR_EXT = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}


class ProfileUpdate(BaseModel):
    full_name: str | None = None


class ProfileRead(BaseModel):
    full_name: str | None
    email: str
    avatar_url: str | None


class AvatarResponse(BaseModel):
    avatar_url: str


@router.patch("/profile", response_model=ProfileRead)
async def update_profile(
    payload: ProfileUpdate,
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_async_session),
) -> ProfileRead:
    values: dict[str, object] = {}
    if payload.full_name is not None:
        values["full_name"] = payload.full_name.strip() or None

    if values:
        await session.execute(
            update(User).where(User.id == user.id).values(**values)
        )
        await session.commit()
        await session.refresh(user)

    return ProfileRead(
        full_name=user.full_name,
        email=user.email,
        avatar_url=user.avatar_url,
    )


@router.put("/avatar", response_model=AvatarResponse)
async def upload_avatar(
    file: UploadFile,
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_async_session),
    storage: StorageBackend = Depends(get_storage),
) -> AvatarResponse:
    content_type = file.content_type or ""
    if content_type not in AVATAR_ALLOWED_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="AVATAR_INVALID_TYPE",
        )

    data = await file.read()
    if len(data) > AVATAR_MAX_BYTES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="AVATAR_TOO_LARGE",
        )

    ext = AVATAR_EXT[content_type]
    key = f"avatars/{user.id}.{ext}"
    await storage.put_object(key, content_type, data)

    await session.execute(
        update(User).where(User.id == user.id).values(avatar_url=key)
    )
    await session.commit()

    return AvatarResponse(avatar_url=key)


@router.delete("/avatar", status_code=status.HTTP_204_NO_CONTENT)
async def delete_avatar(
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_async_session),
    storage: StorageBackend = Depends(get_storage),
) -> None:
    if user.avatar_url is None:
        return
    try:
        await storage.delete_object(user.avatar_url)
    except Exception:
        pass
    await session.execute(
        update(User).where(User.id == user.id).values(avatar_url=None)
    )
    await session.commit()


@router.get("/avatar-url", response_model=AvatarResponse)
async def get_avatar_url(
    user: User = Depends(current_active_user),
    storage: StorageBackend = Depends(get_storage),
) -> AvatarResponse:
    if user.avatar_url is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="NO_AVATAR",
        )
    presigned = await storage.presigned_get_url(user.avatar_url, "avatar")
    return AvatarResponse(avatar_url=presigned)
