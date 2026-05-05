import os
import uuid

from fastapi import APIRouter, BackgroundTasks, HTTPException, Response, status
from fastapi.responses import FileResponse
from sqlmodel import select

from app.api.deps import SessionDep
from app.models.export import Export
from app.models.media_asset import MediaAsset
from app.models.transcript import Transcript
from app.schemas.export import ExportRequest
from app.services import export_service

router = APIRouter(prefix="/exports", tags=["exports"])

_MIME = {
    "FCP7-XML": "application/xml",
    "CMX3600-EDL": "text/plain",
}


@router.post("/generate", status_code=status.HTTP_200_OK)
def generate_export(request: ExportRequest, session: SessionDep) -> Response:
    """
    Generate an FCP7-XML or CMX3600-EDL export for a given media asset.

    Returns the raw payload so NLEs can consume it directly without unwrapping JSON.
    Default format is CMX3600-EDL (pass format="FCP7-XML" for Final Cut Pro).
    """
    transcript = session.exec(
        select(Transcript)
        .where(Transcript.media_asset_id == request.media_id)
        .order_by(Transcript.created_at.desc())  # type: ignore[arg-type]
    ).first()

    if not transcript:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=(
                f"No transcript found for media_id={request.media_id}. "
                "Upload the media file first via POST /media/upload."
            ),
        )

    asset = session.get(MediaAsset, request.media_id)
    if not asset:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Media asset {request.media_id} not found.",
        )

    content, media_type = export_service.generate(transcript, request, asset)

    return Response(content=content, media_type=media_type)


@router.post("/render/{media_id}", status_code=status.HTTP_200_OK)
def render_export(
    media_id: uuid.UUID,
    request: ExportRequest,
    background_tasks: BackgroundTasks,
    session: SessionDep,
) -> FileResponse:
    """
    Render a rough-cut MP4 using FFMPEG on the server and stream it back.

    The original video must have been uploaded via POST /media/upload (it is
    retained on disk at asset.file_path).  Pass the same ``deleted_word_ids``
    that the editor is showing so the cut points match the preview exactly.
    """
    asset = session.get(MediaAsset, media_id)
    if not asset:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Media asset not found")

    if not asset.file_path or not os.path.exists(asset.file_path):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Original video not found on server. Please re-upload the file.",
        )

    transcript = session.exec(
        select(Transcript)
        .where(Transcript.media_asset_id == media_id)
        .order_by(Transcript.created_at.desc())  # type: ignore[arg-type]
    ).first()

    if not transcript:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Transcript not found")

    word_data: list[dict] = transcript.word_level_data or []
    segments = export_service._build_segments(word_data, request, asset.frame_rate, asset.total_frames)

    if not segments:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="No segments to render after applying cuts",
        )

    out_path = export_service.render_to_file(asset, segments)
    background_tasks.add_task(os.unlink, out_path)

    stem = asset.original_filename.rsplit(".", 1)[0]
    return FileResponse(
        out_path,
        media_type="video/mp4",
        filename=f"roughcut_{stem}.mp4",
        background=background_tasks,
    )


@router.get("/{export_id}", tags=["exports"])
def get_export(export_id: uuid.UUID, session: SessionDep) -> dict:
    """Retrieve a previously persisted export record by ID."""
    export = session.get(Export, export_id)
    if not export:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Export not found")
    return {
        "id": str(export.id),
        "media_asset_id": str(export.media_asset_id),
        "format": export.format,
        "handle_padding_frames": export.handle_padding_frames,
        "payload": export.payload,
        "created_at": export.created_at.isoformat(),
    }
