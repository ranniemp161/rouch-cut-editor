import uuid
from datetime import datetime
from typing import TYPE_CHECKING, List, Optional

from sqlalchemy import Column, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlmodel import Field, Relationship, SQLModel

from app.models._base import created_at_field, uuid_pk_field

if TYPE_CHECKING:
    from app.models.export import Export
    from app.models.project import Project
    from app.models.transcript import Transcript


class MediaAsset(SQLModel, table=True):
    __tablename__ = "media_assets"

    id: uuid.UUID = uuid_pk_field()
    project_id: uuid.UUID = Field(
        sa_column=Column(UUID(as_uuid=True), ForeignKey("projects.id"), nullable=False, index=True),
    )
    original_filename: str = Field(nullable=False)
    frame_rate: float = Field(nullable=False)
    total_frames: int = Field(nullable=False)
    duration_seconds: float = Field(nullable=False)
    created_at: datetime = created_at_field()

    project: Optional["Project"] = Relationship(back_populates="media_assets")
    transcripts: List["Transcript"] = Relationship(
        back_populates="media_asset",
        sa_relationship_kwargs={"cascade": "all, delete-orphan"},
    )
    exports: List["Export"] = Relationship(
        back_populates="media_asset",
        sa_relationship_kwargs={"cascade": "all, delete-orphan"},
    )
