"""
Export generation service.

Consumes word-level transcript data and an ExportRequest to produce a
standards-compliant FCP7-XML string that any NLE can import.

The silence_threshold from the request is used to locate inter-word gaps
that exceed the threshold — those gaps become cut points. handle_padding_frames
expands each keep-segment outward by n frames so cuts don't feel tight.

Production implementation should delegate to:
    app.services.transcription.find_silence_gaps()
    app.utils.timecode.frames_to_smpte()
    app.utils.timecode.add_handles()
"""

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.models.transcript import Transcript
    from app.schemas.export import ExportRequest


def generate_xml(transcript: "Transcript", request: "ExportRequest") -> str:
    """
    Build and return an FCP7-XML payload for the given transcript.

    Production implementation outline:
        1. Deserialise transcript.word_level_data into a list of word dicts.
        2. Call find_silence_gaps(word_level_data, request.silence_threshold)
           to get [(gap_start_s, gap_end_s), ...].
        3. Invert the gaps into keep-segments: the regions BETWEEN silences.
        4. For each segment, convert start/end seconds → frame numbers via
           seconds_to_frame(t, asset.frame_rate).
        5. Apply add_handles(in_frame, out_frame, request.handle_padding_frames,
           asset.total_frames) to each segment.
        6. Render each padded segment as an <clipitem> block inside the
           FCP7 <xmeml> envelope below.
    """

    # -------------------------------------------------------------------------
    # MOCK — returns a structurally valid FCP7-XML skeleton.
    # Replace the <clipitem> block with real segments from step 6 above.
    # -------------------------------------------------------------------------
    word_count = len(transcript.word_level_data) if transcript.word_level_data else 0

    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<!DOCTYPE xmeml>\n'
        '<xmeml version="5">\n'
        "  <sequence>\n"
        f"    <name>transcript_{transcript.id}</name>\n"
        f"    <!-- silence_threshold={request.silence_threshold}s  "
        f"handle_padding={request.handle_padding_frames}fr  "
        f"words={word_count} -->\n"
        "    <timebase>24</timebase>\n"
        "    <ntsc>FALSE</ntsc>\n"
        "    <media>\n"
        "      <video>\n"
        "        <track>\n"
        "          <clipitem id='clipitem-1'>\n"
        "            <name>MOCK_SEGMENT</name>\n"
        "            <start>0</start>\n"
        "            <end>48</end>\n"
        "            <in>0</in>\n"
        "            <out>48</out>\n"
        "          </clipitem>\n"
        "        </track>\n"
        "      </video>\n"
        "    </media>\n"
        "  </sequence>\n"
        "</xmeml>"
    )
