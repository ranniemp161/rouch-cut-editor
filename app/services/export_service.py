"""
Export generation service.

Consumes word-level transcript data and an ExportRequest to produce a
standards-compliant FCP7-XML or CMX3600-EDL string that any NLE can import.

Algorithm:
    1. Identify silence gaps between consecutive words using silence_threshold.
    2. Invert the gaps into keep-segments (the speech regions between gaps).
    3. Convert each segment's start/end seconds to frame numbers.
    4. Expand each segment by handle_padding_frames, clamped to clip bounds.
    5. Render segments as <clipitem> blocks (XML) or event lines (EDL).
"""

from typing import TYPE_CHECKING

from app.services.transcription import find_silence_gaps
from app.utils.timecode import add_handles, frames_to_smpte, seconds_to_frame

if TYPE_CHECKING:
    from app.models.media_asset import MediaAsset
    from app.models.transcript import Transcript
    from app.schemas.export import ExportRequest


def generate(
    transcript: "Transcript",
    request: "ExportRequest",
    asset: "MediaAsset",
) -> tuple[str, str]:
    """
    Build and return (content, media_type) for the requested export format.
    """
    word_data: list[dict] = transcript.word_level_data or []
    segments = _build_segments(word_data, request, asset.frame_rate, asset.total_frames)

    if request.format == "CMX3600-EDL":
        content = _render_edl(asset, segments)
        return content, "text/plain"

    content = _render_fcp7_xml(
        transcript_id=str(transcript.id),
        filename=asset.original_filename,
        frame_rate=asset.frame_rate,
        segments=segments,
        request=request,
        word_count=len(word_data),
    )
    return content, "application/xml"


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _build_segments(
    word_data: list[dict],
    request: "ExportRequest",
    frame_rate: float,
    total_frames: int,
) -> list[tuple[int, int]]:
    """
    Convert word timestamps into a list of (in_frame, out_frame) keep-segments.
    """
    if not word_data:
        return [(0, total_frames - 1)]

    gaps = find_silence_gaps(word_data, request.silence_threshold)
    gap_set: set[tuple[float, float]] = set(gaps)

    runs: list[tuple[float, float]] = []
    seg_start = word_data[0]["start"]

    for prev, curr in zip(word_data, word_data[1:]):
        gap = (prev["end"], curr["start"])
        if gap in gap_set:
            runs.append((seg_start, prev["end"]))
            seg_start = curr["start"]

    runs.append((seg_start, word_data[-1]["end"]))

    segments: list[tuple[int, int]] = []
    for start_s, end_s in runs:
        in_f = seconds_to_frame(start_s, frame_rate)
        out_f = seconds_to_frame(end_s, frame_rate)
        in_f, out_f = add_handles(in_f, out_f, request.handle_padding_frames, total_frames)
        segments.append((in_f, out_f))

    return segments


def _render_fcp7_xml(
    transcript_id: str,
    filename: str,
    frame_rate: float,
    segments: list[tuple[int, int]],
    request: "ExportRequest",
    word_count: int,
) -> str:
    timebase = round(frame_rate)
    clip_items: list[str] = []
    record_cursor = 0

    for i, (in_f, out_f) in enumerate(segments, start=1):
        duration = out_f - in_f
        rec_start = record_cursor
        rec_end = record_cursor + duration
        record_cursor = rec_end

        clip_items.append(
            f"          <clipitem id='clipitem-{i}'>\n"
            f"            <name>{filename} [{i}]</name>\n"
            f"            <duration>{duration}</duration>\n"
            f"            <start>{rec_start}</start>\n"
            f"            <end>{rec_end}</end>\n"
            f"            <in>{in_f}</in>\n"
            f"            <out>{out_f}</out>\n"
            f"          </clipitem>"
        )

    track_content = "\n".join(clip_items)

    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<!DOCTYPE xmeml>\n'
        '<xmeml version="5">\n'
        "  <sequence>\n"
        f"    <name>{filename}</name>\n"
        f"    <!-- silence_threshold={request.silence_threshold}s  "
        f"handle_padding={request.handle_padding_frames}fr  "
        f"words={word_count}  segments={len(segments)} -->\n"
        f"    <timebase>{timebase}</timebase>\n"
        "    <ntsc>FALSE</ntsc>\n"
        "    <media>\n"
        "      <video>\n"
        "        <track>\n"
        f"{track_content}\n"
        "        </track>\n"
        "      </video>\n"
        "    </media>\n"
        "  </sequence>\n"
        "</xmeml>"
    )


def _render_edl(asset: "MediaAsset", segments: list[tuple[int, int]]) -> str:
    """
    CMX 3600 EDL.
    Each line: {event:03d}  AX  V  C  {src_in} {src_out} {rec_in} {rec_out}
    """
    fps = asset.frame_rate
    stem = asset.original_filename.rsplit(".", 1)[0]

    lines = [f"TITLE: {stem}", "FCM: NON-DROP FRAME", ""]

    rec_cursor = 0
    for i, (in_f, out_f) in enumerate(segments, start=1):
        duration = out_f - in_f
        rec_in = rec_cursor
        rec_out = rec_cursor + duration
        rec_cursor = rec_out

        lines.append(
            f"{i:03d}  AX  V  C  "
            f"{frames_to_smpte(in_f, fps)} {frames_to_smpte(out_f, fps)} "
            f"{frames_to_smpte(rec_in, fps)} {frames_to_smpte(rec_out, fps)}"
        )

    return "\n".join(lines)
