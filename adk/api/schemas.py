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
    # Extra product photos (same product, multiple angles)
    images_base64: list[str] | None = None
    image_url: str | None = None
    url: str | None = None
    created_at: str | None = None
    updated_at: str | None = None
    force_retag: bool = False
    tags: list[str] | None = None
    list_price: str | None = None
    # Explicit price edits remove any active promotion until it is reapplied.
    clear_discount: bool = False


class StoreCreateIn(BaseModel):
    name: str
    owner_name: str
    category: str = "Handicrafts"
    owner_email: str = ""
    owner_phone: str = ""
    description: str = ""
    address: str = ""
    id: str | None = None


class StoreDeleteIn(BaseModel):
    """Confirm by typing the exact store name."""
    confirm_name: str


class UserQuery(BaseModel):
    query: str
    session_id: str = None
    store: str | None = None
    store_id: str | None = None
    role: str | None = None
    image_base64: str | None = None
    listing_context: dict | None = None


class VoiceQuery(BaseModel):
    session_id: str = None
    return_audio: bool = False


class ActiveProductBody(BaseModel):
    session_id: str
    product_id: str


class SessionOnlyBody(BaseModel):
    session_id: str
