"""Deterministic product comparisons — no filter bleed, no LLM hallucination."""

from __future__ import annotations

import html
import re
from typing import Optional

try:
    from .product_matcher import (
        find_products_by_mention,
        is_best_recommendation_query,
        is_comparison_query,
        _raw_product_by_id,
    )
    from .tile_validator import product_to_tile, rebuild_response_with_tiles, find_catalog_product
    from .browse_filters import reset_filters_for_new_topic
except ImportError:
    from product_matcher import (
        find_products_by_mention,
        is_best_recommendation_query,
        is_comparison_query,
        _raw_product_by_id,
    )
    from tile_validator import product_to_tile, rebuild_response_with_tiles, find_catalog_product
    from browse_filters import reset_filters_for_new_topic

_VS_SPLIT_RE = re.compile(
    r"\b(?:vs\.?|versus|compared to|compare to|diff(?:erence)?(?:\s+between|\s+b/w|\s+b\/w)?|between)\b",
    re.IGNORECASE,
)


def _comparison_products(user_query: str) -> list[dict]:
    """Resolve the products being compared from the user message."""
    q = user_query.strip()
    parts = _VS_SPLIT_RE.split(q, maxsplit=1)
    candidates: list[dict] = []
    seen: set[str] = set()

    def _add_from_text(text: str) -> None:
        for card in find_products_by_mention(text, max_results=4):
            pid = str(card.get("id", ""))
            if pid and pid not in seen:
                seen.add(pid)
                candidates.append(card)

    if len(parts) == 2:
        _add_from_text(parts[0])
        _add_from_text(parts[1])
    else:
        _add_from_text(q)

    if len(candidates) < 2:
        for card in find_products_by_mention(q, max_results=6):
            pid = str(card.get("id", ""))
            if pid and pid not in seen:
                seen.add(pid)
                candidates.append(card)

    lock = None
    filtered: list[dict] = []
    for card in candidates:
        raw = _raw_product_by_id(str(card.get("id", "")))
        cat = raw.get("category") if raw else None
        if lock is None and cat:
            lock = cat
        if lock and raw and raw.get("category") != lock:
            continue
        filtered.append(card)

    return (filtered or candidates)[:3]


def _key_feature(tile: dict) -> str:
    feats = tile.get("features") or []
    if feats:
        return str(feats[0])
    return str(tile.get("description", "")).split("—")[0].strip()[:40]


def _compare_blurb(tile: dict, other: dict) -> str:
    name = tile.get("name", "")
    price = tile.get("price", "")
    feat = _key_feature(tile)
    other_name = other.get("name", "")
    other_price = other.get("price", "")
    bits = [f"{feat} at {price}."]
    if price and other_price and price != other_price:
        bits.append(f"Runs {price} vs {other_name}'s {other_price}.")
    elif other_name:
        bits.append(f"Different feel than {other_name}.")
    return " ".join(bits)[:120]


def _build_comparison_table(tiles: list[dict]) -> str:
    rows: list[str] = []
    for i, tile in enumerate(tiles):
        other = tiles[(i + 1) % len(tiles)] if len(tiles) > 1 else tile
        name = html.escape(str(tile.get("name", "")))
        feat = html.escape(_key_feature(tile))
        note = html.escape(_compare_blurb(tile, other))
        rows.append(f"<tr><td>{name}</td><td>{feat}</td><td>{note}</td></tr>")
    return (
        "<table>"
        "<thead><tr><th>Product</th><th>Key feature</th><th>Quick take</th></tr></thead>"
        f"<tbody>{''.join(rows)}</tbody>"
        "</table>"
    )


def try_comparison_response(
    user_query: str,
    session_id: str,
    conversation_history: dict,
) -> Optional[str]:
    """One intro line + comparison TABLE + tiles for the named products."""
    if not is_comparison_query(user_query) or is_best_recommendation_query(user_query):
        return None

    reset_filters_for_new_topic(session_id, user_query)

    cards = _comparison_products(user_query)
    if len(cards) < 2:
        return None

    tiles = []
    for card in cards:
        raw = find_catalog_product(str(card.get("name", "")))
        tiles.append(product_to_tile(raw) if raw else dict(card))

    intro = "Here's how they stack up."
    table_block = f"<TABLE>\n{_build_comparison_table(tiles)}\n</TABLE>"
    body = f"{intro}\n{table_block}"
    return rebuild_response_with_tiles(
        body, tiles[:2], summary_mode=False, user_query=user_query
    )
