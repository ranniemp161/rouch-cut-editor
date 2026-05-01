"""
FFmpeg/ffprobe integration for media metadata extraction.

Call ffprobe as a subprocess to extract stream metadata from a video file,
then parse the JSON output into typed values. All frame math is done in
integer arithmetic to avoid floating-point drift at high frame counts.
"""

from dataclasses import dataclass
from fractions import Fraction


@dataclass
class MediaInfo:
    frame_rate: float
    total_frames: int
    duration_seconds: float


def probe_media(file_path: str) -> MediaInfo:
    """
    Run ffprobe on *file_path* and return frame rate, total frames, and duration.

    Implementation outline:
        import subprocess, json
        result = subprocess.run(
            ["ffprobe", "-v", "quiet", "-print_format", "json",
             "-show_streams", "-select_streams", "v:0", file_path],
            capture_output=True, text=True, check=True,
        )
        stream = json.loads(result.stdout)["streams"][0]

        # frame_rate: prefer r_frame_rate over avg_frame_rate for VFR safety
        fps_fraction = Fraction(stream["r_frame_rate"])
        frame_rate = float(fps_fraction)

        # total_frames: nb_frames is set by the muxer; fall back to duration math
        total_frames = int(stream.get("nb_frames") or
                           round(float(stream["duration"]) * frame_rate))
        duration_seconds = float(stream["duration"])

        return MediaInfo(frame_rate, total_frames, duration_seconds)
    """
    raise NotImplementedError("probe_media requires ffprobe installed and accessible on PATH")


def frame_to_seconds(frame_number: int, frame_rate: float) -> float:
    """Convert a zero-based frame index to wall-clock seconds."""
    return frame_number / frame_rate


def seconds_to_frame(seconds: float, frame_rate: float) -> int:
    """Convert wall-clock seconds to the nearest zero-based frame index."""
    return round(seconds * frame_rate)
