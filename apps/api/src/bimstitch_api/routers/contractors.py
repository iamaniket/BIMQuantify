from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from bimstitch_api.auth.fastapi_users import current_verified_user
from bimstitch_api.models.contractor import Contractor
from bimstitch_api.models.user import User
from bimstitch_api.schemas.contractor import (
    ContractorCreate,
    ContractorRead,
    ContractorUpdate,
)
from bimstitch_api.tenancy import get_tenant_session

router = APIRouter(prefix="/contractors", tags=["contractors"])


async def _load_contractor_or_404(session: AsyncSession, contractor_id: UUID) -> Contractor:
    contractor = (
        await session.execute(select(Contractor).where(Contractor.id == contractor_id))
    ).scalar_one_or_none()
    if contractor is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="CONTRACTOR_NOT_FOUND"
        )
    return contractor


@router.post("", response_model=ContractorRead, status_code=status.HTTP_201_CREATED)
async def create_contractor(
    payload: ContractorCreate,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),
) -> Contractor:
    contractor = Contractor(
        organization_id=user.organization_id,
        name=payload.name,
        kvk_number=payload.kvk_number,
        contact_email=payload.contact_email,
        contact_phone=payload.contact_phone,
    )
    session.add(contractor)
    try:
        await session.flush()
    except IntegrityError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="CONTRACTOR_NAME_CONFLICT"
        ) from exc
    await session.refresh(contractor)
    return contractor


@router.get("", response_model=list[ContractorRead])
async def list_contractors(
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),  # noqa: ARG001 (auth gate)
) -> list[Contractor]:
    result = await session.execute(select(Contractor).order_by(Contractor.name))
    return list(result.scalars().all())


@router.get("/{contractor_id}", response_model=ContractorRead)
async def get_contractor(
    contractor_id: UUID,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),  # noqa: ARG001 (auth gate)
) -> Contractor:
    return await _load_contractor_or_404(session, contractor_id)


@router.patch("/{contractor_id}", response_model=ContractorRead)
async def update_contractor(
    contractor_id: UUID,
    payload: ContractorUpdate,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),  # noqa: ARG001 (auth gate)
) -> Contractor:
    contractor = await _load_contractor_or_404(session, contractor_id)
    updates = payload.model_dump(exclude_unset=True)
    for field, value in updates.items():
        setattr(contractor, field, value)
    try:
        await session.flush()
    except IntegrityError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="CONTRACTOR_NAME_CONFLICT"
        ) from exc
    await session.refresh(contractor)
    return contractor


@router.delete("/{contractor_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_contractor(
    contractor_id: UUID,
    session: AsyncSession = Depends(get_tenant_session),
    user: User = Depends(current_verified_user),  # noqa: ARG001 (auth gate)
) -> Response:
    contractor = await _load_contractor_or_404(session, contractor_id)
    await session.delete(contractor)
    await session.flush()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
