import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class TranscriptCreate(BaseModel):
    media_asset_id: uuid.UUID
    word_level_data: Any
    silence_threshold_used: float = Field(gt=0)


class TranscriptRead(BaseModel):
    id: uuid.UUID
    media_asset_id: uuid.UUID
    word_level_data: Any
    silence_threshold_used: float
    created_at: datetime

    model_config = {"from_attributes": True}
