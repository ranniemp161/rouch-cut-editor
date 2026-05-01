import uuid

from fastapi import APIRouter, HTTPException, status
from sqlmodel import select

from app.api.deps import SessionDep
from app.models.transcript import Transcript
from app.schemas.transcript import TranscriptCreate, TranscriptRead

router = APIRouter(prefix="/transcripts", tags=["transcripts"])


@router.post("/", response_model=TranscriptRead, status_code=status.HTTP_201_CREATED)
def create_transcript(body: TranscriptCreate, session: SessionDep) -> Transcript:
    transcript = Transcript(**body.model_dump())
    session.add(transcript)
    session.commit()
    session.refresh(transcript)
    return transcript


@router.get("/{transcript_id}", response_model=TranscriptRead)
def get_transcript(transcript_id: uuid.UUID, session: SessionDep) -> Transcript:
    transcript = session.get(Transcript, transcript_id)
    if not transcript:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Transcript not found")
    return transcript


@router.get("/by-asset/{asset_id}", response_model=list[TranscriptRead])
def list_transcripts_for_asset(asset_id: uuid.UUID, session: SessionDep) -> list[Transcript]:
    query = select(Transcript).where(Transcript.media_asset_id == asset_id)
    return list(session.exec(query).all())
