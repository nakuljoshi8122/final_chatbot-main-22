"""Pydantic request/response models for the ShopAssist API."""

from pydantic import BaseModel


class SellerProductIn(BaseModel):
    sku: str
    name: str
    category: str = "Handicrafts"
    price: str = ""
    description: str = ""
    category_notes: str = ""
    quantity: int = 0
    status: str = "active"
    store_id: str | None = None
    image_base64: str | None = None
    image_url: str | None = None
    url: str | None = None
    created_at: str | None = None
    updated_at: str | None = None
    force_retag: bool = False
    tags: list[str] | None = None


class StoreCreateIn(BaseModel):
    name: str
    owner_name: str
    category: str = "Handicrafts"
    owner_email: str = ""
    owner_phone: str = ""
    description: str = ""
    address: str = ""
    id: str | None = None


class UserQuery(BaseModel):
    query: str
    session_id: str = None
    store: str | None = None
    store_id: str | None = None
    role: str | None = None
    image_base64: str | None = None


class VoiceQuery(BaseModel):
    session_id: str = None
    return_audio: bool = False


class ActiveProductBody(BaseModel):
    session_id: str
    product_id: str
