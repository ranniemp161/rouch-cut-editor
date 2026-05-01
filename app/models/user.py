import uuid
from datetime import datetime
from typing import TYPE_CHECKING, List

from sqlmodel import Field, Relationship, SQLModel

from app.models._base import created_at_field, uuid_pk_field

if TYPE_CHECKING:
    from app.models.project import Project


class User(SQLModel, table=True):
    __tablename__ = "users"

    id: uuid.UUID = uuid_pk_field()
    client_name: str = Field(nullable=False, index=True)
    api_key_hash: str = Field(nullable=False, unique=True, index=True)
    created_at: datetime = created_at_field()

    projects: List["Project"] = Relationship(
        back_populates="user",
        sa_relationship_kwargs={"cascade": "all, delete-orphan"},
    )
