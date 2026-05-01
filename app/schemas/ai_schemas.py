"""
Pydantic schemas for AI-driven analysis responses.

These models double as Gemini structured-output schemas: passing the model
class to `genai.GenerationConfig(response_schema=...)` constrains Gemini to
emit JSON that validates against the model. We then parse it back into the
Pydantic instance for type-safe access in the rest of the codebase.
"""

from pydantic import BaseModel, Field


class SmartCutResponse(BaseModel):
    """
    Response shape for the semantic cutting analyzer.

    `words_to_cut` contains the unique IDs of words that represent false
    starts, filler words ("um", "uh", "like"), or unnecessary repetitions
    that should be deleted to make the speaker sound fluent and confident.
    Each ID corresponds to the `id` field of a word in the source transcript.
    """

    words_to_cut: list[str] = Field(
        default_factory=list,
        description=(
            "Unique IDs of words to delete: false starts, filler words, "
            "stutters, and unnecessary repetitions."
        ),
    )
