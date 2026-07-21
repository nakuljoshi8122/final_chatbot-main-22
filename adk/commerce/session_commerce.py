"""Session product context for legacy product-detail / active-product flows."""

from __future__ import annotations

import json
from typing import Optional

try:
    from commerce.agent_markup import TILES_REGEX
    from commerce.tile_validator import product_to_tile, find_catalog_product
except ImportError:
    from commerce.agent_markup import TILES_REGEX
    from commerce.tile_validator import product_to_tile, find_catalog_product

session_active_product: dict[str, dict] = {}
session_recent_products: dict[str, list[dict]] = {}
session_cart: dict[str, list[dict]] = {}


def _dedupe_tiles(tiles: list[dict]) -> list[dict]:
    seen: set[str] = set()
    out: list[dict] = []
    for tile in tiles:
        pid = str(tile.get("id", ""))
        if pid and pid not in seen:
            seen.add(pid)
            out.append(tile)
    return out


def parse_tiles_from_text(text: str) -> list[dict]:
    match = TILES_REGEX.search(text or "")
    if not match:
        return []
    try:
        parsed = json.loads(match.group(1).strip())
        if not isinstance(parsed, list):
            return []
        tiles: list[dict] = []
        for entry in parsed:
            if not isinstance(entry, dict) or not entry.get("name"):
                continue
            product = find_catalog_product(str(entry.get("sku") or entry.get("id") or entry["name"]))
            if product:
                tiles.append(product_to_tile(product))
            elif entry.get("id"):
                tiles.append(entry)
        return tiles
    except json.JSONDecodeError:
        return []


def set_active_product(session_id: str, product_id: str) -> Optional[dict]:
    raw = find_catalog_product(product_id)
    if not raw:
        return None
    tile = product_to_tile(raw)
    session_active_product[session_id] = tile
    recent = session_recent_products.setdefault(session_id, [])
    recent = [t for t in recent if t.get("id") != tile.get("id")]
    recent.insert(0, tile)
    session_recent_products[session_id] = recent[:5]
    try:
        from persistence.session_store import save_active_product_id
    except ImportError:
        from persistence.session_store import save_active_product_id
    save_active_product_id(session_id, str(tile.get("id", "")))
    return tile


def get_cart(session_id: str) -> list[dict]:
    return list(session_cart.get(session_id, []))


def update_session_from_response(session_id: str, response_text: str) -> None:
    tiles = parse_tiles_from_text(response_text)
    if not tiles:
        return
    recent = session_recent_products.setdefault(session_id, [])
    for tile in reversed(tiles):
        recent = [t for t in recent if t.get("id") != tile.get("id")]
        recent.insert(0, tile)
    session_recent_products[session_id] = _dedupe_tiles(recent)[:5]
    if len(tiles) == 1:
        session_active_product[session_id] = tiles[0]
        try:
            from persistence.session_store import save_active_product_id
        except ImportError:
            from persistence.session_store import save_active_product_id
        save_active_product_id(session_id, str(tiles[0].get("id", "")))
