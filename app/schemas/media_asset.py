import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class MediaAssetCreate(BaseModel):
    project_id: uuid.UUID
    original_filename: str
    frame_rate: float = Field(gt=0)
    total_frames: int = Field(gt=0)
    duration_seconds: float = Field(gt=0)


class MediaAssetRead(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    original_filename: str
    frame_rate: float
    total_frames: int
    duration_seconds: float
    created_at: datetime

    model_config = {"from_attributes": True}
