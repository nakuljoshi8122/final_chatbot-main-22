"""Strict upsell policy — only four allowed moments, never twice, respect ignores."""

from __future__ import annotations

import random
import re
from typing import Optional

try:
    from commerce.product_matcher import (
        find_products_by_mention,
        is_informational_query,
        is_comparison_query,
        match_products,
        _raw_product_by_id,
    )
    from commerce.session_commerce import (
        ADD_TO_CART_RE,
        CHECKOUT_RE,
        PURCHASE_RE,
        get_cart,
        get_last_assistant_tiles,
        parse_tiles_from_text,
    )
    from commerce.tile_validator import strip_agent_markup
except ImportError:
    from commerce.product_matcher import (
        find_products_by_mention,
        is_informational_query,
        is_comparison_query,
        match_products,
        _raw_product_by_id,
    )
    from commerce.session_commerce import (
        ADD_TO_CART_RE,
        CHECKOUT_RE,
        PURCHASE_RE,
        get_cart,
        get_last_assistant_tiles,
        parse_tiles_from_text,
    )
    from commerce.tile_validator import strip_agent_markup

UPSELL_LINE_POOL = (
    "These go well with it.",
    "Lot of people grab this with that.",
    "Worth adding with that.",
)

OPEN_SIGNAL_RE = re.compile(
    r"\b("
    r"hmm+|hm\b|not sure|unsure|anything better|what else|what else you got|"
    r"any other|other options?|alternatives?|can'?t decide|help me choose|"
    r"stuck between|still thinking|on the fence|either one|both seem"
    r")\b",
    re.IGNORECASE,
)

UPSELL_PHRASE_RE = re.compile(
    r"\b(go(es)? well|lot of people|grab (this|these) with|pairs with|worth adding|"
    r"throw in|add (these|this) too)\b",
    re.IGNORECASE,
)

CLINGY_CLOSER_RE = re.compile(
    r"\b(want to see more|can i help you find|anything else i can|need anything else|"
    r"help you find anything|want to grab one|ready to buy)\b",
    re.IGNORECASE,
)

session_upsell_blocked: dict[str, bool] = {}
session_last_was_upsell: dict[str, bool] = {}


def is_open_signal(query: str) -> bool:
    return bool(OPEN_SIGNAL_RE.search(query.strip()))


def is_final_checkout(query: str) -> bool:
    return bool(CHECKOUT_RE.search(query.strip()))


def is_pre_checkout_purchase(query: str) -> bool:
    q = query.strip()
    return bool(PURCHASE_RE.search(q)) and not is_final_checkout(q)


def is_upsell_response(response_text: str, tile_count: int) -> bool:
    visible = strip_agent_markup(response_text)
    if 2 <= tile_count <= 3 and UPSELL_PHRASE_RE.search(visible):
        return True
    if 2 <= tile_count <= 3 and len(visible.split(".")) <= 2 and len(visible) < 80:
        return True
    return False


def _last_assistant_message(conversation_history: dict, session_id: str) -> str:
    for msg in reversed(conversation_history.get(session_id, [])):
        if msg.get("role") == "assistant":
            return msg.get("content", "")
    return ""


def _last_user_message(conversation_history: dict, session_id: str) -> str:
    for msg in reversed(conversation_history.get(session_id, [])):
        if msg.get("role") == "user":
            return msg.get("content", "")
    return ""


def _user_engaged_with_products(query: str) -> bool:
    q = query.strip().lower()
    if ADD_TO_CART_RE.search(q) or PURCHASE_RE.search(q) or is_final_checkout(q):
        return True
    if re.search(r"\b(show me|i want|i need|buy|add|grab|get me)\b", q):
        return True
    if find_products_by_mention(q, max_results=1):
        return True
    return False


def on_user_turn(session_id: str, user_query: str, conversation_history: dict) -> None:
    """If user ignored the last upsell, block further upsells this session."""
    if not session_id:
        return
    last = _last_assistant_message(conversation_history, session_id)
    last_tiles = parse_tiles_from_text(last)
    was_upsell = session_last_was_upsell.get(session_id) or is_upsell_response(
        last, len(last_tiles)
    )
    if was_upsell and not _user_engaged_with_products(user_query):
        session_upsell_blocked[session_id] = True
    session_last_was_upsell[session_id] = False


def mark_upsell_sent(session_id: str) -> None:
    if session_id:
        session_last_was_upsell[session_id] = True


def _comparison_context(history: dict, session_id: str) -> list[dict]:
    compared: list[dict] = []
    seen: set[str] = set()
    for msg in reversed(history.get(session_id, [])):
        role = msg.get("role")
        content = msg.get("content", "")
        if role == "user" and is_comparison_query(content):
            for card in find_products_by_mention(content, max_results=4):
                pid = card.get("id", "")
                if pid and pid not in seen:
                    seen.add(pid)
                    compared.append(card)
        if role == "assistant" and "<TABLE>" in content.upper():
            for card in find_products_by_mention(content, max_results=4):
                pid = card.get("id", "")
                if pid and pid not in seen:
                    seen.add(pid)
                    compared.append(card)
        if len(compared) >= 2:
            break
    return compared[:3]


def _just_showed_browse_tiles(history: dict, session_id: str) -> bool:
    last = _last_assistant_message(history, session_id)
    if not last:
        return False
    tiles = parse_tiles_from_text(last)
    return len(tiles) >= 4


def detect_upsell_moment(
    user_query: str,
    session_id: str,
    conversation_history: dict,
) -> Optional[str]:
    """
    Return moment id if upsell is allowed, else None.

    Moments:
      cart_complement — just added to cart
      undecided_compare — comparing 2 products, user undecided
      open_explore — hmm / not sure / what else (not pure info)
      pre_checkout — picked product, buying but not final checkout
    """
    if not session_id or session_upsell_blocked.get(session_id):
        return None
    if session_last_was_upsell.get(session_id):
        return None
    if is_informational_query(user_query):
        return None
    if is_final_checkout(user_query):
        return None

    if is_pre_checkout_purchase(user_query):
        return "pre_checkout"

    compared = _comparison_context(conversation_history, session_id)
    if len(compared) >= 2 and (is_open_signal(user_query) or is_comparison_query(user_query)):
        return "undecided_compare"

    if is_open_signal(user_query) and not is_informational_query(user_query):
        if _just_showed_browse_tiles(conversation_history, session_id):
            return "open_explore"
        return "open_explore"

    return None


def allows_upsell(
    user_query: str,
    session_id: str,
    conversation_history: dict,
) -> tuple[bool, Optional[str]]:
    if ADD_TO_CART_RE.search(user_query.strip()):
        return False, None
    moment = detect_upsell_moment(user_query, session_id, conversation_history)
    if not moment:
        return False, None
    return True, moment


def build_complement_tiles(anchor: dict, session_id: str, max_results: int = 3) -> list[dict]:
    """Natural complements for something just bought or about to buy."""
    anchor_id = str(anchor.get("id", ""))
    cart_ids = {str(item.get("id", "")) for item in get_cart(session_id)}
    cart_ids.add(anchor_id)

    raw = _raw_product_by_id(anchor_id) if anchor_id else None
    cat = raw.get("category") if raw else ""
    sport = str(raw.get("sport", raw.get("type", "")) if raw else "").lower()
    haystack = (anchor.get("name", "") + " " + anchor.get("category", "")).lower()

    if cat == "footwear" or "footwear" in haystack or "shoe" in haystack:
        queries = ["running socks", "crew socks athletic", "sports socks"]
        if "jacket" not in haystack:
            queries.append("running jacket lightweight")
    elif cat == "clothing" or "apparel" in haystack:
        queries = ["training socks", "sports bra", "gym bag"]
    else:
        queries = ["socks", "cap", "gym bag"]

    tiles: list[dict] = []
    seen = set(cart_ids)
    for q in queries:
        for card in match_products(q, max_results=4):
            pid = str(card.get("id", ""))
            if pid and pid not in seen:
                seen.add(pid)
                tiles.append(card)
            if len(tiles) >= max_results:
                return tiles[:max_results]
    return tiles[:max_results]


def build_tiebreaker_tiles(
    compared: list[dict],
    exclude_ids: set[str],
    max_results: int = 3,
) -> list[dict]:
    if len(compared) < 2:
        return []
    raw0 = _raw_product_by_id(str(compared[0].get("id", "")))
    lock = raw0.get("category") if raw0 else None
    audience = raw0.get("audience") if raw0 else ""
    sport = raw0.get("sport", "") if raw0 else ""
    query = f"{audience} {sport} {lock or 'footwear'}".strip()
    tiles: list[dict] = []
    seen = set(exclude_ids)
    for card in match_products(query, max_results=8, category_lock=lock):
        pid = str(card.get("id", ""))
        if pid and pid not in seen:
            seen.add(pid)
            tiles.append(card)
        if len(tiles) >= max_results:
            break
    return tiles[:max_results]


def upsell_intro_line(moment: Optional[str] = None) -> str:
    return random.choice(UPSELL_LINE_POOL)


def build_upsell_tiles(
    moment: str,
    user_query: str,
    session_id: str,
    conversation_history: dict,
    agent_tiles: list[dict],
) -> list[dict]:
    cart = get_cart(session_id)
    cart_ids = {str(item.get("id", "")) for item in cart}

    if moment == "pre_checkout":
        try:
            from commerce.session_commerce import session_active_product
        except ImportError:
            from commerce.session_commerce import session_active_product
        active = session_active_product.get(session_id)
        if active:
            built = build_complement_tiles(active, session_id, max_results=3)
            return [t for t in built if str(t.get("id")) not in cart_ids][:3]

    if moment == "undecided_compare":
        compared = _comparison_context(conversation_history, session_id)
        exclude = cart_ids | {str(c.get("id", "")) for c in compared}
        built = build_tiebreaker_tiles(compared, exclude, max_results=3)
        if built:
            return built
        if 2 <= len(agent_tiles) <= 3:
            return agent_tiles[:3]

    if moment == "open_explore":
        last_tiles = get_last_assistant_tiles(conversation_history, session_id)
        if last_tiles:
            raw = _raw_product_by_id(str(last_tiles[0].get("id", "")))
            lock = raw.get("category") if raw else None
            sport = raw.get("sport", "") if raw else ""
            q = f"{sport} {lock or ''}".strip() or user_query
            exclude = cart_ids | {str(t.get("id", "")) for t in last_tiles}
            built = match_products(q, max_results=6, category_lock=lock)
            out = [t for t in built if str(t.get("id", "")) not in exclude]
            return out[:3]

    if 2 <= len(agent_tiles) <= 3:
        return agent_tiles[:3]
    return []


def strip_clingy_closers(text: str) -> str:
    return CLINGY_CLOSER_RE.sub("", text).strip()


def enforce_upsell_response(
    response_text: str,
    user_query: str,
    session_id: str,
    conversation_history: dict,
    agent_tiles: list[dict],
) -> str:
    """Strip bad upsells / clingy closers; inject allowed upsell tiles."""
    try:
        from commerce.tile_validator import rebuild_response_with_tiles
    except ImportError:
        from commerce.tile_validator import rebuild_response_with_tiles

    visible = strip_clingy_closers(strip_agent_markup(response_text))
    allowed, moment = allows_upsell(user_query, session_id, conversation_history)
    count = len(agent_tiles)

    if count >= 4:
        return rebuild_response_with_tiles(
            visible or strip_agent_markup(response_text),
            agent_tiles,
            user_query=user_query,
        )

    if count <= 3 and count > 0 and not allowed:
        if count == 1 and should_keep_small_tiles(user_query, agent_tiles):
            return rebuild_response_with_tiles(visible, agent_tiles, user_query=user_query)
        if UPSELL_PHRASE_RE.search(visible) or count >= 2:
            visible = UPSELL_PHRASE_RE.sub("", visible).strip()
            visible = strip_clingy_closers(visible)
            return rebuild_response_with_tiles(visible, [], user_query=user_query)

    if allowed and moment:
        tiles = build_upsell_tiles(
            moment, user_query, session_id, conversation_history, agent_tiles
        )
        if tiles:
            if not UPSELL_PHRASE_RE.search(visible):
                visible = f"{upsell_intro_line(moment)}\n{visible}".strip() if visible else upsell_intro_line(moment)
            else:
                visible = strip_clingy_closers(visible)
            mark_upsell_sent(session_id)
            return rebuild_response_with_tiles(visible, tiles[:3], user_query=user_query)

    if visible != strip_agent_markup(response_text).strip():
        return rebuild_response_with_tiles(visible, agent_tiles, user_query=user_query)
    return response_text


def apply_upsell_policy(
    response_text: str,
    user_query: str,
    session_id: str,
    conversation_history: dict,
) -> str:
    try:
        from commerce.tile_validator import _extract_all_tiles
    except ImportError:
        from commerce.tile_validator import _extract_all_tiles

    agent_tiles = _extract_all_tiles(response_text)
    return enforce_upsell_response(
        response_text, user_query, session_id, conversation_history, agent_tiles
    )


def should_keep_small_tiles(user_query: str, agent_tiles: list[dict]) -> bool:
    """Single-tile purchase/checkout references are not upsells."""
    return len(agent_tiles) == 1 and (
        is_pre_checkout_purchase(user_query) or is_final_checkout(user_query)
    )


def maybe_cart_add_upsell(session_id: str, product: dict) -> Optional[tuple[str, list[dict]]]:
    """After add-to-cart: optional one-line + 2–3 complement tiles."""
    if not session_id or session_upsell_blocked.get(session_id):
        return None
    if session_last_was_upsell.get(session_id):
        return None

    tiles = build_complement_tiles(product, session_id, max_results=3)
    cart_ids = {str(item.get("id", "")) for item in get_cart(session_id)}
    tiles = [t for t in tiles if str(t.get("id", "")) not in cart_ids][:3]
    if not tiles:
        return None

    mark_upsell_sent(session_id)
    return upsell_intro_line("cart_complement"), tiles
