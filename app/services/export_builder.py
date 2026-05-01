"""
Export generation service (asset-centric entry point).

Converts a MediaAsset + its most recent Transcript into either an FCP7-XML
or CMX3600-EDL string payload. Used by background export jobs that already
have the asset and transcript loaded; the HTTP route uses export_service
directly for the streaming response path.
"""

from typing import TYPE_CHECKING

from app.services.export_service import _build_segments, _render_fcp7_xml
from app.services.transcription import find_silence_gaps
from app.utils.timecode import add_handles, frames_to_smpte, seconds_to_frame

if TYPE_CHECKING:
    from app.models.media_asset import MediaAsset
    from app.schemas.export import ExportRequest


def build_export(
    asset: "MediaAsset",
    transcript_id: str,
    word_data: list[dict],
    request: "ExportRequest",
) -> str:
    if request.format == "FCP7-XML":
        return _build_fcp7_xml(asset, transcript_id, word_data, request)
    if request.format == "CMX3600-EDL":
        return _build_cmx3600_edl(asset, word_data, request)
    raise ValueError(f"Unsupported export format: {request.format!r}")


def _build_fcp7_xml(
    asset: "MediaAsset",
    transcript_id: str,
    word_data: list[dict],
    request: "ExportRequest",
) -> str:
    """Generate a Final Cut Pro 7 XML export string."""
    from app.schemas.export import ExportRequest as _Req  # local to avoid circular import

    segments = _build_segments(word_data, request, asset.frame_rate, asset.total_frames)

    return _render_fcp7_xml(
        transcript_id=transcript_id,
        filename=asset.original_filename,
        frame_rate=asset.frame_rate,
        segments=segments,
        request=request,
        word_count=len(word_data),
    )


def _build_cmx3600_edl(
    asset: "MediaAsset",
    word_data: list[dict],
    request: "ExportRequest",
) -> str:
    """
    Generate a CMX 3600 EDL string.

    Each event line follows the canonical format:
        {event:03d}  AX  V  C  {src_in} {src_out} {rec_in} {rec_out}

    Timecodes are SMPTE HH:MM:SS:FF at the asset's nominal frame rate.
    """
    segments = _build_segments(word_data, request, asset.frame_rate, asset.total_frames)

    fps = asset.frame_rate
    stem = asset.original_filename.rsplit(".", 1)[0]

    lines: list[str] = [f"TITLE: {stem}", "FCM: NON-DROP FRAME", ""]

    rec_cursor = 0
    for i, (in_f, out_f) in enumerate(segments, start=1):
        duration = out_f - in_f
        rec_in = rec_cursor
        rec_out = rec_cursor + duration
        rec_cursor = rec_out

        src_in_tc = frames_to_smpte(in_f, fps)
        src_out_tc = frames_to_smpte(out_f, fps)
        rec_in_tc = frames_to_smpte(rec_in, fps)
        rec_out_tc = frames_to_smpte(rec_out, fps)

        lines.append(f"{i:03d}  AX  V  C  {src_in_tc} {src_out_tc} {rec_in_tc} {rec_out_tc}")

    return "\n".join(lines)
