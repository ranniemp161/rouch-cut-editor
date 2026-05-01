import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Any, Optional

from sqlalchemy import Column, ForeignKey
from sqlalchemy.dialects.postgresql import JSON, UUID
from sqlmodel import Field, Relationship, SQLModel

from app.models._base import created_at_field, uuid_pk_field

if TYPE_CHECKING:
    from app.models.media_asset import MediaAsset


class Transcript(SQLModel, table=True):
    __tablename__ = "transcripts"

    id: uuid.UUID = uuid_pk_field()
    media_asset_id: uuid.UUID = Field(
        sa_column=Column(UUID(as_uuid=True), ForeignKey("media_assets.id"), nullable=False, index=True),
    )
    word_level_data: Any = Field(sa_column=Column(JSON, nullable=False))
    silence_threshold_used: float = Field(nullable=False)
    created_at: datetime = created_at_field()

    media_asset: Optional["MediaAsset"] = Relationship(back_populates="transcripts")
