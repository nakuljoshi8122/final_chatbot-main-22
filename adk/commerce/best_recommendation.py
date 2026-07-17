"""'What is the best…' → angle picks with one line + one tile each. Never comparison tables."""

from __future__ import annotations

import re
from typing import Callable, Optional

try:
    from commerce.product_matcher import (
        is_best_recommendation_query,
        infer_category_from_query,
        match_products,
        _raw_product_by_id,
    )
    from commerce.prior_items import get_prior_reference_items
except ImportError:
    from commerce.product_matcher import (
        is_best_recommendation_query,
        infer_category_from_query,
        match_products,
        _raw_product_by_id,
    )
    from commerce.prior_items import get_prior_reference_items

try:
    from catalog.shopassist_catalog import all_products
except ImportError:
    from catalog.shopassist_catalog import all_products


def _parse_inr(price: str) -> int:
    digits = re.sub(r"[^\d]", "", str(price))
    return int(digits) if digits else 0


def _haystack_from_card(card: dict) -> str:
    parts = [
        card.get("name", ""),
        card.get("category", ""),
        card.get("description", ""),
        " ".join(card.get("features") or []),
        card.get("sport", ""),
        card.get("tag", "") or "",
    ]
    return " ".join(str(p) for p in parts).lower()


def _tv():
    try:
        from commerce.tile_validator import find_catalog_product, product_to_tile, rebuild_response_with_tiles
    except ImportError:
        from commerce.tile_validator import find_catalog_product, product_to_tile, rebuild_response_with_tiles
    return find_catalog_product, product_to_tile, rebuild_response_with_tiles


def _candidate_pool(
    user_query: str,
    conversation_history: dict,
    session_id: str,
) -> list[dict]:
    """Products in scope — fresh catalog for best picks; never bleed prior unrelated items."""
    find_catalog, to_tile, _ = _tv()
    q = user_query.lower()

    if is_best_recommendation_query(user_query):
        if "running" in q and any(w in q for w in ("shoe", "sneaker", "trainer", "footwear")):
            pool: list[dict] = []
            for product in all_products():
                if product.get("category") != "footwear":
                    continue
                if product.get("sport") != "running":
                    continue
                pool.append(to_tile(product))
            return pool

        if any(w in q for w in ("hik", "trek", "trail", "outdoor")):
            pool = []
            for product in all_products():
                if product.get("category") != "footwear":
                    continue
                if product.get("sport") != "outdoor":
                    continue
                hay = " ".join(
                    product.get("features", []) + product.get("tags", [])
                ).lower()
                if not any(x in hay for x in ("hiking", "trail", "terrex", "outdoor")):
                    continue
                pool.append(to_tile(product))
            return pool

        cards = match_products(user_query, max_results=12)
        pool = []
        seen: set[str] = set()
        for card in cards:
            pid = str(card.get("id", ""))
            if pid and pid not in seen:
                seen.add(pid)
                raw = find_catalog(str(card.get("name", "")))
                pool.append(to_tile(raw) if raw else dict(card))
        return pool

    prior = get_prior_reference_items(conversation_history, session_id)
    if prior:
        return prior

    cards = match_products(user_query, max_results=12)
    pool = []
    seen = set()
    for card in cards:
        pid = str(card.get("id", ""))
        if pid and pid not in seen:
            seen.add(pid)
            raw = find_catalog(str(card.get("name", "")))
            pool.append(to_tile(raw) if raw else dict(card))
    return pool


def _intro_line(user_query: str) -> str:
    q = user_query.lower()
    if re.search(r"\b(son|daughter|kid|child|children|boys?|girls?)\b", q):
        return "Depends what your kid needs — if I had to pick:"
    if re.search(r"\b(overall|in general)\b", q):
        return "Depends what you care about — if I had to pick:"
    return "Depends what you need — if I had to pick:"


class _Angle:
    __slots__ = ("key", "label", "tagline", "score_fn")

    def __init__(
        self,
        key: str,
        label: str,
        tagline: str,
        score_fn: Callable[[dict, str], float],
    ):
        self.key = key
        self.label = label
        self.tagline = tagline
        self.score_fn = score_fn


def _score_light(_card: dict, hay: str) -> float:
    if any(x in hay for x in ("lightweight", "lightstrike", "ultralight", "light weight")):
        return 20.0
    if "light" in hay:
        return 10.0
    return 0.0


def _score_comfort(_card: dict, hay: str) -> float:
    if "boost" in hay:
        return 18.0
    if any(x in hay for x in ("cushion", "comfort", "plush", "soft")):
        return 14.0
    return 0.0


def _score_value(card: dict, _hay: str) -> float:
    price = _parse_inr(card.get("price", ""))
    if not price:
        return 0.0
    return 20000.0 - price


def _score_premium(card: dict, hay: str) -> float:
    price = _parse_inr(card.get("price", ""))
    bonus = 8.0 if any(x in hay for x in ("premium", "gore-tex", "gore tex", "primaloft")) else 0.0
    return price + bonus


def _score_durable(_card: dict, hay: str) -> float:
    if any(x in hay for x in ("durable", "tough", "gore-tex", "trail", "ripstop")):
        return 16.0
    return 0.0


def _score_style(_card: dict, hay: str) -> float:
    if any(x in hay for x in ("lifestyle", "classic", "iconic", "samba", "retro")):
        return 14.0
    return 0.0


def _score_daily(_card: dict, hay: str) -> float:
    if any(x in hay for x in ("everyday", "daily", "all-day", "versatile", "training")):
        return 12.0
    return 4.0


def _angles_for_query(user_query: str, pool: list[dict]) -> list[_Angle]:
    q = user_query.lower()
    cat = infer_category_from_query(user_query)
    if not cat and pool:
        raw = _raw_product_by_id(str(pool[0].get("id", "")))
        cat = raw.get("category") if raw else None

    if cat == "clothing" or any(w in q for w in ("jersey", "tee", "shirt", "hoodie", "legging", "bra")):
        return [
            _Angle("lightweight", "Lightest on skin", "barely feel it", _score_light),
            _Angle("premium", "Best quality", "worth every rupee", _score_premium),
            _Angle("value", "Best bang for buck", "does the job cheap", _score_value),
        ]

    if cat == "footwear" or any(w in q for w in ("shoe", "sneaker", "trainer", "boot")):
        angles = [
            _Angle("comfort", "Most cushioned", "easy on the feet all day", _score_comfort),
            _Angle("lightweight", "Lightest ride", "barely feel it on long runs", _score_light),
            _Angle("value", "Best bang for buck", "solid without killing your wallet", _score_value),
        ]
        if "hik" in q or "trail" in q or "outdoor" in q:
            angles[1] = _Angle("durability", "Toughest out there", "built for rough miles", _score_durable)
        return angles

    return [
        _Angle("value", "Best bang for buck", "does the job cheap", _score_value),
        _Angle("premium", "Best quality", "worth every rupee", _score_premium),
        _Angle("daily", "Best daily driver", "grab-and-go reliable", _score_daily),
    ]


def _pick_per_angle(pool: list[dict], angles: list[_Angle], user_query: str = "") -> list[tuple[_Angle, dict]]:
    used: set[str] = set()
    picks: list[tuple[_Angle, dict]] = []
    q = user_query.lower()

    eligible = pool
    if "running" in q and any(w in q for w in ("shoe", "sneaker", "trainer")):
        eligible = []
        for card in pool:
            raw = _raw_product_by_id(str(card.get("id", "")))
            if raw and raw.get("category") == "footwear" and raw.get("sport") == "running":
                eligible.append(card)

    for angle in angles:
        best_card: Optional[dict] = None
        best_score = -1.0
        for card in eligible:
            pid = str(card.get("id", ""))
            if not pid or pid in used:
                continue
            hay = _haystack_from_card(card)
            score = angle.score_fn(card, hay)
            if score > best_score:
                best_score = score
                best_card = card
        if best_card and best_score > 0:
            used.add(str(best_card.get("id", "")))
            picks.append((angle, best_card))

    if len(picks) < 2:
        for card in eligible:
            pid = str(card.get("id", ""))
            if pid and pid not in used:
                used.add(pid)
                fallback = _Angle("pick", "Solid pick", "would back this", _score_daily)
                picks.append((fallback, card))
            if len(picks) >= 3:
                break

    return picks[:3]


def build_best_recommendation_response(
    user_query: str,
    conversation_history: dict,
    session_id: str,
) -> Optional[str]:
    """Intro + punchy angle lines + TILES (no TABLE)."""
    pool = _candidate_pool(user_query, conversation_history, session_id)
    if not pool:
        return None

    find_catalog, to_tile, rebuild = _tv()
    normalized: list[dict] = []
    for card in pool:
        raw = find_catalog(str(card.get("name", "")))
        normalized.append(to_tile(raw) if raw else dict(card))

    picks = _pick_per_angle(normalized, _angles_for_query(user_query, normalized), user_query)
    if not picks:
        return None

    intro = _intro_line(user_query)
    lines: list[str] = []
    tiles: list[dict] = []
    for angle, card in picks:
        name = str(card.get("name", ""))
        lines.append(f"{angle.label} — {name}, {angle.tagline}.")
        enriched = dict(card)
        enriched["description"] = f"{angle.label} — {angle.tagline}"
        tiles.append(enriched)

    body = intro + "\n" + "\n".join(lines)
    return rebuild(body, tiles, summary_mode=False, user_query=user_query, best_pick=True)


def try_best_recommendation_response(
    user_query: str,
    session_id: str,
    conversation_history: dict,
) -> Optional[str]:
    if not is_best_recommendation_query(user_query):
        return None
    return build_best_recommendation_response(user_query, conversation_history, session_id)


def best_recommendation_context_hint(user_query: str) -> str:
    if not is_best_recommendation_query(user_query):
        return ""
    return (
        "[BEST PICK — NOT a comparison. No TABLE. "
        "Pick one winner per angle (comfort/value/style/daily/etc). "
        "One punchy line per pick + its TILE. Sound like you've worn them.]"
    )
