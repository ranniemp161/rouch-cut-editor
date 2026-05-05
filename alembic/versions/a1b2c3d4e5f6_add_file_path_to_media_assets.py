"""add file_path to media_assets

Revision ID: a1b2c3d4e5f6
Revises: c6b0077d8f20
Create Date: 2026-05-02 20:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel

revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, None] = 'c6b0077d8f20'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('media_assets', sa.Column('file_path', sqlmodel.sql.sqltypes.AutoString(), nullable=True))


def downgrade() -> None:
    op.drop_column('media_assets', 'file_path')
