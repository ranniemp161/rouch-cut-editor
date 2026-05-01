import uuid

from fastapi import APIRouter, HTTPException, status
from sqlmodel import select

from app.api.deps import SessionDep
from app.models.media_asset import MediaAsset
from app.schemas.media_asset import MediaAssetCreate, MediaAssetRead

router = APIRouter(prefix="/media-assets", tags=["media-assets"])


@router.post("/", response_model=MediaAssetRead, status_code=status.HTTP_201_CREATED)
def create_media_asset(body: MediaAssetCreate, session: SessionDep) -> MediaAsset:
    asset = MediaAsset(**body.model_dump())
    session.add(asset)
    session.commit()
    session.refresh(asset)
    return asset


@router.get("/{asset_id}", response_model=MediaAssetRead)
def get_media_asset(asset_id: uuid.UUID, session: SessionDep) -> MediaAsset:
    asset = session.get(MediaAsset, asset_id)
    if not asset:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Media asset not found")
    return asset


@router.get("/", response_model=list[MediaAssetRead])
def list_media_assets(session: SessionDep, project_id: uuid.UUID | None = None) -> list[MediaAsset]:
    query = select(MediaAsset)
    if project_id:
        query = query.where(MediaAsset.project_id == project_id)
    return list(session.exec(query).all())


@router.delete("/{asset_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_media_asset(asset_id: uuid.UUID, session: SessionDep) -> None:
    asset = session.get(MediaAsset, asset_id)
    if not asset:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Media asset not found")
    session.delete(asset)
    session.commit()
