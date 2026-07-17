"""Central path constants for the ShopAssist backend package."""

from __future__ import annotations

from pathlib import Path

# adk/ package root (this file lives at adk/paths.py)
PACKAGE_ROOT = Path(__file__).resolve().parent
DATA_DIR = PACKAGE_ROOT / "data"
STATIC_DIR = PACKAGE_ROOT / "static"
PRODUCT_IMAGES_DIR = STATIC_DIR / "products"
PENDING_CHAT_IMAGES_DIR = STATIC_DIR / "pending_chat_images"
ENV_FILE = PACKAGE_ROOT / ".env"

# Writable / seed data files
FAKE_KB_PATH = DATA_DIR / "fake_kb.md"
SELLER_PRODUCTS_JSON = DATA_DIR / "seller_products.json"
INVENTORY_VISIBILITY_JSON = DATA_DIR / "inventory_visibility.json"
STORES_JSON = DATA_DIR / "stores.json"
STORE_QUERIES_DIR = DATA_DIR / "store_queries"
PRODUCT_IMAGES_JSON = DATA_DIR / "product_images.json"
BOUTIQUE_PRODUCT_IMAGES_JSON = DATA_DIR / "boutique_product_images.json"


def ensure_runtime_dirs() -> None:
    """Create directories used for uploads and static assets."""
    PRODUCT_IMAGES_DIR.mkdir(parents=True, exist_ok=True)
    PENDING_CHAT_IMAGES_DIR.mkdir(parents=True, exist_ok=True)
    STORE_QUERIES_DIR.mkdir(parents=True, exist_ok=True)
