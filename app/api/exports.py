import uuid

from fastapi import APIRouter, HTTPException, Response, status
from sqlmodel import select

from app.api.deps import SessionDep
from app.models.export import Export
from app.models.media_asset import MediaAsset
from app.models.transcript import Transcript
from app.schemas.export import ExportRequest
from app.services import export_service

router = APIRouter(prefix="/exports", tags=["exports"])


@router.post("/generate", status_code=status.HTTP_200_OK)
def generate_export(request: ExportRequest, session: SessionDep) -> Response:
    """
    Generate an FCP7-XML export for a given media asset.

    Fetches the most recent Transcript and its parent MediaAsset, applies
    silence detection and handle padding via the export service, and returns
    the raw XML payload directly so NLEs can consume it without unwrapping JSON.
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

    xml_string = export_service.generate_xml(transcript, request, asset)

    return Response(content=xml_string, media_type="application/xml")


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
