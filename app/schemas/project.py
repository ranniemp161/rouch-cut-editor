import uuid
from datetime import datetime

from pydantic import BaseModel


class ProjectCreate(BaseModel):
    user_id: uuid.UUID
    name: str


class ProjectRead(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    name: str
    created_at: datetime

    model_config = {"from_attributes": True}


# Alias used as the canonical HTTP response shape for project endpoints.
ProjectResponse = ProjectRead
