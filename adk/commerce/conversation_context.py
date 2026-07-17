"""Session conversation memory — browse continuity, use-case switches, pronoun resolution."""

from __future__ import annotations

import re
from typing import Optional

try:
    from commerce.product_matcher import (
        AUDIENCE_KEYWORDS,
        CATEGORY_KEYWORDS,
        categories_conflict,
        infer_category_from_query,
        is_browse_refinement,
        is_feedback_or_complaint,
        is_product_related,
        merge_browse_queries,
    )
    from commerce.prior_items import get_prior_reference_items, is_describe_prior_items_query
    from commerce.session_commerce import parse_tiles_from_text, session_active_product
except ImportError:
    from commerce.product_matcher import (
        AUDIENCE_KEYWORDS,
        CATEGORY_KEYWORDS,
        categories_conflict,
        infer_category_from_query,
        is_browse_refinement,
        is_feedback_or_complaint,
        is_product_related,
        merge_browse_queries,
    )
    from commerce.prior_items import get_prior_reference_items, is_describe_prior_items_query
    from commerce.session_commerce import parse_tiles_from_text, session_active_product

USE_CASE_PATTERNS: dict[str, tuple[str, ...]] = {
    "running": ("running", "runner", "runners", "jog", "jogging", "marathon", "mile", "tempo"),
    "hiking": ("trek", "trekking", "hike", "hiking", "trail", "terrex", "outdoor"),
    "football": ("football", "soccer", "pitch", "cleat", "cleats", "stud", "studs"),
    "training": ("gym", "training", "workout", "crossfit", "lift"),
    "basketball": ("basketball", "hoops", "court"),
    "lifestyle": ("lifestyle", "casual", "street", "everyday"),
    "cricket": ("cricket",),
    "swim": ("swim", "swimming", "pool"),
}

CONTEXT_SWITCH_RE = re.compile(
    r"\b(what about|how about|instead|rather|now for|switch to|change to)\b",
    re.IGNORECASE,
)

FOLLOW_UP_CONTINUATION_RE = re.compile(
    r"^(and\s+)?(what about|how about)\b|"
    r"\b(for women|for men|for kids|for ladies|for boys|for girls|for her|for him)\b|"
    r"\b(anything in|any in|in (black|white|red|blue|grey|gray|green|pink|olive|navy))\b|"
    r"\b(cheaper|more affordable|any cheaper|lower price|less expensive|something lighter)\b",
    re.IGNORECASE,
)

ORDINAL_REF_RE = re.compile(
    r"\b(the\s+)?(first|1st|second|2nd|third|3rd|fourth|4th|fifth|5th|last)\s+"
    r"(one|pair|item|shoe|sneaker|trainer|boot|jersey|hoodie|tee)?\b",
    re.IGNORECASE,
)
OTHER_ONE_RE = re.compile(r"\b(that other one|the other one|other one)\b", re.IGNORECASE)
SINGULAR_REF_RE = re.compile(
    r"\b(that|it|this one|the one|that one)\b(?!\s+(one|pair)\b)",
    re.IGNORECASE,
)
PRODUCT_REFERENCE_RE = re.compile(
    r"\b(the\s+)?(first|1st|second|2nd|third|3rd|fourth|4th|fifth|5th|last)\s+"
    r"(one|pair|item|shoe|sneaker)?\b|"
    r"\b(that other one|the other one|other one)\b|"
    r"\b(that|it|this one|the one|that one)\b",
    re.IGNORECASE,
)

ORDINAL_INDEX = {
    "first": 0, "1st": 0,
    "second": 1, "2nd": 1,
    "third": 2, "3rd": 2,
    "fourth": 3, "4th": 3,
    "fifth": 4, "5th": 4,
    "last": -1,
}

session_last_shown_tiles: dict[str, list[dict]] = {}
session_previous_use_case: dict[str, str] = {}
session_current_use_case: dict[str, str] = {}
session_previous_browse_query: dict[str, str] = {}


def infer_use_case(query: str) -> Optional[str]:
    q = query.lower()
    for use_case, keywords in USE_CASE_PATTERNS.items():
        if any(re.search(rf"\b{re.escape(k)}\b", q) for k in keywords):
            return use_case
    return None


def use_cases_conflict(query_a: str, query_b: str) -> bool:
    a = infer_use_case(query_a)
    b = infer_use_case(query_b)
    return bool(a and b and a != b)


def is_follow_up_continuation(query: str) -> bool:
    q = query.strip()
    if not q:
        return False
    if FOLLOW_UP_CONTINUATION_RE.search(q):
        return True
    if is_browse_refinement(q) and len(q.split()) <= 8:
        return True
    return False


def is_context_switch(query: str, previous_query: str) -> bool:
    if not previous_query:
        return False
    if use_cases_conflict(query, previous_query):
        return True
    if CONTEXT_SWITCH_RE.search(query) and infer_use_case(query):
        prev_use = infer_use_case(previous_query)
        new_use = infer_use_case(query)
        if new_use and prev_use and new_use != prev_use:
            return True
    return False


def _category_noun(previous_query: str, category_lock: Optional[str]) -> str:
    q = previous_query.lower()
    if category_lock == "footwear" or re.search(
        r"\b(shoes?|sneakers?|footwear|trainers?|boots?|cleats?)\b", q
    ):
        return "shoes"
    if category_lock == "clothing":
        for noun in ("jersey", "hoodie", "tee", "shirt", "leggings", "shorts", "jacket", "bra"):
            if noun in q:
                return noun + ("s" if noun in ("legging", "short") else "")
        return "clothing"
    if category_lock == "sports_equipment":
        return "equipment"
    return ""


def _build_switch_query(
    previous_query: str,
    query: str,
    category_lock: Optional[str],
) -> str:
    new_use = infer_use_case(query)
    if not new_use:
        m = re.search(r"\bfor\s+([a-z]+)\b", query.lower())
        if m:
            new_use = infer_use_case(m.group(1))
    noun = _category_noun(previous_query, category_lock)
    if new_use and noun:
        return f"{new_use} {noun}"
    if new_use and category_lock == "footwear":
        return f"{new_use} shoes"
    return query.strip()


def _strip_audience_terms(text: str) -> str:
    out = text
    for keywords in AUDIENCE_KEYWORDS.values():
        for k in keywords:
            out = re.sub(rf"\b{re.escape(k)}\b", "", out, flags=re.IGNORECASE)
    return re.sub(r"\s+", " ", out).strip()


def merge_contextual_query(base: str, addition: str) -> str:
    """Merge follow-up filters onto the active browse thread."""
    add_l = addition.lower()
    for _audience, keywords in AUDIENCE_KEYWORDS.items():
        if any(re.search(rf"\b{re.escape(k)}\b", add_l) for k in keywords):
            stripped = _strip_audience_terms(base)
            return merge_browse_queries(stripped, addition)
    return merge_browse_queries(base, addition)


def record_browse_turn(
    session_id: str,
    browse_query: str,
    is_fresh: bool,
    category_lock: Optional[str],
    previous_topic: Optional[str] = None,
) -> None:
    if is_fresh and previous_topic:
        session_previous_browse_query[session_id] = previous_topic
        prev_use = infer_use_case(previous_topic)
        if prev_use:
            session_previous_use_case[session_id] = prev_use
    use_case = infer_use_case(browse_query)
    if use_case:
        session_current_use_case[session_id] = use_case


def record_shown_tiles(session_id: str, response_text: str) -> None:
    tiles = parse_tiles_from_text(response_text)
    if tiles:
        session_last_shown_tiles[session_id] = list(tiles)


def get_last_shown_tiles(
    conversation_history: dict,
    session_id: str,
) -> list[dict]:
    cached = session_last_shown_tiles.get(session_id)
    if cached:
        return list(cached)
    prior = get_prior_reference_items(conversation_history, session_id)
    if prior:
        session_last_shown_tiles[session_id] = list(prior)
        return prior
    return []


def _parse_ordinal_index(query: str, count: int) -> Optional[int]:
    if count <= 0:
        return None
    m = ORDINAL_REF_RE.search(query)
    if not m:
        return None
    word = m.group(2).lower()
    idx = ORDINAL_INDEX.get(word)
    if idx is None:
        return None
    if idx == -1:
        return count - 1
    return idx if idx < count else None


def resolve_referenced_products(
    query: str,
    session_id: str,
    conversation_history: dict,
) -> tuple[list[dict], str]:
    """
    Resolve pronouns / ordinals to concrete products.
    Returns (products, resolution_note).
    """
    shown = get_last_shown_tiles(conversation_history, session_id)
    if not shown:
        active = session_active_product.get(session_id)
        if active:
            return [active], f"Active product: {active.get('name', '')}"
        return [], ""

    if OTHER_ONE_RE.search(query):
        active = session_active_product.get(session_id)
        if active and len(shown) >= 2:
            for tile in shown:
                if str(tile.get("id")) != str(active.get("id")):
                    return [tile], f"Other one (not {active.get('name')}): {tile.get('name', '')}"
        if len(shown) >= 2:
            return [shown[1]], f"Second shown: {shown[1].get('name', '')}"

    idx = _parse_ordinal_index(query, len(shown))
    if idx is not None:
        tile = shown[idx]
        return [tile], f"#{idx + 1} shown: {tile.get('name', '')}"

    if re.search(r"\b(them|those|these)\b", query, re.IGNORECASE):
        if is_describe_prior_items_query(query):
            return shown, "All items from last reply"
        return shown, "Those from last shown set"

    if SINGULAR_REF_RE.search(query):
        active = session_active_product.get(session_id)
        if active:
            return [active], f"Most recent (tapped): {active.get('name', '')}"
        if len(shown) == 1:
            return [shown[0]], f"Only shown: {shown[0].get('name', '')}"
        return [shown[-1]], f"Most recent shown: {shown[-1].get('name', '')}"

    return [], ""


def resolve_browse_query_enhanced(
    session_id: str,
    user_query: str,
    conversation_history: dict,
    *,
    session_last_browse: dict[str, str],
    session_category_lock: dict[str, str],
    find_last_browse_query,
    is_show_more_request,
) -> tuple[str, bool, Optional[str], Optional[str]]:
    """
    Build effective catalog search from chat context.

    Returns (browse_query, is_fresh_browse, category_lock, switched_from_topic).
    """
    q = user_query.strip()
    prev = session_last_browse.get(session_id, "") or find_last_browse_query(
        session_id, conversation_history
    )
    prev_lock = session_category_lock.get(session_id)
    switched_from: Optional[str] = None

    if is_show_more_request(q):
        return (prev or q, False, prev_lock, None)

    if is_feedback_or_complaint(q):
        return (q, False, prev_lock, None)

    if not prev:
        lock = infer_category_from_query(q) or prev_lock
        return (q, True, lock, None)

    try:
        from commerce.intent_router import is_filter_only_follow_up
    except ImportError:
        from commerce.intent_router import is_filter_only_follow_up

    if is_filter_only_follow_up(q):
        merged = merge_contextual_query(prev, q)
        lock = infer_category_from_query(merged) or prev_lock
        return (merged, False, lock, None)

    # Every other message is a fresh instruction — do not merge prior browse thread.
    lock = infer_category_from_query(q) or prev_lock
    return (q, True, lock, None)


def maybe_clarification_line(session_id: str, query: str) -> Optional[str]:
    """One-line clarification only when context is truly unknowable."""
    prev_use = session_previous_use_case.get(session_id)
    curr_use = session_current_use_case.get(session_id) or infer_use_case(query)
    if prev_use and curr_use and prev_use != curr_use:
        labels = {"hiking": "trekking", "running": "running", "football": "football"}
        a = labels.get(prev_use, prev_use)
        b = labels.get(curr_use, curr_use)
        return f"The {a} ones or the {b} ones?"
    return None


def is_product_reference_query(query: str) -> bool:
    if is_describe_prior_items_query(query):
        return False
    if not PRODUCT_REFERENCE_RE.search(query):
        return False
    if re.search(r"\b(them|those|these)\b", query, re.IGNORECASE) and not ORDINAL_REF_RE.search(query):
        return False
    return True


def _tv():
    try:
        from commerce.tile_validator import find_catalog_product, product_to_tile, rebuild_response_with_tiles
    except ImportError:
        from commerce.tile_validator import find_catalog_product, product_to_tile, rebuild_response_with_tiles
    return find_catalog_product, product_to_tile, rebuild_response_with_tiles


def _product_blurb(tile: dict) -> str:
    features = tile.get("features") or []
    if features:
        return str(features[0])
    return str(tile.get("description", "")).strip() or "Solid pick."


def build_referenced_product_response(
    tile: dict,
    user_query: str,
    resolution_note: str = "",
) -> str:
    find_catalog, to_tile, rebuild = _tv()
    product = find_catalog(str(tile.get("name", "")))
    enriched = to_tile(product) if product else dict(tile)
    name = enriched.get("name", "")
    blurb = _product_blurb(enriched)
    q = user_query.lower()
    if re.search(r"\b(price|cost|how much)\b", q):
        line = f"{name} — {enriched.get('price', '')}."
    elif re.search(r"\b(size|sizes)\b", q):
        sizes = enriched.get("sizes") or []
        line = f"{name} — sizes {', '.join(sizes[:6])}." if sizes else f"{name} — {blurb}"
    else:
        line = f"{name} — {blurb}"
    return rebuild(line, [enriched], summary_mode=False, user_query=user_query)


def try_referenced_product_response(
    user_query: str,
    session_id: str,
    conversation_history: dict,
) -> Optional[str]:
    """Answer about a specific referenced product (ordinal / that / it)."""
    if not is_product_reference_query(user_query):
        return None
    products, note = resolve_referenced_products(user_query, session_id, conversation_history)
    if len(products) == 1:
        return build_referenced_product_response(products[0], user_query, note)
    if not products:
        return maybe_clarification_line(session_id, user_query)
    return None


def resolve_single_product_for_commerce(
    session_id: str,
    conversation_history: dict,
) -> tuple[Optional[dict], list[dict]]:
    """Most recent single product for add-to-cart — tapped first, else last shown."""
    active = session_active_product.get(session_id)
    if active:
        return active, []
    shown = get_last_shown_tiles(conversation_history, session_id)
    if len(shown) == 1:
        return shown[0], []
    if shown:
        return shown[-1], []
    return None, []


def conversation_context_hint(
    session_id: str,
    user_query: str,
    conversation_history: dict,
    *,
    session_last_browse: dict[str, str],
) -> str:
    """Inject session memory so the LLM never loses thread."""
    lines: list[str] = []
    prev_browse = session_last_browse.get(session_id, "")
    prev_topic = session_previous_browse_query.get(session_id, "")
    curr_use = session_current_use_case.get(session_id, "")
    shown = get_last_shown_tiles(conversation_history, session_id)

    if prev_browse:
        lines.append(f"Active browse thread: {prev_browse}")
    if prev_topic:
        lines.append(f"User was previously looking at: {prev_topic} — do not mix unless they compare")
    if curr_use:
        lines.append(f"Current use case: {curr_use}")

    if shown:
        ordered = ", ".join(
            f"{i + 1}) {t.get('name', '')}" for i, t in enumerate(shown[:6])
        )
        lines.append(f"Last shown (tile order): {ordered}")

    products, note = resolve_referenced_products(user_query, session_id, conversation_history)
    if note:
        lines.append(f"Pronoun/ordinal resolve: {note}")
    elif products and len(products) == 1:
        lines.append(f"'that/it' → {products[0].get('name', '')}")

    if is_follow_up_continuation(user_query) and prev_browse:
        merged = merge_contextual_query(prev_browse, user_query)
        lines.append(
            f"Follow-up — continue thread as: \"{merged}\" (NOT a new conversation)"
        )
        try:
            from commerce.browse_filters import get_session_filters
        except ImportError:
            from commerce.browse_filters import get_session_filters
        filters = get_session_filters(session_id)
        if filters.is_active():
            lines.append(f"Stacked hard filters: {filters.describe()}")
    elif is_context_switch(user_query, prev_browse) and prev_browse:
        fresh = _build_switch_query(
            prev_browse, user_query, infer_category_from_query(prev_browse)
        )
        lines.append(
            f"Context switch — new search: \"{fresh}\" (was: \"{prev_browse}\")"
        )

    if not lines:
        return ""
    return "[CONVERSATION CONTEXT — primary truth for this reply]\n" + "\n".join(
        f"- {ln}" for ln in lines
    ) + "\n- Default to most recent context; clarify in one short line only if impossible."
