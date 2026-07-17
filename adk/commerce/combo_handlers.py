"""Combined instructions in one reply — e.g. show tiles + describe the 2nd."""

from __future__ import annotations

import re
from typing import Optional

SHOW_AND_DESCRIBE_RE = re.compile(
    r"\bshow\s+me\b.+?\bdescribe\s+(?:the\s+)?(first|1st|second|2nd|third|3rd|fourth|4th|last)\s+(?:one|tile|shoe|sneaker|item)?\b",
    re.IGNORECASE,
)
COUNT_RE = re.compile(r"\b(\d+)\s+(shoes?|sneakers?|items?|products?|tiles?)\b", re.IGNORECASE)

ORDINAL_INDEX = {
    "first": 0, "1st": 0,
    "second": 1, "2nd": 1,
    "third": 2, "3rd": 2,
    "fourth": 3, "4th": 3,
    "last": -1,
}


def is_show_and_describe_query(query: str) -> bool:
    return bool(SHOW_AND_DESCRIBE_RE.search(query.strip()))


def _describe_lines(tile: dict) -> list[str]:
    name = tile.get("name", "")
    price = tile.get("price", "")
    features = tile.get("features") or []
    lines = [f"{name} — {price}."]
    if features:
        lines.append(str(features[0]) + ".")
    if len(features) > 1:
        lines.append(str(features[1]) + ".")
    desc = str(tile.get("description", "")).strip()
    if desc and desc not in " ".join(lines):
        lines.append(desc.rstrip(".") + ".")
    return lines[:4]


def try_show_and_describe_response(
    user_query: str,
    session_id: str,
    conversation_history: dict,
) -> Optional[str]:
    if not is_show_and_describe_query(user_query):
        return None

    m = SHOW_AND_DESCRIBE_RE.search(user_query)
    if not m:
        return None

    ordinal_word = m.group(1).lower()
    describe_idx = ORDINAL_INDEX.get(ordinal_word, 1)

    try:
        from commerce.tile_validator import (
            resolve_browse_query,
            build_catalog_tiles,
            rebuild_response_with_tiles,
            resolve_tile_limit,
        )
        from commerce.intent_router import is_new_topic_instruction
        from commerce.browse_filters import reset_filters_for_new_topic
    except ImportError:
        from commerce.tile_validator import (
            resolve_browse_query,
            build_catalog_tiles,
            rebuild_response_with_tiles,
            resolve_tile_limit,
        )
        from commerce.intent_router import is_new_topic_instruction
        from commerce.browse_filters import reset_filters_for_new_topic

    if is_new_topic_instruction(user_query):
        reset_filters_for_new_topic(session_id, user_query)

    browse_query, is_fresh, category_lock = resolve_browse_query(
        session_id, user_query, conversation_history
    )
    limit, _ = resolve_tile_limit(user_query)
    count_m = COUNT_RE.search(user_query)
    if count_m:
        limit = min(int(count_m.group(1)), limit)

    tiles, _note = build_catalog_tiles(
        browse_query,
        max(limit, describe_idx + 1),
        set(),
        category_lock=category_lock,
        session_id=session_id,
    )
    if len(tiles) <= describe_idx:
        return None

    target = tiles[describe_idx] if describe_idx >= 0 else tiles[-1]
    intro = "Here you go."
    describe_block = "\n".join(_describe_lines(target))
    body = f"{intro}\n\n{describe_block}"
    return rebuild_response_with_tiles(body, tiles[:limit], summary_mode=False, user_query=user_query)
