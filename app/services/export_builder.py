"""
Export generation service.

Converts a MediaAsset + cut list into either an FCP7-XML or CMX3600-EDL
string payload that an NLE (Premiere, DaVinci, Avid) can import directly.

Handle padding adds *n* frames of safety before the first word and after
the last word in each keep-segment, preventing hard jump-cuts.
"""

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.models.media_asset import MediaAsset


def build_export(
    asset: "MediaAsset",
    format: str,
    handle_padding_frames: int,
) -> str:
    """
    Build and return the raw XML or EDL string for *asset*.

    The function should:
    1. Query the most recent Transcript for this asset.
    2. Call transcription.find_silence_gaps() to locate cut points.
    3. Convert gap timestamps to frame numbers via utils.timecode.seconds_to_frame().
    4. Apply handle_padding_frames to each segment boundary.
    5. Delegate to _build_fcp7_xml() or _build_cmx3600_edl() based on *format*.
    """
    if format == "FCP7-XML":
        return _build_fcp7_xml(asset, handle_padding_frames)
    if format == "CMX3600-EDL":
        return _build_cmx3600_edl(asset, handle_padding_frames)
    raise ValueError(f"Unsupported export format: {format}")


def _build_fcp7_xml(asset: "MediaAsset", handle_padding_frames: int) -> str:
    """
    Generate a Final Cut Pro 7 XML export string.

    Structure:
        <xmeml version="5">
          <sequence>
            <name>{asset.original_filename}</name>
            <timebase>{int(asset.frame_rate)}</timebase>
            <media>
              <video>
                <track>
                  <!-- one <clipitem> per keep-segment -->
                </track>
              </video>
            </media>
          </sequence>
        </xmeml>
    """
    raise NotImplementedError("FCP7-XML generation not yet implemented")


def _build_cmx3600_edl(asset: "MediaAsset", handle_padding_frames: int) -> str:
    """
    Generate a CMX 3600 EDL string.

    Each cut line follows the format:
        {event:03d}  AX  V  C  {src_in} {src_out} {rec_in} {rec_out}

    Timecodes are formatted as HH:MM:SS:FF using utils.timecode.frames_to_smpte().
    """
    raise NotImplementedError("CMX3600-EDL generation not yet implemented")
