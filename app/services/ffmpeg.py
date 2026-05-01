"""
FFmpeg/ffprobe integration for media metadata extraction.

Call ffprobe as a subprocess to extract stream metadata from a video file,
then parse the JSON output into typed values. All frame math is done in
integer arithmetic to avoid floating-point drift at high frame counts.
"""

import json
import subprocess
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
    Prefers r_frame_rate over avg_frame_rate for VFR safety.
    Falls back to duration arithmetic when nb_frames is absent (e.g. MKV).
    """
    result = subprocess.run(
        [
            "ffprobe", "-v", "quiet",
            "-print_format", "json",
            "-show_streams",
            "-select_streams", "v:0",
            file_path,
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    data = json.loads(result.stdout)
    streams = data.get("streams", [])
    if not streams:
        raise ValueError(f"No video stream found in {file_path!r}")

    stream = streams[0]

    fps_fraction = Fraction(stream["r_frame_rate"])
    frame_rate = float(fps_fraction)

    nb_frames = stream.get("nb_frames")
    duration_str = stream.get("duration")

    if nb_frames:
        total_frames = int(nb_frames)
    elif duration_str:
        total_frames = round(float(duration_str) * frame_rate)
    else:
        raise ValueError(f"Cannot determine frame count for {file_path!r}")

    duration_seconds = float(duration_str) if duration_str else total_frames / frame_rate

    return MediaInfo(
        frame_rate=frame_rate,
        total_frames=total_frames,
        duration_seconds=duration_seconds,
    )


def extract_audio(video_path: str, audio_path: str) -> None:
    """
    Extract mono 16 kHz PCM WAV from *video_path* into *audio_path*.
    16 kHz mono is the format Whisper expects; resampling here avoids
    loading unnecessary audio data in the transcription model.
    """
    subprocess.run(
        [
            "ffmpeg", "-i", video_path,
            "-vn",
            "-acodec", "pcm_s16le",
            "-ar", "16000",
            "-ac", "1",
            audio_path,
            "-y",
        ],
        check=True,
        capture_output=True,
    )


def frame_to_seconds(frame_number: int, frame_rate: float) -> float:
    """Convert a zero-based frame index to wall-clock seconds."""
    return frame_number / frame_rate


def seconds_to_frame(seconds: float, frame_rate: float) -> int:
    """Convert wall-clock seconds to the nearest zero-based frame index."""
    return round(seconds * frame_rate)
