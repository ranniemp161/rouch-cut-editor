import hashlib

from pydantic import BaseModel
from sqlmodel import select

from fastapi import APIRouter

from app.api.deps import SessionDep
from app.models.user import User

router = APIRouter(prefix="/auth", tags=["auth"])


class BootstrapRequest(BaseModel):
    api_key: str
    client_name: str = "Web Client"


class BootstrapResponse(BaseModel):
    user_id: str


@router.post("/bootstrap", response_model=BootstrapResponse)
def bootstrap(body: BootstrapRequest, session: SessionDep) -> BootstrapResponse:
    """
    Idempotent: finds or creates a User row keyed by the SHA-256 hash of the
    supplied api_key. The raw key is never stored.
    Called once by the frontend after the auth gate passes.
    """
    key_hash = hashlib.sha256(body.api_key.encode()).hexdigest()

    user = session.exec(select(User).where(User.api_key_hash == key_hash)).first()

    if not user:
        user = User(client_name=body.client_name, api_key_hash=key_hash)
        session.add(user)
        session.commit()
        session.refresh(user)

    return BootstrapResponse(user_id=str(user.id))
