"""Pydantic schemas for deadline notification settings CRUD.

Read, update, and effective (merged) representations.
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


class DeadlineNotificationSettingsRead(BaseModel):
    """DB row representation."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    project_id: UUID | None
    deadline_type: str
    reminder_days: list[int]
    recipient_roles: list[str]
    enabled: bool
    created_at: datetime
    updated_at: datetime


class DeadlineNotificationSettingsUpdate(BaseModel):
    """Partial update body for PATCH/PUT endpoints.

    All fields are optional — only provided fields are updated. The
    ``reminder_days`` list is validated for sanity: no negatives, no
    duplicates, max 10 items, sorted descending on output.
    """

    reminder_days: list[int] | None = Field(
        default=None, max_length=10, description="Reminder tiers in days (e.g. [14, 7, 3, 1])"
    )
    recipient_roles: list[str] | None = Field(
        default=None, description='Project roles to notify (e.g. ["owner", "editor"])'
    )
    enabled: bool | None = None

    @field_validator("reminder_days")
    @classmethod
    def validate_reminder_days(cls, v: list[int] | None) -> list[int] | None:
        if v is None:
            return v
        if not v:
            raise ValueError("reminder_days must not be empty")
        for day in v:
            if day < 0:
                raise ValueError("reminder_days values must be >= 0")
        if len(v) != len(set(v)):
            raise ValueError("reminder_days must not contain duplicates")
        # Sort descending for consistency.
        return sorted(v, reverse=True)

    @field_validator("recipient_roles")
    @classmethod
    def validate_recipient_roles(cls, v: list[str] | None) -> list[str] | None:
        if v is None:
            return v
        if not v:
            raise ValueError("recipient_roles must not be empty")
        from bimstitch_api.models.project_member import ProjectRole

        valid = {r.value for r in ProjectRole}
        for role in v:
            if role not in valid:
                raise ValueError(f"Invalid role '{role}'; must be one of {sorted(valid)}")
        return v


class EffectiveDeadlineNotificationSettings(BaseModel):
    """Merged result: DB override (if any) on top of jurisdiction defaults.

    ``source`` tells the consumer where the values came from so the portal
    can render "inherited from org defaults" vs "project override" vs
    "jurisdiction default".
    """

    deadline_type: str
    label: str
    reminder_days: list[int]
    recipient_roles: list[str]
    enabled: bool
    source: str  # "jurisdiction_default" | "org_default" | "project_override"
    legal_reference: str | None = None
