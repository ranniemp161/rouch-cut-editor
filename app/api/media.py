import asyncio
import uuid

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile, status
from sqlmodel import select

from app.api.deps import SessionDep
from app.models.media_asset import MediaAsset
from app.models.transcript import Transcript
from app.schemas.analysis import AnalysisResult, AnalysisSegment, WordItem
from app.services import analysis_service, media_service, semantic_analyzer

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

    # 1. ffprobe + Whisper
    transcript_data = await media_service.process_video(file)
    raw_words: list[dict] = transcript_data["word_level_data"]
    silence_threshold = transcript_data.get("silence_threshold_used", 0.5)
    silence_pad = 0.15

    words = []
    spoken_words = []
    word_id_counter = 1

    # 2. Stamp each word with a stable string ID and insert [SILENCE] words.
    for i, w in enumerate(raw_words):
        w["id"] = str(word_id_counter)
        word_id_counter += 1
        words.append(w)
        spoken_words.append(w)
        
        if i < len(raw_words) - 1:
            next_w = raw_words[i+1]
            gap_start = w["end"]
            gap_end = next_w["start"]
            if gap_end - gap_start > silence_threshold:
                padded_start = round(gap_start + silence_pad, 3)
                padded_end = round(gap_end - silence_pad, 3)
                if padded_end > padded_start:
                    words.append({
                        "id": f"sil-{word_id_counter}",
                        "word": "[SILENCE]",
                        "start": padded_start,
                        "end": padded_end,
                        "probability": 1.0,
                        "is_silence": True
                    })
                    word_id_counter += 1

    # 3. Semantic cut suggestions from Gemini (best-effort; non-fatal).
    #    Run in a thread-pool so the blocking SDK call doesn't stall the event loop.
    loop = asyncio.get_event_loop()
    ai_cut_ids: list[str] = await loop.run_in_executor(
        None, semantic_analyzer.analyze_transcript_for_mistakes, spoken_words
    )
    cut_set = set(ai_cut_ids)
    for w in words:
        w["ai_cut"] = w["id"] in cut_set

    # 4. Persist MediaAsset + Transcript in a single transaction.
    asset = MediaAsset(
        project_id=project_id,
        original_filename=file.filename,
        frame_rate=transcript_data["frame_rate"],
        total_frames=transcript_data["total_frames"],
        duration_seconds=transcript_data["duration_seconds"],
    )
    session.add(asset)
    session.flush()

    transcript = Transcript(
        media_asset_id=asset.id,
        word_level_data=words,
        silence_threshold_used=transcript_data["silence_threshold_used"],
    )
    session.add(transcript)
    session.commit()
    session.refresh(asset)
    session.refresh(transcript)

    return {
        "media_id": str(asset.id),
        "transcript_id": str(transcript.id),
        "ai_cut_count": len(ai_cut_ids),
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

    initial_deleted_ids = []
    for w in words:
        if w.get("ai_cut") or w.get("is_silence"):
            initial_deleted_ids.append(w.get("id"))

    return AnalysisResult(
        words=[WordItem(**w) for w in words],
        segments=[AnalysisSegment(**s) for s in raw_segments],
        duration_seconds=asset.duration_seconds,
        frame_rate=asset.frame_rate,
        total_frames=asset.total_frames,
        silence_threshold=silence_threshold,
        initial_deleted_ids=initial_deleted_ids,
    )
