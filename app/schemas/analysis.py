from pydantic import BaseModel


class WordItem(BaseModel):
    word: str
    start: float
    end: float
    probability: float
    # Optional because older transcripts (pre semantic-cut work) lack these.
    id: str | None = None
    ai_cut: bool = False


class AnalysisSegment(BaseModel):
    start_s: float
    end_s: float
    reason: str   # "silence" | "repetition" | "keep"
    is_cut: bool


class AnalysisResult(BaseModel):
    words: list[WordItem]
    segments: list[AnalysisSegment]   # all segments, interleaved keep + cut
    duration_seconds: float
    frame_rate: float
    total_frames: int
    silence_threshold: float
