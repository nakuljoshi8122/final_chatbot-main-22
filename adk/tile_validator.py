"""Validate agent TILES against the real Adidas catalogue + pagination."""

import json
import re
from typing import Optional

try:
    from .adidas_catalog import all_products
    from .product_matcher import (
        format_product_card,
        match_products,
        is_product_related,
        is_browse_refinement,
        is_feedback_or_complaint,
        is_comparison_query,
        resolve_comparison_tiles,
        is_informational_query,
        informational_allowed_tiles,
        needs_full_information,
        is_buying_signal,
        is_show_explicit_request,
        is_best_recommendation_query,
        infer_category_from_query,
        categories_conflict,
        merge_browse_queries,
        should_use_browse_flow,
    )
except ImportError:
    from adidas_catalog import all_products
    from product_matcher import (
        format_product_card,
        match_products,
        is_product_related,
        is_browse_refinement,
        is_feedback_or_complaint,
        is_comparison_query,
        resolve_comparison_tiles,
        is_informational_query,
        informational_allowed_tiles,
        needs_full_information,
        is_buying_signal,
        is_show_explicit_request,
        is_best_recommendation_query,
        infer_category_from_query,
        categories_conflict,
        merge_browse_queries,
        should_use_browse_flow,
    )

TILES_REGEX = re.compile(r"<TILES>([\s\S]*?)</TILES>", re.IGNORECASE)
TILE_SINGULAR_RE = re.compile(r"<TILE>\s*(\{[\s\S]*?\})\s*</TILE>", re.IGNORECASE)
ORPHAN_TILE_JSON_RE = re.compile(
    r"\{[^{}]*\"id\"\s*:\s*\"[^\"]+\"[^{}]*\"name\"\s*:\s*\"[^\"]+\"[^{}]*\}",
    re.IGNORECASE,
)
TABLE_BLOCK_RE = re.compile(r"<TABLE>[\s\S]*?</TABLE>", re.IGNORECASE)
HTML_TABLE_RE = re.compile(r"<table[\s\S]*?</table>", re.IGNORECASE)

DEFAULT_TILE_COUNT = 5
MAX_BULK_TILE_COUNT = 20
NICHE_THRESHOLD = 3  # hide "show more" when category has ≤2 real matches

SHOW_MORE_RE = re.compile(
    r"show\s+(me\s+)?more|more\s+options|more\s+like\s+these",
    re.IGNORECASE,
)
SHOW_ALL_RE = re.compile(
    r"show\s+(me\s+)?(all|everything)|all\s+(of\s+them|products|options)",
    re.IGNORECASE,
)
COUNT_RE = re.compile(r"show\s+(me\s+)?(\d+)\b", re.IGNORECASE)

session_shown_products: dict[str, set[str]] = {}
session_last_browse_query: dict[str, str] = {}
session_browse_category: dict[str, str] = {}


def _slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


try:
    from .product_images import get_product_image
except ImportError:
    from product_images import get_product_image


def is_show_more_request(user_query: str) -> bool:
    return bool(SHOW_MORE_RE.search(user_query.strip()))


def resolve_tile_limit(user_query: str) -> tuple[int, bool]:
    """Return (tile_limit, is_bulk). Bulk = user asked for all or a specific count."""
    q = user_query.strip()
    if SHOW_ALL_RE.search(q):
        return MAX_BULK_TILE_COUNT, True
    count_match = COUNT_RE.search(q)
    if count_match:
        return min(int(count_match.group(2)), MAX_BULK_TILE_COUNT), True
    return DEFAULT_TILE_COUNT, False


NEW_TOPIC_RE = re.compile(
    r"\b(shoes?|sneakers?|footwear|boots?|cleats?|studs?|trainers?|"
    r"shirt|tee|hoodie|jersey|jacket|leggings?|pants?|joggers?|shorts?|"
    r"ball|backpack|bag|racket|gloves?|equipment)\b",
    re.IGNORECASE,
)


def resolve_browse_query(
    session_id: str,
    user_query: str,
    conversation_history: dict,
) -> tuple[str, bool, Optional[str]]:
    """
    Build the effective catalog search query from chat context.

    Returns (browse_query, is_fresh_browse, category_lock).
    """
    try:
        from .conversation_context import resolve_browse_query_enhanced
        from .browse_filters import on_browse_turn
    except ImportError:
        from conversation_context import resolve_browse_query_enhanced
        from browse_filters import on_browse_turn

    browse_query, is_fresh, category_lock, switched = resolve_browse_query_enhanced(
        session_id,
        user_query,
        conversation_history,
        session_last_browse=session_last_browse_query,
        session_category_lock=session_browse_category,
        find_last_browse_query=find_last_browse_query,
        is_show_more_request=is_show_more_request,
    )
    on_browse_turn(
        session_id,
        user_query,
        browse_query,
        is_fresh=is_fresh,
        category_lock=category_lock,
        switched_from=switched,
    )
    return browse_query, is_fresh, category_lock


def _update_browse_session(
    session_id: str,
    browse_query: str,
    is_fresh: bool,
    category_lock: Optional[str],
) -> None:
    try:
        from .conversation_context import record_browse_turn
    except ImportError:
        from conversation_context import record_browse_turn

    prev_topic = session_last_browse_query.get(session_id, "") if is_fresh else None
    session_last_browse_query[session_id] = browse_query
    if category_lock:
        session_browse_category[session_id] = category_lock
    record_browse_turn(
        session_id,
        browse_query,
        is_fresh,
        category_lock,
        previous_topic=prev_topic if is_fresh and prev_topic else None,
    )
    if is_fresh and not is_show_more_request(browse_query):
        session_shown_products[session_id] = set()


def _browse_intro(is_refinement: bool) -> str:
    if is_refinement:
        return "Narrowed down from your last search — tap a tile for details."
    return "Here are some picks — tap a tile for details."


def find_last_browse_query(session_id: str, conversation_history: dict) -> str:
    cached = session_last_browse_query.get(session_id, "")
    if cached:
        return cached
    messages = conversation_history.get(session_id, [])
    for msg in reversed(messages):
        if msg.get("role") != "user":
            continue
        text = msg.get("content", "")
        if is_show_more_request(text):
            continue
        if is_product_related(text) or is_browse_refinement(text):
            return text
    return ""


def find_catalog_product(name: str) -> Optional[dict]:
    if not name:
        return None
    name_lower = name.lower().strip()
    for product in all_products():
        if product["name"].lower() == name_lower:
            return product
    for product in all_products():
        pn = product["name"].lower()
        if name_lower in pn or pn in name_lower:
            return product
    tokens = set(re.findall(r"[a-z0-9]+", name_lower))
    best: Optional[dict] = None
    best_score = 0
    for product in all_products():
        pn_tokens = set(re.findall(r"[a-z0-9]+", product["name"].lower()))
        score = len(tokens & pn_tokens)
        if score > best_score and score >= 2:
            best_score = score
            best = product
    return best


def product_to_tile(product: dict, tag: str = "") -> dict:
    card = format_product_card(product)
    colors = product.get("colors", [])
    features = card.get("features", [])[:2]
    slug = _slugify(product["name"])
    tile = {
        "id": product["id"],
        "name": product["name"],
        "price": product["price"],
        "category": card["category"],
        "description": card["description"],
        "features": features,
        "tag": tag or None,
        "color": colors[0] if colors else "",
        "url": f"https://www.adidas.co.in/{slug}",
        "img": get_product_image(product),
    }
    if tag:
        tile["tag"] = tag
    return tile


def validate_tile_entry(entry: dict) -> Optional[dict]:
    product = find_catalog_product(str(entry.get("name", "")))
    if not product:
        return None
    return product_to_tile(product, tag=str(entry.get("tag") or "") or "")


def match_products_excluding(
    query: str,
    exclude_ids: set[str],
    max_results: int = 50,
    category_lock: Optional[str] = None,
    session_id: str = "",
) -> list[dict]:
    try:
        from .browse_filters import get_session_filters, apply_filters_to_cards
    except ImportError:
        from browse_filters import get_session_filters, apply_filters_to_cards

    filters = get_session_filters(session_id)
    cards = match_products(query, max_results=50, category_lock=category_lock)
    cards = apply_filters_to_cards(cards, filters)
    filtered = [c for c in cards if c["id"] not in exclude_ids]
    return filtered[:max_results]


def count_available_for_query(
    query: str,
    category_lock: Optional[str] = None,
    session_id: str = "",
) -> int:
    if not query:
        return 0
    lock = category_lock or infer_category_from_query(query)
    if not is_product_related(query) and not is_browse_refinement(query) and not lock:
        return 0
    return len(
        match_products_excluding(
            query, set(), max_results=50, category_lock=lock, session_id=session_id
        )
    )


def build_catalog_tiles(
    browse_query: str,
    limit: int,
    exclude_ids: set[str],
    category_lock: Optional[str] = None,
    session_id: str = "",
) -> tuple[list[dict], Optional[str]]:
    try:
        from .browse_filters import get_session_filters, match_products_constrained
    except ImportError:
        from browse_filters import get_session_filters, match_products_constrained

    filters = get_session_filters(session_id)
    tiles, note = match_products_constrained(
        browse_query,
        limit + len(exclude_ids) + 10,
        category_lock,
        filters,
    )
    tiles = [t for t in tiles if str(t.get("id", "")) not in exclude_ids][:limit]
    return tiles, note


def compute_has_more(total_available: int, shown_count: int, is_bulk: bool) -> bool:
    if is_bulk:
        return False
    if total_available <= NICHE_THRESHOLD - 1:
        return False
    return shown_count < total_available


def try_fast_browse_response(
    user_query: str,
    session_id: str,
    conversation_history: Optional[dict] = None,
) -> Optional[tuple[str, dict]]:
    """Instant product browse without LLM — avoids slow agent calls for catalog queries."""
    history = conversation_history or {}
    prev = session_last_browse_query.get(session_id, "")
    if not should_use_browse_flow(user_query, prev) and not is_show_more_request(user_query):
        return None

    limit, is_bulk = resolve_tile_limit(user_query)
    is_more = is_show_more_request(user_query)
    browse_query, is_fresh, category_lock = resolve_browse_query(session_id, user_query, history)
    is_refinement = browse_query.strip().lower() != user_query.strip().lower()

    if is_more:
        shown = session_shown_products.setdefault(session_id, set())
        exclude = set(shown)
    else:
        _update_browse_session(session_id, browse_query, is_fresh, category_lock)
        shown = session_shown_products.setdefault(session_id, set())
        if is_fresh or is_refinement:
            session_shown_products[session_id] = set()
            shown = session_shown_products[session_id]
        exclude = set()

    tiles, note = build_catalog_tiles(
        browse_query, limit, exclude, category_lock=category_lock, session_id=session_id
    )
    if not tiles:
        if note:
            return rebuild_response_with_tiles(note, [], user_query=user_query), {
                "has_more": False,
                "total_available": 0,
            }
        return None

    for tile in tiles:
        shown.add(tile["id"])

    total_available = count_available_for_query(
        browse_query, category_lock=category_lock, session_id=session_id
    )
    meta = {
        "has_more": compute_has_more(total_available, len(shown), is_bulk),
        "total_available": total_available,
    }

    if is_more:
        intro = "More picks for you — tap any tile for details."
    else:
        intro = _browse_intro(is_refinement)
    return rebuild_response_with_tiles(intro, tiles), meta


def normalize_agent_markup(text: str) -> str:
    """Fix common LLM mistakes: <TILE> singular → <TILES> array."""
    if not text:
        return text

    def _to_tiles_block(match: re.Match) -> str:
        payload = match.group(1).strip()
        if payload.startswith("["):
            return f"<TILES>{payload}</TILES>"
        return f"<TILES>[{payload}]</TILES>"

    normalized = TILE_SINGULAR_RE.sub(_to_tiles_block, text)
    return normalized


def strip_agent_markup(text: str) -> str:
    """Remove TILES/TABLE blocks and stray HTML for visible text or TTS."""
    cleaned = normalize_agent_markup(text)
    for _ in range(5):
        prev = cleaned
        cleaned = TILES_REGEX.sub(" ", cleaned)
        cleaned = TILE_SINGULAR_RE.sub(" ", cleaned)
        cleaned = ORPHAN_TILE_JSON_RE.sub(" ", cleaned)
        cleaned = TABLE_BLOCK_RE.sub(" ", cleaned)
        cleaned = HTML_TABLE_RE.sub(" ", cleaned)
        if cleaned == prev:
            break
    cleaned = re.sub(r"<TILES>[\s\S]*", " ", cleaned, flags=re.IGNORECASE)
    if re.search(r"</TILES>", cleaned, re.IGNORECASE):
        cleaned = re.sub(r"[\s\S]*?</TILES>", " ", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"</?TABLE>", " ", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"</?TILES>", " ", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"</?TILE>", " ", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"</?t(head|body|r|h|d)[^>]*>", " ", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"<[^>]+>", " ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned


def _parse_tile_payload(payload: str) -> list[dict]:
    payload = payload.strip()
    if not payload:
        return []
    try:
        parsed = json.loads(payload)
    except json.JSONDecodeError:
        return []
    if isinstance(parsed, dict):
        return [parsed]
    if isinstance(parsed, list):
        return [entry for entry in parsed if isinstance(entry, dict)]
    return []


def _extract_all_tiles(response_text: str) -> list[dict]:
    tiles: list[dict] = []
    seen: set[str] = set()
    normalized = normalize_agent_markup(response_text)

    for match in TILES_REGEX.finditer(normalized):
        for entry in _parse_tile_payload(match.group(1)):
            tile = validate_tile_entry(entry)
            if tile:
                pid = str(tile.get("id", ""))
                if pid and pid not in seen:
                    seen.add(pid)
                    tiles.append(tile)

    for match in TILE_SINGULAR_RE.finditer(response_text):
        for entry in _parse_tile_payload(match.group(1)):
            tile = validate_tile_entry(entry)
            if tile:
                pid = str(tile.get("id", ""))
                if pid and pid not in seen:
                    seen.add(pid)
                    tiles.append(tile)

    for match in ORPHAN_TILE_JSON_RE.finditer(response_text):
        for entry in _parse_tile_payload(match.group(0)):
            tile = validate_tile_entry(entry)
            if tile:
                pid = str(tile.get("id", ""))
                if pid and pid not in seen:
                    seen.add(pid)
                    tiles.append(tile)

    return tiles


def _normalize_table_key(html: str) -> str:
    return re.sub(r"\s+", " ", html.strip().lower())


def dedupe_table_blocks(response_text: str) -> list[str]:
    """Keep one copy of each unique table (LLM sometimes duplicates)."""
    blocks: list[str] = []
    seen: set[str] = set()
    for match in TABLE_BLOCK_RE.finditer(response_text):
        block = match.group(0)
        inner = HTML_TABLE_RE.search(block)
        key = _normalize_table_key(inner.group(0) if inner else block)
        if key in seen:
            continue
        seen.add(key)
        blocks.append(block)
    return blocks


def tighten_summary_visible(visible: str, tile_count: int) -> str:
    """Summary mode: keep intro short but never wipe to silence before visuals."""
    visible = visible.strip()
    if not visible:
        return ""
    if tile_count >= 3:
        words = visible.split()
        return visible if len(words) <= 8 else " ".join(words[:8])
    if tile_count > 0 and len(visible.split()) > 10:
        return " ".join(visible.split()[:8])
    if len(visible.split()) > 22:
        first = visible.split(".")[0].strip()
        return f"{first}." if first else visible[:120].strip()
    return visible


def rebuild_response_with_tiles(
    response_text: str,
    tiles: list[dict],
    *,
    summary_mode: bool = False,
    user_query: str = "",
    prior_items: bool = False,
    best_pick: bool = False,
) -> str:
    """Clean visible text + preserved TABLE blocks + exactly one TILES block."""
    try:
        from .visual_handoff import ensure_visual_handoff
    except ImportError:
        from visual_handoff import ensure_visual_handoff

    table_blocks = [] if best_pick else dedupe_table_blocks(response_text)
    has_table = bool(table_blocks)
    if best_pick:
        visible = re.sub(r"<TILES>[\s\S]*", "", response_text, flags=re.IGNORECASE).strip()
        visible = re.sub(r"<TABLE>[\s\S]*?</TABLE>", "", visible, flags=re.IGNORECASE).strip()
    else:
        visible = strip_agent_markup(response_text).strip()
    if summary_mode:
        visible = tighten_summary_visible(visible, len(tiles))
    visible = ensure_visual_handoff(
        visible,
        user_query,
        tile_count=len(tiles),
        has_table=has_table,
        prior_items=prior_items,
    )
    parts: list[str] = []
    if visible:
        parts.append(visible)
    parts.extend(table_blocks)
    if tiles:
        parts.append(f"<TILES>{json.dumps(tiles)}</TILES>")
    return "\n".join(parts).strip()


def sanitize_adidas_response(
    response_text: str,
    user_query: str = "",
    session_id: str = "",
    conversation_history: Optional[dict] = None,
) -> tuple[str, dict]:
    """Validate/replace TILES, paginate, return (text, tile_meta)."""
    history = conversation_history or {}
    meta: dict = {"has_more": False, "total_available": 0}
    response_text = normalize_agent_markup(response_text)

    if not session_id:
        return response_text, meta

    summary_mode = not needs_full_information(user_query)

    limit, is_bulk = resolve_tile_limit(user_query)
    is_more = is_show_more_request(user_query)
    shown = session_shown_products.setdefault(session_id, set())

    browse_query, is_fresh, category_lock = resolve_browse_query(session_id, user_query, history)
    if is_more:
        exclude = set(shown)
    else:
        _update_browse_session(session_id, browse_query, is_fresh, category_lock)
        if is_fresh or browse_query.strip().lower() != user_query.strip().lower():
            session_shown_products[session_id] = set()
            shown = session_shown_products[session_id]
        exclude = set()

    agent_tiles = _extract_all_tiles(response_text)

    try:
        from .browse_filters import apply_filters_to_tiles, get_session_filters, build_no_match_line
    except ImportError:
        from browse_filters import apply_filters_to_tiles, get_session_filters, build_no_match_line

    active_filters = get_session_filters(session_id)

    if is_best_recommendation_query(user_query):
        try:
            from .best_recommendation import build_best_recommendation_response
        except ImportError:
            from best_recommendation import build_best_recommendation_response
        built = build_best_recommendation_response(user_query, history, session_id)
        if built:
            for tile in _extract_all_tiles(built):
                shown.add(str(tile.get("id", "")))
            return built, meta
        response_text = TABLE_BLOCK_RE.sub("", response_text)
        response_text = HTML_TABLE_RE.sub("", response_text)
        agent_tiles = _extract_all_tiles(response_text)

    try:
        from .prior_items import (
            is_describe_prior_items_query,
            get_prior_reference_items,
            build_describe_prior_response,
        )
    except ImportError:
        from prior_items import (
            is_describe_prior_items_query,
            get_prior_reference_items,
            build_describe_prior_response,
        )

    if is_describe_prior_items_query(user_query):
        prior = get_prior_reference_items(history, session_id)
        if prior:
            for tile in prior:
                shown.add(str(tile.get("id", "")))
            return build_describe_prior_response(prior, user_query), meta
        agent_tiles = []

    if is_informational_query(user_query):
        info_tiles = informational_allowed_tiles(user_query, response_text, agent_tiles)
        return rebuild_response_with_tiles(
            response_text, info_tiles, summary_mode=summary_mode, user_query=user_query
        ), meta

    has_table = bool(TABLE_BLOCK_RE.search(response_text))
    if is_comparison_query(user_query) and is_buying_signal(user_query):
        compare_tiles = resolve_comparison_tiles(user_query, response_text, agent_tiles)
        for tile in compare_tiles:
            shown.add(tile["id"])
        return rebuild_response_with_tiles(
            response_text, compare_tiles, summary_mode=False, user_query=user_query
        ), meta

    if has_table and not is_show_more_request(user_query) and not is_bulk and is_buying_signal(user_query):
        compare_tiles = resolve_comparison_tiles(user_query, response_text, agent_tiles)
        if compare_tiles:
            for tile in compare_tiles:
                shown.add(tile["id"])
            return rebuild_response_with_tiles(
                response_text, compare_tiles, summary_mode=False, user_query=user_query
            ), meta
        if agent_tiles:
            return rebuild_response_with_tiles(
                response_text, agent_tiles[:3], summary_mode=summary_mode, user_query=user_query
            ), meta
        return rebuild_response_with_tiles(
            response_text, [], summary_mode=False, user_query=user_query
        ), meta

    if has_table and not is_show_more_request(user_query) and not is_bulk:
        return rebuild_response_with_tiles(
            response_text, [], summary_mode=False, user_query=user_query
        ), meta

    browse_flow = should_use_browse_flow(
        user_query,
        session_last_browse_query.get(session_id, ""),
    )
    if not (browse_flow or is_more):
        if agent_tiles:
            return rebuild_response_with_tiles(
                response_text, agent_tiles[:limit], summary_mode=summary_mode, user_query=user_query
            ), meta
        if TABLE_BLOCK_RE.search(response_text):
            return rebuild_response_with_tiles(
                response_text, [], summary_mode=summary_mode, user_query=user_query
            ), meta
        return strip_agent_markup(response_text), meta

    total_available = count_available_for_query(
        browse_query, category_lock=category_lock, session_id=session_id
    )
    meta["total_available"] = total_available

    if is_more:
        exclude = set(shown)
    catalog_tiles, filter_note = build_catalog_tiles(
        browse_query, limit, exclude, category_lock=category_lock, session_id=session_id
    )

    if active_filters.is_active():
        agent_tiles = apply_filters_to_tiles(agent_tiles, active_filters)

    if agent_tiles and len(agent_tiles) >= min(4, limit):
        seen = {t["id"] for t in agent_tiles}
        merged = [t for t in agent_tiles if t["id"] not in exclude][:limit]
        if len(merged) < limit:
            for tile in catalog_tiles:
                if tile["id"] not in seen and tile["id"] not in exclude:
                    merged.append(tile)
                if len(merged) >= limit:
                    break
        catalog_tiles = merged[:limit]
    elif not catalog_tiles and browse_query:
        catalog_tiles, filter_note = build_catalog_tiles(
            browse_query, limit, exclude, category_lock=category_lock, session_id=session_id
        )

    for tile in catalog_tiles:
        shown.add(tile["id"])

    if catalog_tiles:
        meta["has_more"] = compute_has_more(total_available, len(shown), is_bulk)
        return rebuild_response_with_tiles(
            response_text, catalog_tiles, summary_mode=True, user_query=user_query
        ), meta

    if filter_note or active_filters.is_active():
        try:
            from .intent_router import is_filter_only_follow_up
        except ImportError:
            from intent_router import is_filter_only_follow_up

        if is_comparison_query(user_query) and not is_buying_signal(user_query):
            return rebuild_response_with_tiles(
                response_text, agent_tiles[:limit], summary_mode=summary_mode, user_query=user_query
            ), meta

        if not is_filter_only_follow_up(user_query) and not catalog_tiles:
            catalog_tiles, _ = build_catalog_tiles(
                browse_query, limit, exclude, category_lock=category_lock, session_id=session_id
            )

        note = filter_note
        if not note and is_filter_only_follow_up(user_query):
            note = build_no_match_line(browse_query, active_filters, category_lock)

        if note and not catalog_tiles:
            meta["has_more"] = False
            return rebuild_response_with_tiles(note, [], summary_mode=True, user_query=user_query), meta

        if catalog_tiles:
            meta["has_more"] = compute_has_more(total_available, len(shown), is_bulk)
            return rebuild_response_with_tiles(
                response_text, catalog_tiles, summary_mode=True, user_query=user_query
            ), meta

    meta["has_more"] = compute_has_more(total_available, len(shown), is_bulk)
    return strip_agent_markup(response_text), meta
