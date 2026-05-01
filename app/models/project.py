import uuid
from datetime import datetime
from typing import TYPE_CHECKING, List, Optional

from sqlalchemy import Column, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlmodel import Field, Relationship, SQLModel

from app.models._base import created_at_field, uuid_pk_field

if TYPE_CHECKING:
    from app.models.media_asset import MediaAsset
    from app.models.user import User


class Project(SQLModel, table=True):
    __tablename__ = "projects"

    id: uuid.UUID = uuid_pk_field()
    user_id: uuid.UUID = Field(
        sa_column=Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True),
    )
    name: str = Field(nullable=False)
    created_at: datetime = created_at_field()

    user: Optional["User"] = Relationship(back_populates="projects")
    media_assets: List["MediaAsset"] = Relationship(
        back_populates="project",
        sa_relationship_kwargs={"cascade": "all, delete-orphan"},
    )
