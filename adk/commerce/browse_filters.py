"""Hard browse constraints — price, color, size, gender, category stack across follow-ups."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Optional

try:
    from commerce.product_matcher import (
        AUDIENCE_KEYWORDS,
        _raw_product_by_id,
        _haystack,
        categories_conflict,
        infer_category_from_query,
        match_products,
    )
except ImportError:
    from commerce.product_matcher import (
        AUDIENCE_KEYWORDS,
        _raw_product_by_id,
        _haystack,
        categories_conflict,
        infer_category_from_query,
        match_products,
    )

try:
    from commerce.conversation_context import infer_use_case
except ImportError:
    from commerce.conversation_context import infer_use_case

try:
    from catalog.shopassist_catalog import all_products as _all_products
except ImportError:
    from catalog.shopassist_catalog import all_products as _all_products

session_active_filters: dict[str, "BrowseFilters"] = {}

COLOR_ALIASES: dict[str, tuple[str, ...]] = {
    "black": ("black", "core black", "iron metallic", "focus olive / black"),
    "white": ("white", "cloud white", "cream white"),
    "red": ("red", "solar red", "team solar", "bliss pink"),
    "blue": ("blue", "lucid blue", "blue bird", "collegiate"),
    "grey": ("grey", "gray", "grey six", "grey three", "magic grey", "silver"),
    "green": ("green", "olive", "focus olive", "collegiate green", "linen green"),
    "pink": ("pink", "bliss pink", "rose", "lilac", "wonder clay"),
    "navy": ("navy",),
    "yellow": ("yellow", "lemon", "solar yellow"),
}

FILTER_CLEAR_RE = re.compile(
    r"\b(any color|all colors|any colour|any price|no budget|no price limit|"
    r"ignore (color|colour|price|budget)|don'?t care about (color|colour|price))\b",
    re.IGNORECASE,
)
PRICE_CAP_RE = re.compile(
    r"\b(under|below|less than|max|upto|up to|within)\s*₹?\s*([\d,]+)\s*(k|K)?\b",
    re.IGNORECASE,
)
PRICE_FLOOR_RE = re.compile(
    r"\b(over|above|more than|min|at least)\s*₹?\s*([\d,]+)\s*(k|K)?\b",
    re.IGNORECASE,
)
COLOR_IN_RE = re.compile(
    r"\b(?:in|anything in|any in|show me|got any)\s+"
    r"(black|white|red|blue|grey|gray|green|pink|olive|navy|yellow)\b",
    re.IGNORECASE,
)
COLOR_BARE_RE = re.compile(
    r"\b(black|white|red|blue|grey|gray|green|pink|olive|navy|yellow)\s+"
    r"(ones?|options?|colorways?|version|pair|shoes?|sneakers?|jersey|hoodie|tee)?\b",
    re.IGNORECASE,
)
SIZE_RE = re.compile(
    r"\b(?:size|sz)\s*(\d{1,2}(?:\.\d)?|[xs]{1,3}|xxl|xl|l|m|s)\b",
    re.IGNORECASE,
)
FILTER_ADD_RE = re.compile(
    r"\b(anything in|any in|in black|in white|in red|in blue|in grey|in gray|"
    r"in green|in pink|under|below|cheaper|for women|for men|for kids|size)\b",
    re.IGNORECASE,
)


@dataclass
class BrowseFilters:
    max_price: Optional[int] = None
    min_price: Optional[int] = None
    color: Optional[str] = None
    size: Optional[str] = None
    audience: Optional[str] = None
    category: Optional[str] = None
    use_case: Optional[str] = None

    def is_active(self) -> bool:
        return any(
            getattr(self, k) is not None
            for k in ("max_price", "min_price", "color", "size", "audience", "category", "use_case")
        )

    def merge(self, other: "BrowseFilters") -> "BrowseFilters":
        return BrowseFilters(
            max_price=other.max_price if other.max_price is not None else self.max_price,
            min_price=other.min_price if other.min_price is not None else self.min_price,
            color=other.color if other.color is not None else self.color,
            size=other.size if other.size is not None else self.size,
            audience=other.audience if other.audience is not None else self.audience,
            category=other.category if other.category is not None else self.category,
            use_case=other.use_case if other.use_case is not None else self.use_case,
        )

    def describe(self) -> str:
        parts: list[str] = []
        if self.max_price is not None:
            parts.append(f"max ₹{self.max_price:,}")
        if self.min_price is not None:
            parts.append(f"min ₹{self.min_price:,}")
        if self.color:
            parts.append(f"color={self.color}")
        if self.size:
            parts.append(f"size={self.size}")
        if self.audience:
            parts.append(f"audience={self.audience}")
        if self.category:
            parts.append(f"category={self.category}")
        if self.use_case:
            parts.append(f"use_case={self.use_case}")
        return ", ".join(parts) if parts else "none"


def _parse_price_amount(num: str, suffix: str = "") -> int:
    value = int(re.sub(r"[^\d]", "", num) or "0")
    if suffix.lower() == "k" and value < 1000:
        value *= 1000
    return value


def _normalize_color(token: str) -> str:
    t = token.lower().strip()
    if t == "gray":
        return "grey"
    return t


def extract_filters_from_text(text: str) -> BrowseFilters:
    """Parse hard constraints from one message."""
    q = text.strip()
    if not q:
        return BrowseFilters()

    filters = BrowseFilters()
    if FILTER_CLEAR_RE.search(q):
        if re.search(r"\b(any color|all colors|any colour)\b", q, re.IGNORECASE):
            filters.color = None
        if re.search(r"\b(any price|no budget|no price limit)\b", q, re.IGNORECASE):
            filters.max_price = None
            filters.min_price = None

    cap = PRICE_CAP_RE.search(q)
    if cap:
        filters.max_price = _parse_price_amount(cap.group(2), cap.group(3) or "")

    floor = PRICE_FLOOR_RE.search(q)
    if floor:
        filters.min_price = _parse_price_amount(floor.group(2), floor.group(3) or "")

    if filters.max_price is None:
        shorthand = re.search(r"\b₹?\s*([\d,]+)\s*k\b", q, re.IGNORECASE)
        if shorthand and re.search(r"\b(under|below|max|budget|cheaper)\b", q, re.IGNORECASE):
            filters.max_price = _parse_price_amount(shorthand.group(1), "k")

    color_match = COLOR_IN_RE.search(q) or COLOR_BARE_RE.search(q)
    if color_match:
        filters.color = _normalize_color(color_match.group(1))

    size_match = SIZE_RE.search(q)
    if size_match:
        filters.size = size_match.group(1).upper()

    q_l = q.lower()
    for audience, keywords in AUDIENCE_KEYWORDS.items():
        if any(re.search(rf"\b{re.escape(k)}\b", q_l) for k in keywords):
            filters.audience = audience
            break

    cat = infer_category_from_query(q)
    if cat:
        filters.category = cat

    use_case = infer_use_case(q)
    if use_case:
        filters.use_case = use_case

    return filters


def is_filter_addition_follow_up(query: str) -> bool:
    q = query.strip()
    if not q:
        return False
    return bool(FILTER_ADD_RE.search(q)) and len(q.split()) <= 10


def reset_filters_for_new_topic(session_id: str, user_query: str) -> BrowseFilters:
    """Drop stacked filters — only keep what this message explicitly states."""
    filters = extract_filters_from_text(user_query)
    session_active_filters[session_id] = filters
    return filters


def on_browse_turn(
    session_id: str,
    user_query: str,
    browse_query: str,
    *,
    is_fresh: bool,
    category_lock: Optional[str],
    switched_from: Optional[str] = None,
) -> BrowseFilters:
    """Stack filters only on explicit filter follow-ups; otherwise reset."""
    try:
        from commerce.intent_router import is_filter_only_follow_up
    except ImportError:
        from commerce.intent_router import is_filter_only_follow_up

    prev = session_active_filters.get(session_id)

    if is_filter_only_follow_up(user_query):
        base = prev or BrowseFilters()
        incoming = base.merge(extract_filters_from_text(user_query))
        incoming = incoming.merge(extract_filters_from_text(browse_query))
    else:
        incoming = extract_filters_from_text(user_query)
        if not incoming.is_active():
            incoming = extract_filters_from_text(browse_query)

    if category_lock:
        incoming.category = category_lock

    if incoming.use_case is None and is_filter_only_follow_up(user_query) and prev:
        incoming.use_case = prev.use_case

    session_active_filters[session_id] = incoming
    return incoming


def get_session_filters(session_id: str) -> BrowseFilters:
    return session_active_filters.get(session_id) or BrowseFilters()


def _parse_inr(price: str) -> int:
    return int(re.sub(r"[^\d]", "", str(price)) or "0")


def _color_matches(colorway: str, color_filter: str) -> bool:
    c = colorway.lower()
    needle = _normalize_color(color_filter)
    aliases = COLOR_ALIASES.get(needle, (needle,))
    return any(alias in c for alias in aliases)


def product_passes_filters(product: dict, filters: BrowseFilters) -> bool:
    if not filters.is_active():
        return True

    price = _parse_inr(product.get("price", ""))
    if filters.max_price is not None and price > filters.max_price:
        return False
    if filters.min_price is not None and price < filters.min_price:
        return False

    if filters.category and product.get("category") != filters.category:
        return False

    if filters.audience:
        aud = product.get("audience", "unisex")
        if aud not in (filters.audience, "unisex"):
            return False

    if filters.size:
        sizes = [str(s).upper() for s in product.get("sizes", [])]
        if filters.size.upper() not in sizes:
            return False

    if filters.color:
        colors = product.get("colors") or []
        if not any(_color_matches(c, filters.color) for c in colors):
            return False

    if filters.use_case:
        hay = _haystack(product)
        sport = str(product.get("sport", "")).lower()
        uc = filters.use_case
        if uc == "running" and sport != "running":
            return False
        if uc == "hiking" and sport != "outdoor" and not any(
            x in hay for x in ("hiking", "trail", "terrex", "outdoor")
        ):
            return False
        if uc == "football" and sport != "football":
            return False
        if uc == "basketball" and sport != "basketball":
            return False
        if uc == "lifestyle" and sport != "lifestyle":
            return False

    return True


def matching_colorway(product: dict, color_filter: str) -> str:
    for c in product.get("colors") or []:
        if _color_matches(c, color_filter):
            return c
    colors = product.get("colors") or []
    return colors[0] if colors else ""


def apply_filters_to_tiles(tiles: list[dict], filters: BrowseFilters) -> list[dict]:
    if not filters.is_active():
        return tiles
    out: list[dict] = []
    for tile in tiles:
        raw = _raw_product_by_id(str(tile.get("id", "")))
        if raw and product_passes_filters(raw, filters):
            enriched = dict(tile)
            if filters.color:
                enriched["color"] = matching_colorway(raw, filters.color)
            out.append(enriched)
    return out


def apply_filters_to_cards(cards: list[dict], filters: BrowseFilters) -> list[dict]:
    if not filters.is_active():
        return cards
    out: list[dict] = []
    for card in cards:
        raw = _raw_product_by_id(str(card.get("id", "")))
        if raw and product_passes_filters(raw, filters):
            out.append(card)
    return out


def _catalog_pool(query: str, category_lock: Optional[str], filters: BrowseFilters) -> list[dict]:
    lock = filters.category or category_lock
    return match_products(query, max_results=50, category_lock=lock)

def _broad_pool(filters: BrowseFilters) -> list[dict]:
    """Raw catalogue scan for strict filter fallback (ignores query tokens)."""
    out: list[dict] = []
    for p in _all_products():
        if product_passes_filters(p, filters):
            out.append(p)
    return out

def _prefer_topwear_score(query: str, product: dict) -> int:
    q = query.lower()
    hay = _haystack(product)
    score = 0
    if any(w in q for w in ("jersey", "kit")):
        if any(x in hay for x in ("jersey", "tee", "t-shirt", "shirt")):
            score += 30
        if any(x in hay for x in ("hoodie", "jacket", "track top")):
            score += 18
        if any(x in hay for x in ("short", "shorts", "pant", "pants", "jogger")):
            score -= 15
    return score


def closest_above_price(
    query: str,
    filters: BrowseFilters,
    category_lock: Optional[str],
) -> Optional[dict]:
    if filters.max_price is None:
        return None
    relaxed = BrowseFilters(
        min_price=filters.min_price,
        color=filters.color,
        size=filters.size,
        audience=filters.audience,
        category=filters.category,
    )
    pool = _catalog_pool(query, category_lock, relaxed)
    above = []
    for card in pool:
        raw = _raw_product_by_id(str(card.get("id", "")))
        if not raw or not product_passes_filters(raw, relaxed):
            continue
        price = _parse_inr(raw.get("price", ""))
        if price > filters.max_price:
            above.append((price, card))
    if not above:
        return None
    above.sort(key=lambda x: x[0])
    return above[0][1]


def build_no_match_line(
    browse_query: str,
    filters: BrowseFilters,
    category_lock: Optional[str],
) -> str:
    """One-line honest miss + optional closest pivot."""
    if filters.color:
        without_color = BrowseFilters(
            max_price=filters.max_price,
            min_price=filters.min_price,
            size=filters.size,
            audience=filters.audience,
            category=filters.category,
        )
        pool = apply_filters_to_cards(_catalog_pool(browse_query, category_lock, without_color), without_color)
        if not pool and filters.max_price is not None:
            alt = closest_above_price(browse_query, filters, category_lock)
            if alt:
                return (
                    f"No {filters.color} options in that range — closest is "
                    f"{alt.get('name', '')} at {alt.get('price', '')}."
                )
            return f"Nothing under ₹{filters.max_price:,} in that category."
        if not pool:
            return f"No {filters.color} options in that one."
        alt = pool[0]
        return (
            f"No {filters.color} options in that one — closest is "
            f"{alt.get('name', '')} in {(alt.get('colors') or ['another color'])[0]}."
        )

    if filters.max_price is not None:
        alt = closest_above_price(browse_query, filters, category_lock)
        if alt:
            return (
                f"Nothing under ₹{filters.max_price:,} — closest is "
                f"{alt.get('name', '')} at {alt.get('price', '')}."
            )
        return f"Nothing under ₹{filters.max_price:,} in that category."

    return "Nothing matches those filters right now."


def match_products_constrained(
    query: str,
    max_results: int,
    category_lock: Optional[str],
    filters: BrowseFilters,
) -> tuple[list[dict], Optional[str]]:
    """
    Hard-filtered catalog match.
    Returns (tiles/cards, optional no-match line when empty).
    """
    pool = _catalog_pool(query, category_lock, filters)
    strict = apply_filters_to_cards(pool, filters)
    if strict:
        try:
            from commerce.tile_validator import find_catalog_product, product_to_tile
        except ImportError:
            from commerce.tile_validator import find_catalog_product, product_to_tile
        tiles: list[dict] = []
        for card in strict[:max_results]:
            raw = _raw_product_by_id(str(card.get("id", "")))
            if not raw:
                continue
            try:
                from commerce.tile_validator import product_to_tile
            except ImportError:
                from commerce.tile_validator import product_to_tile
            tile = product_to_tile(raw)
            if filters.color:
                tile["color"] = matching_colorway(raw, filters.color)
            tiles.append(tile)
        return tiles, None

    # Fallback: keep hard filters but broaden the search beyond query tokens.
    if filters.is_active():
        broad = _broad_pool(filters)
        if broad:
            broad.sort(
                key=lambda p: (
                    -_prefer_topwear_score(query, p),
                    _parse_inr(p.get("price", "")) or 10**9,
                )
            )
            try:
                from commerce.tile_validator import product_to_tile
            except ImportError:
                from commerce.tile_validator import product_to_tile
            tiles: list[dict] = []
            for p in broad[: max_results * 2]:
                tile = product_to_tile(p)
                if filters.color:
                    tile["color"] = matching_colorway(p, filters.color)
                tiles.append(tile)
                if len(tiles) >= max_results:
                    break
            if tiles:
                return tiles, None

    note = build_no_match_line(query, filters, category_lock)
    return [], note


def filters_context_hint(session_id: str) -> str:
    filters = get_session_filters(session_id)
    if not filters.is_active():
        return ""
    return (
        "[HARD FILTERS — every tile/table row MUST match; never show out-of-range items]\n"
        f"- Active: {filters.describe()}\n"
        "- Stack follow-up filters; keep all until topic changes or user clears them.\n"
        "- If zero matches: one honest line, then closest alternative — never silent violations."
    )
