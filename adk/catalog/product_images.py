"""Product image URLs for boutique/seller listings."""

from __future__ import annotations

from paths import PRODUCT_IMAGES_DIR

import os
from urllib.parse import quote

_PRODUCTS_DIR = PRODUCT_IMAGES_DIR


def _api_base() -> str:
    return os.getenv("API_PUBLIC_URL", "http://127.0.0.1:8000").rstrip("/")


def resolve_image_url(product: dict) -> str:
    """Prefer a local static product image, else a placeholder."""
    return get_product_image(product)


def get_product_image(product: dict) -> str:
    """Return img URL from product record (prefer seller img / images gallery)."""
    img = str(product.get("img") or "").strip()
    if img and (img.startswith("http") or img.startswith("/")):
        return img
    images = product.get("images")
    if isinstance(images, list):
        for u in images:
            s = str(u or "").strip()
            if s.startswith("http") or s.startswith("/"):
                return s
    pid = str(product.get("id") or product.get("sku") or "").strip().upper()
    if pid.startswith("TILE-"):
        pid = pid[5:]
    if pid and (_PRODUCTS_DIR / f"{pid}.jpg").is_file():
        return f"{_api_base()}/product-images/{pid}.jpg"
    name = str(product.get("name", "Product"))
    label = quote(name.replace(" ", "+"))
    return f"https://via.placeholder.com/600x600/F5F5F5/000000?text={label}"
