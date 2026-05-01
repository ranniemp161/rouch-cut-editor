import uuid

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status
from sqlmodel import select

from app.api.deps import SessionDep
from app.models.media_asset import MediaAsset
from app.models.transcript import Transcript
from app.services import media_service

router = APIRouter(prefix="/media", tags=["media"])


@router.post("/upload", status_code=status.HTTP_201_CREATED)
async def upload_media(
    session: SessionDep,
    project_id: uuid.UUID = Form(..., description="Project this asset belongs to"),
    file: UploadFile = File(..., description="Raw video file (mp4, mov, mxf …)"),
) -> dict:
    """
    Ingest a video file into a project.

    Delegates media probing and transcription to media_service.process_video(),
    then persists a MediaAsset and its linked Transcript in a single transaction.
    Returns both IDs so the client can immediately request an export.
    """
    if not file.filename:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Uploaded file must have a filename",
        )

    # --- service call (mocked; will run ffprobe + Whisper in production) ---
    transcript_data = await media_service.process_video(file)

    # --- persist MediaAsset ---
    asset = MediaAsset(
        project_id=project_id,
        original_filename=file.filename,
        frame_rate=transcript_data["frame_rate"],
        total_frames=transcript_data["total_frames"],
        duration_seconds=transcript_data["duration_seconds"],
    )
    session.add(asset)
    session.flush()  # write asset to get asset.id without committing yet

    # --- persist Transcript (linked to asset in same transaction) ---
    transcript = Transcript(
        media_asset_id=asset.id,
        word_level_data=transcript_data["word_level_data"],
        silence_threshold_used=transcript_data["silence_threshold_used"],
    )
    session.add(transcript)
    session.commit()
    session.refresh(asset)
    session.refresh(transcript)

    return {
        "media_id": str(asset.id),
        "transcript_id": str(transcript.id),
    }


@router.get("/{asset_id}", tags=["media"])
def get_media_asset(asset_id: uuid.UUID, session: SessionDep) -> dict:
    """Return media asset metadata and its linked transcript ID."""
    asset = session.get(MediaAsset, asset_id)
    if not asset:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Media asset not found")

    transcript = session.exec(
        select(Transcript).where(Transcript.media_asset_id == asset_id)
    ).first()

    return {
        "id": str(asset.id),
        "project_id": str(asset.project_id),
        "original_filename": asset.original_filename,
        "frame_rate": asset.frame_rate,
        "total_frames": asset.total_frames,
        "duration_seconds": asset.duration_seconds,
        "transcript_id": str(transcript.id) if transcript else None,
        "created_at": asset.created_at.isoformat(),
    }
