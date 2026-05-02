import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

ExportFormat = Literal["FCP7-XML", "CMX3600-EDL", "MP4", "FFMPEG-SCRIPT"]


class ExportCreate(BaseModel):
    media_asset_id: uuid.UUID
    handle_padding_frames: int = Field(ge=0)
    format: ExportFormat


class ExportRead(BaseModel):
    id: uuid.UUID
    media_asset_id: uuid.UUID
    handle_padding_frames: int
    format: str
    payload: str
    created_at: datetime

    model_config = {"from_attributes": True}


class ExportRequest(BaseModel):
    """Request body for the POST /exports/generate endpoint."""
    media_id: uuid.UUID
    format: ExportFormat = "CMX3600-EDL"
    silence_threshold: float = Field(default=0.5, gt=0, description="Minimum gap in seconds to treat as a cut point")
    handle_padding_frames: int = Field(default=5, ge=0, description="Frames of safety added on each side of a cut")
    deleted_word_ids: list[str] = Field(default_factory=list, description="Final set of Word IDs deleted by the user")
