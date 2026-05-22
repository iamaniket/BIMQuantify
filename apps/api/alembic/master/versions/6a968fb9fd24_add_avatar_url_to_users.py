"""add avatar_url to users

Revision ID: 6a968fb9fd24
Revises: 0001_master
Create Date: 2026-05-22 10:38:04.985903

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '6a968fb9fd24'
down_revision: Union[str, None] = '0001_master'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('users', sa.Column('avatar_url', sa.String(length=512), nullable=True))


def downgrade() -> None:
    op.drop_column('users', 'avatar_url')
