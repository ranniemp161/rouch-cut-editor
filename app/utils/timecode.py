"""
SMPTE timecode arithmetic.

All functions operate on zero-based frame counts. Drop-frame timecode
(29.97 / 59.94 fps) is supported via the drop_frame flag — non-drop is
the default for film/cinema rates (23.976, 24, 25).
"""

from math import floor


def frames_to_smpte(frame_number: int, frame_rate: float, drop_frame: bool = False) -> str:
    """
    Convert a zero-based *frame_number* to a SMPTE timecode string HH:MM:SS:FF.

    Drop-frame calculation follows the SMPTE 12M standard:
    frames are dropped from the count (not from the video) at the start of
    each minute, except every tenth minute, to keep wall-clock sync at
    29.97 / 59.94 fps.
    """
    fps = round(frame_rate)

    if drop_frame and fps in (30, 60):
        drop = 2 if fps == 30 else 4
        frames_per_10min = fps * 600 - drop * 9
        d, m = divmod(frame_number, frames_per_10min)
        frame_number += drop * 9 * d
        if m > drop:
            frame_number += drop * ((m - drop) // (fps * 60 - drop))

    ff = frame_number % fps
    total_seconds = frame_number // fps
    ss = total_seconds % 60
    total_minutes = total_seconds // 60
    mm = total_minutes % 60
    hh = total_minutes // 60

    sep = ";" if drop_frame else ":"
    return f"{hh:02d}:{mm:02d}:{ss:02d}{sep}{ff:02d}"


def smpte_to_frames(timecode: str, frame_rate: float, drop_frame: bool = False) -> int:
    """
    Parse a SMPTE timecode string and return a zero-based frame count.

    Accepts both drop-frame (semicolons) and non-drop (colons) separators;
    the *drop_frame* flag controls the arithmetic, not the parsing.
    """
    clean = timecode.replace(";", ":").replace(",", ":")
    parts = clean.split(":")
    if len(parts) != 4:
        raise ValueError(f"Invalid timecode: {timecode!r}")

    hh, mm, ss, ff = (int(p) for p in parts)
    fps = round(frame_rate)
    total_frames = (hh * 3600 + mm * 60 + ss) * fps + ff

    if drop_frame and fps in (30, 60):
        drop = 2 if fps == 30 else 4
        total_minutes = hh * 60 + mm
        total_frames -= drop * (total_minutes - total_minutes // 10)

    return total_frames


def seconds_to_frame(seconds: float, frame_rate: float) -> int:
    """Wall-clock seconds → nearest zero-based frame index."""
    return floor(seconds * frame_rate)


def frame_to_seconds(frame_number: int, frame_rate: float) -> float:
    """Zero-based frame index → wall-clock seconds."""
    return frame_number / frame_rate


def add_handles(
    in_frame: int,
    out_frame: int,
    handle_frames: int,
    total_frames: int,
) -> tuple[int, int]:
    """
    Expand a cut segment by *handle_frames* on each side, clamped to
    [0, total_frames - 1] so we never reference frames outside the clip.
    """
    return (
        max(0, in_frame - handle_frames),
        min(total_frames - 1, out_frame + handle_frames),
    )
