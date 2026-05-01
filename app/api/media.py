import uuid

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile, status
from sqlmodel import select

from app.api.deps import SessionDep
from app.models.media_asset import MediaAsset
from app.models.transcript import Transcript
from app.schemas.analysis import AnalysisResult, AnalysisSegment, WordItem
from app.services import analysis_service, media_service

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


@router.delete("/{asset_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_media_asset(asset_id: uuid.UUID, session: SessionDep) -> None:
    """
    Delete a media asset and its dependent rows (transcripts, exports) via
    SQLAlchemy cascade. Frees the Neon storage used by this clip's transcript.
    """
    asset = session.get(MediaAsset, asset_id)
    if not asset:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Media asset not found")
    session.delete(asset)
    session.commit()


@router.get("/{asset_id}/analysis", response_model=AnalysisResult)
def get_analysis(
    asset_id: uuid.UUID,
    session: SessionDep,
    silence_threshold: float = Query(default=0.5, gt=0, description="Minimum silence gap in seconds to treat as a cut point"),
) -> AnalysisResult:
    """
    Compute and return cut/keep segments for a media asset.

    Pure compute — no re-processing. Reads the stored word-level transcript,
    detects silence gaps and consecutive repetitions, and returns time-ordered
    segments the client can render as a toggleable transcript view.

    Change silence_threshold to re-analyse without re-uploading.
    """
    asset = session.get(MediaAsset, asset_id)
    if not asset:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Media asset not found")

    transcript = session.exec(
        select(Transcript)
        .where(Transcript.media_asset_id == asset_id)
        .order_by(Transcript.created_at.desc())  # type: ignore[arg-type]
    ).first()

    if not transcript:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Transcript not found — upload the media first")

    words: list[dict] = transcript.word_level_data or []

    raw_segments = analysis_service.analyze_transcript(words, asset.duration_seconds, silence_threshold)

    return AnalysisResult(
        words=[WordItem(**w) for w in words],
        segments=[AnalysisSegment(**s) for s in raw_segments],
        duration_seconds=asset.duration_seconds,
        frame_rate=asset.frame_rate,
        total_frames=asset.total_frames,
        silence_threshold=silence_threshold,
    )
