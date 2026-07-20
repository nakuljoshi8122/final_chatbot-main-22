"""Product image URLs — stored on each product in MongoDB."""

from __future__ import annotations

from paths import ENV_FILE, DATA_DIR, STATIC_DIR, PRODUCT_IMAGES_DIR, PENDING_CHAT_IMAGES_DIR, FAKE_KB_PATH, SELLER_PRODUCTS_JSON, INVENTORY_VISIBILITY_JSON, STORES_JSON, STORE_QUERIES_DIR, PRODUCT_IMAGES_JSON, BOUTIQUE_PRODUCT_IMAGES_JSON

import os
from pathlib import Path
from urllib.parse import quote

try:
    from catalog.product_image_pools import image_url_for_product as _pool_url
except ImportError:
    from catalog.product_image_pools import image_url_for_product as _pool_url

_PRODUCTS_DIR = PRODUCT_IMAGES_DIR


def _api_base() -> str:
    return os.getenv("API_PUBLIC_URL", "http://127.0.0.1:8000").rstrip("/")


def resolve_image_url(product: dict) -> str:
    """Build the image URL to store in MongoDB (local static file preferred)."""
    pid = str(product.get("id", ""))
    if pid and (_PRODUCTS_DIR / f"{pid}.jpg").is_file():
        return f"{_api_base()}/product-images/{pid}.jpg"
    return _pool_url(product)


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
    if pid and (_PRODUCTS_DIR / f"{pid}.jpg").is_file():
        return f"{_api_base()}/product-images/{pid}.jpg"
    name = str(product.get("name", "Product"))
    label = quote(name.replace(" ", "+"))
    return f"https://via.placeholder.com/600x600/F5F5F5/000000?text={label}"
