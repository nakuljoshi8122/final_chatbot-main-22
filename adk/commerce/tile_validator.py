"""Build product tiles from the boutique/seller catalog."""

from __future__ import annotations

import re
from typing import Optional

try:
    from commerce.agent_markup import (
        TILES_REGEX,
        normalize_agent_markup,
        strip_agent_markup,
    )
except ImportError:
    from commerce.agent_markup import (
        TILES_REGEX,
        normalize_agent_markup,
        strip_agent_markup,
    )

try:
    from catalog.catalog_products import all_products
    from commerce.product_matcher import format_product_card
except ImportError:
    from catalog.catalog_products import all_products
    from commerce.product_matcher import format_product_card

try:
    from catalog.product_images import get_product_image
except ImportError:
    from catalog.product_images import get_product_image


def _slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def find_catalog_product(name_or_id: str) -> Optional[dict]:
    key = str(name_or_id or "").strip()
    if not key:
        return None
    key_upper = key.upper().removeprefix("TILE-")
    name_lower = key.lower()

    for product in all_products():
        pid = str(product.get("id") or "")
        sku = str(product.get("sku") or "").upper()
        if pid == key or sku == key_upper or pid.upper().removeprefix("TILE-") == key_upper:
            return product
        if str(product.get("name") or "").lower() == name_lower:
            return product

    tokens = set(re.findall(r"[a-z0-9]+", name_lower))
    best: Optional[dict] = None
    best_score = 0
    for product in all_products():
        pn_tokens = set(re.findall(r"[a-z0-9]+", str(product.get("name") or "").lower()))
        score = len(tokens & pn_tokens)
        if score > best_score and score >= 2:
            best_score = score
            best = product
    return best


def product_to_tile(product: dict, tag: str = "") -> dict:
    card = format_product_card(product)
    colors = product.get("colors", [])
    features = card.get("features", [])[:2]
    img = get_product_image(product)
    images = product.get("images") if isinstance(product.get("images"), list) else []
    images = [str(u) for u in images if str(u or "").strip()]
    if img and img not in images:
        images = [img, *images]
    tile = {
        "id": product["id"],
        "sku": product.get("sku") or product["id"],
        "name": product["name"],
        "price": product.get("price") or "",
        "category": card["category"],
        "description": card["description"],
        "features": features,
        "tag": tag or None,
        "color": colors[0] if colors else "",
        "url": product.get("url") or card.get("url") or f"/product/{_slugify(product['name'])}",
        "img": img,
        "images": images or ([img] if img else []),
        "quantity": product.get("quantity"),
        "status": product.get("status") or "active",
        "store_id": product.get("store_id") or "",
    }
    if product.get("list_price"):
        tile["list_price"] = product["list_price"]
    if tag:
        tile["tag"] = tag
    return tile


def validate_tile_entry(entry: dict) -> Optional[dict]:
    product = find_catalog_product(str(entry.get("name") or entry.get("id") or entry.get("sku") or ""))
    if not product:
        return None
    tile = product_to_tile(product)
    if entry.get("tag"):
        tile["tag"] = entry["tag"]
    return tile


__all__ = [
    "TILES_REGEX",
    "normalize_agent_markup",
    "strip_agent_markup",
    "find_catalog_product",
    "product_to_tile",
    "validate_tile_entry",
]
