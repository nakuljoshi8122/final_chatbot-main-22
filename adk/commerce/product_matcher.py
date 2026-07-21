"""Match catalog products for product-detail and session active-product APIs."""

from __future__ import annotations

import re
from typing import Optional

try:
    from catalog.catalog_products import all_products
except ImportError:
    from catalog.catalog_products import all_products

try:
    from catalog.product_images import get_product_image
except ImportError:
    from catalog.product_images import get_product_image

GENERIC_NAME_TOKENS = frozenset({
    "classic", "original", "essential", "premium", "natural", "organic",
    "handcrafted", "handmade", "artisan", "daily", "soft", "set",
})

PRODUCT_SIGNALS = (
    "shirt", "tee", "hoodie", "jersey", "legging", "pant", "jogger", "apparel", "clothing",
    "jacket", "shorts", "dress", "skirt", "scarf", "bag", "backpack",
    "serum", "cream", "lotion", "moisturizer", "skincare", "soap", "oil", "mask",
    "craft", "handicraft", "pottery", "teak", "wood", "carved", "candle", "decor",
    "buy", "show", "find", "looking", "need", "want", "recommend", "suggest",
    "price", "under", "budget", "size",
)

CATEGORY_KEYWORDS = {
    "Apparel": ("shirt", "tee", "hoodie", "jersey", "legging", "pant", "jogger", "apparel", "clothing", "jacket", "shorts", "dress"),
    "Skincare": ("serum", "cream", "lotion", "moisturizer", "skincare", "soap", "oil", "mask", "toner"),
    "Handicrafts": ("craft", "handicraft", "pottery", "teak", "wood", "carved", "candle", "decor", "basket"),
}


def _slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def _short_phrase(text: str, max_len: int = 48) -> str:
    text = re.sub(r"\s+", " ", str(text).strip())
    if len(text) <= max_len:
        return text
    cut = text[:max_len].rsplit(" ", 1)[0]
    return cut or text[:max_len]


def _display_category(product: dict) -> str:
    category = str(product.get("category") or "").strip()
    return category or "Product"


def _icon_for(product: dict) -> str:
    category = str(product.get("category") or "").lower()
    hay = " ".join(
        [
            str(product.get("name") or ""),
            category,
            " ".join(product.get("features") or []),
        ]
    ).lower()
    if "skincare" in category or any(x in hay for x in ("serum", "cream", "lotion", "moisturizer")):
        return "water"
    if "apparel" in category or any(x in hay for x in ("shirt", "dress", "pant", "jacket")):
        return "shirt"
    if "handicraft" in category or any(x in hay for x in ("wood", "carved", "pottery", "candle")):
        return "cube"
    return "pricetag"


def _description(product: dict) -> str:
    features = product.get("features") or []
    if features:
        first = _short_phrase(features[0], 36)
        if len(features) > 1:
            return f"{first} — {_short_phrase(features[1], 28)}"
        return first
    category = _display_category(product)
    price = product.get("price") or ""
    if category and price:
        return f"{category} — {price}"
    return category or "Store product"


def format_product_card(product: dict) -> dict:
    raw_features = product.get("features", product.get("items", [])) or []
    features = [_short_phrase(f, 32) for f in raw_features[:2]]
    slug = _slugify(str(product.get("name") or "product"))
    return {
        "id": product["id"],
        "name": product["name"],
        "price": product.get("price") or "",
        "list_price": product.get("list_price") or "",
        "category": _display_category(product),
        "description": _description(product),
        "features": features,
        "icon": _icon_for(product),
        "img": get_product_image(product),
        "url": product.get("url") or f"/product/{slug}",
        "sku": product.get("sku") or "",
        "audience": product.get("audience", "unisex"),
        "sizes": product.get("sizes", []),
        "colors": product.get("colors", []),
    }


def get_product_by_id(product_id: str) -> Optional[dict]:
    key = str(product_id or "").strip()
    key_upper = key.upper().removeprefix("TILE-")
    for product in all_products():
        pid = str(product.get("id") or "")
        sku = str(product.get("sku") or "").upper()
        if pid == key or sku == key_upper or pid.upper().removeprefix("TILE-") == key_upper:
            return format_product_card(
                {**product, "features": product.get("features", product.get("items", []))}
            )
    return None


def find_products_by_mention(text: str, max_results: int = 5) -> list[dict]:
    """Match catalogue products whose names (or distinctive tokens) appear in text."""
    text_l = text.lower()
    hits: list[tuple[int, dict]] = []

    for product in all_products():
        name_l = str(product.get("name") or "").lower()
        if len(name_l) < 4:
            continue
        score = 0
        if name_l in text_l:
            score = len(name_l) + 100
        else:
            for token in re.findall(r"[a-z0-9]+", name_l):
                if (
                    len(token) >= 5
                    and token not in GENERIC_NAME_TOKENS
                    and re.search(rf"\b{re.escape(token)}\b", text_l)
                ):
                    score = max(score, len(name_l) + len(token))
        if score > 0:
            hits.append((score, product))

    hits.sort(key=lambda x: x[0], reverse=True)
    seen: set[str] = set()
    cards: list[dict] = []
    for _, product in hits:
        pid = product["id"]
        if pid in seen:
            continue
        seen.add(pid)
        cards.append(
            format_product_card({**product, "features": product.get("features", product.get("items", []))})
        )
        if len(cards) >= max_results:
            break
    return cards


def is_product_related(query: str) -> bool:
    q = query.lower()
    return any(re.search(rf"\b{re.escape(s)}\b", q) for s in PRODUCT_SIGNALS)
