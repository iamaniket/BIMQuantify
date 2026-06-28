"""Pydantic schemas for finding discussion comments.

``FindingCommentRead`` is built explicitly per-row in the router (not via
``from_attributes``) because ``actor_name``/``actor_email`` come from a join on
``public.users`` and ``mentions`` from the link table — the same shape the
finding history endpoint uses. The 4000-char cap mirrors ``Finding.description``
and the BCF comment body.
"""

from datetime import datetime
from typing import Annotated
from uuid import UUID

from pydantic import BaseModel, StringConstraints

# Strip surrounding whitespace, THEN enforce 1..4000 — so a whitespace-only body
# collapses to "" and trips min_length (422). 4000 mirrors Finding.description /
# the BCF comment body.
CommentText = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=4000)
]


class FindingCommentCreate(BaseModel):
    # @mentions are parsed from the `@[Name](uuid)` tokens inside `text`
    # server-side (the server is the source of truth) — the client never sends a
    # separate id list.
    text: CommentText


class FindingCommentUpdate(BaseModel):
    text: CommentText


class MentionedUser(BaseModel):
    """A project member referenced by an @mention in a comment."""

    user_id: UUID
    name: str | None


class FindingCommentRead(BaseModel):
    id: UUID
    finding_id: UUID
    comment_text: str
    author: str
    date: datetime
    modified_author: str | None
    modified_date: datetime | None
    created_by_user_id: UUID | None
    # Resolved from `public.users` (null when the author row was deleted).
    actor_name: str | None
    actor_email: str | None
    # Validated mention targets (project members only).
    mentions: list[MentionedUser] = []
    created_at: datetime
    updated_at: datetime
