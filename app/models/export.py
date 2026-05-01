import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Optional

from sqlalchemy import Column, ForeignKey, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlmodel import Field, Relationship, SQLModel

from app.models._base import created_at_field, uuid_pk_field

if TYPE_CHECKING:
    from app.models.media_asset import MediaAsset


class Export(SQLModel, table=True):
    __tablename__ = "exports"

    id: uuid.UUID = uuid_pk_field()
    media_asset_id: uuid.UUID = Field(
        sa_column=Column(UUID(as_uuid=True), ForeignKey("media_assets.id"), nullable=False, index=True),
    )
    handle_padding_frames: int = Field(nullable=False)
    format: str = Field(nullable=False)
    payload: str = Field(sa_column=Column(Text, nullable=False))
    created_at: datetime = created_at_field()

    media_asset: Optional["MediaAsset"] = Relationship(back_populates="exports")
