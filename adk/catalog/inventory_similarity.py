"""Match a product photo against seller inventory by type + features — not exact name."""

from __future__ import annotations

import re
from typing import Any

# Broad product-type families → terms that appear in inventory names/descriptions.
PRODUCT_TYPE_ALIASES: dict[str, list[str]] = {
    "shirt": ["shirt", "blouse", "top", "button-up", "button up", "button-up shirt", "tee", "t-shirt", "tshirt", "polo"],
    "pants": ["pants", "trousers", "jeans", "denim", "cargo", "chinos", "leggings", "joggers"],
    "dress": ["dress", "gown", "frock"],
    "skirt": ["skirt"],
    "jacket": ["jacket", "coat", "blazer", "hoodie", "sweater", "pullover", "zip"],
    "scarf": ["scarf", "shawl", "wrap"],
    "bag": ["bag", "tote", "purse", "handbag", "backpack"],
    "shoe": ["shoe", "sneaker", "boot", "sandal", "heel", "loafer"],
    "serum": ["serum", "essence", "ampoule"],
    "cream": ["cream", "moisturizer", "moisturiser", "lotion", "balm"],
    "cleanser": ["cleanser", "wash", "cleansing"],
    "mask": ["mask", "sheet mask"],
    "mug": ["mug", "cup", "tumbler"],
    "basket": ["basket", "bowl", "pot", "vase", "planter"],
    "candle": ["candle"],
    "jewelry": ["jewelry", "jewellery", "necklace", "bracelet", "earring", "ring"],
}


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", str(text or "").lower()).strip()


def _expand_product_type(product_type: str) -> list[str]:
    pt = _norm(product_type)
    if not pt:
        return []
    terms = {pt}
    for key, aliases in PRODUCT_TYPE_ALIASES.items():
        if pt == key or pt in aliases or any(a in pt for a in aliases):
            terms.add(key)
            terms.update(aliases)
    # Also split compound types: "button-up shirt" → shirt terms
    for token in re.findall(r"[a-z0-9\-]+", pt):
        if token in PRODUCT_TYPE_ALIASES:
            terms.add(token)
            terms.update(PRODUCT_TYPE_ALIASES[token])
    return sorted(terms, key=len, reverse=True)


def _item_text(row: dict[str, Any]) -> str:
    return _norm(
        " ".join(
            [
                str(row.get("name") or ""),
                str(row.get("description") or ""),
                str(row.get("category") or ""),
            ]
        )
    )


def _keywords_from_vision(vision: dict[str, Any]) -> list[str]:
    raw: list[str] = []
    for key in ("search_keywords", "keywords"):
        val = vision.get(key)
        if isinstance(val, list):
            raw.extend(str(v).strip().lower() for v in val if str(v).strip())
    for key in ("name", "description", "product_type"):
        val = str(vision.get(key) or "").strip()
        if val:
            raw.append(val.lower())
    # Tokenize multi-word phrases into useful singles
    expanded: set[str] = set()
    for kw in raw:
        expanded.add(kw)
        for token in re.findall(r"[a-z0-9]+", kw):
            if len(token) >= 3:
                expanded.add(token)
    # Drop noisy generic words
    stop = {"the", "and", "for", "with", "item", "product", "casual", "general", "ready", "list"}
    return [k for k in expanded if k not in stop]


def score_inventory_match(row: dict[str, Any], vision: dict[str, Any]) -> int:
    """Score how well an inventory row matches vision analysis (0 = no match)."""
    text = _item_text(row)
    if not text:
        return 0

    product_type = _norm(str(vision.get("product_type") or ""))
    type_terms = _expand_product_type(product_type)

    # If we know the product type, require at least one type term in the item.
    if type_terms:
        if not any(term in text for term in type_terms):
            return 0
        score = 12
    else:
        score = 0

    keywords = _keywords_from_vision(vision)
    for kw in keywords:
        if len(kw) < 3:
            continue
        if kw in text:
            score += 4
        elif " " in kw:
            parts = [p for p in kw.split() if len(p) >= 3]
            score += sum(2 for p in parts if p in text)

    # Bonus when item name shares significant words with vision name (not full title).
    vision_name = _norm(str(vision.get("name") or ""))
    if vision_name:
        name_tokens = [t for t in re.findall(r"[a-z0-9]+", vision_name) if len(t) >= 4]
        score += sum(3 for t in name_tokens if t in text)

    return score


def find_similar_inventory_rows(
    rows: list[dict[str, Any]],
    vision: dict[str, Any],
    *,
    min_score: int = 10,
    limit: int = 12,
) -> list[tuple[int, dict[str, Any]]]:
    """Return inventory rows ranked by feature similarity to the photo analysis."""
    scored: list[tuple[int, dict[str, Any]]] = []
    for row in rows:
        if str(row.get("status") or "active").lower() == "trash":
            continue
        s = score_inventory_match(row, vision)
        if s >= min_score:
            scored.append((s, row))
    scored.sort(key=lambda x: (-x[0], str(x[1].get("name") or "")))
    return scored[:limit]
