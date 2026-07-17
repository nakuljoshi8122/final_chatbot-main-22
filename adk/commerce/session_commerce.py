"""Session product context + cart — deterministic commerce handling."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Optional

try:
    from commerce.product_matcher import find_products_by_mention, get_product_by_id
    from commerce.tile_validator import TILES_REGEX, product_to_tile, find_catalog_product
except ImportError:
    from commerce.product_matcher import find_products_by_mention, get_product_by_id
    from commerce.tile_validator import TILES_REGEX, product_to_tile, find_catalog_product

CHECKOUT_URL = "https://shopassist.local/cart"

session_active_product: dict[str, dict] = {}
session_recent_products: dict[str, list[dict]] = {}
session_cart: dict[str, list[dict]] = {}

ADD_TO_CART_RE = re.compile(
    r"\b("
    r"add(\s+it)?\s+to\s+cart|add\s+that|add\s+that\s+again|"
    r"i'?ll\s+take(\s+the)?|i'?ll\s+take\s+it|get\s+me\s+that|grab\s+that|i\s+want\s+that"
    r")\b",
    re.IGNORECASE,
)
ADD_AGAIN_RE = re.compile(r"\badd\s+(that|it)\s+again\b", re.IGNORECASE)
PURCHASE_RE = re.compile(
    r"\b(buy\s+it|purchase|guide\s+me\s+to\s+payment|take\s+me\s+to\s+(checkout|payment)|"
    r"where\s+(can\s+i\s+)?buy|how\s+do\s+i\s+buy|ready\s+to\s+buy|pay\s+for\s+it)\b",
    re.IGNORECASE,
)
CART_VIEW_RE = re.compile(
    r"\b(what'?s\s+in\s+(my\s+)?cart|my\s+cart|show\s+(my\s+)?cart|cart\s+contents|whats\s+in\s+my\s+cart)\b",
    re.IGNORECASE,
)
CHECKOUT_RE = re.compile(
    r"\b(checkout|proceed|what\s+have\s+i\s+got|ready\s+to\s+checkout|check\s+out)\b",
    re.IGNORECASE,
)
SESSION_END_RE = re.compile(
    r"\b(i'?m\s+done|that'?s\s+it|done\s+browsing|nothing\s+else|"
    r"wrap\s+up|finish\s+up)\b",
    re.IGNORECASE,
)


@dataclass
class CommerceResult:
    handled: bool
    response_text: str = ""
    show_checkout: bool = False
    checkout_url: str = CHECKOUT_URL


def _parse_inr(price: str) -> int:
    digits = re.sub(r"[^\d]", "", str(price))
    return int(digits) if digits else 0


def _format_inr(amount: int) -> str:
    return f"₹{amount:,}"


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
            product = find_catalog_product(str(entry["name"]))
            if product:
                tiles.append(product_to_tile(product))
            elif entry.get("id"):
                tiles.append(entry)
        return tiles
    except json.JSONDecodeError:
        return []


def _dedupe_tiles(tiles: list[dict]) -> list[dict]:
    seen: set[str] = set()
    out: list[dict] = []
    for tile in tiles:
        pid = str(tile.get("id", ""))
        if pid and pid not in seen:
            seen.add(pid)
            out.append(tile)
    return out


def get_last_assistant_tiles(conversation_history: dict, session_id: str) -> list[dict]:
    messages = conversation_history.get(session_id, [])
    for msg in reversed(messages):
        if msg.get("role") != "assistant":
            continue
        tiles = parse_tiles_from_text(msg.get("content", ""))
        if tiles:
            return tiles
    return []


def set_active_product(session_id: str, product_id: str) -> Optional[dict]:
    product = get_product_by_id(product_id)
    if not product:
        product = find_catalog_product(product_id)
    if not product:
        return None
    tile = product_to_tile(product)
    session_active_product[session_id] = tile
    recent = session_recent_products.setdefault(session_id, [])
    recent = [t for t in recent if t.get("id") != tile["id"]]
    recent.insert(0, tile)
    session_recent_products[session_id] = recent[:5]
    try:
        from persistence.session_store import save_active_product_id
    except ImportError:
        from persistence.session_store import save_active_product_id
    save_active_product_id(session_id, str(tile.get("id", "")))
    return tile


def update_session_from_response(session_id: str, response_text: str) -> None:
    try:
        from commerce.conversation_context import record_shown_tiles
    except ImportError:
        from commerce.conversation_context import record_shown_tiles

    record_shown_tiles(session_id, response_text)
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


def _tile_from_card(card: dict) -> dict:
    raw = find_catalog_product(str(card.get("name", "")))
    return product_to_tile(raw) if raw else dict(card)


def _pick_line_variant(cards: list[dict], user_query: str) -> dict:
    """When several variants share a line name, pick by audience or default men's."""
    q = user_query.lower()
    if re.search(r"\b(women|woman|womens|ladies|female|her)\b", q):
        for card in cards:
            if re.search(r"\bW\b|women", card.get("name", ""), re.I):
                return card
    if re.search(r"\b(kids?|children|junior|boys?|girls?)\b", q):
        for card in cards:
            if re.search(r"kid|junior", card.get("name", ""), re.I):
                return card
    for card in cards:
        name = card.get("name", "")
        nl = name.lower()
        if "kid" in nl or "junior" in nl:
            continue
        if re.search(r"\sW\b|women", name, re.I):
            continue
        return card
    return cards[0]


def _in_cart(session_id: str, product_id: str) -> bool:
    return any(str(item.get("id")) == str(product_id) for item in get_cart(session_id))


def resolve_product_for_add(
    user_query: str,
    session_id: str,
    conversation_history: dict,
) -> tuple[Optional[dict], list[dict]]:
    """Resolve product from explicit name in query, then session context."""
    mentioned = find_products_by_mention(user_query, max_results=3)
    if len(mentioned) == 1:
        return _tile_from_card(mentioned[0]), []
    if len(mentioned) > 1:
        if re.search(
            r"\b(ultraboost|supernova|samba|gazelle|terrex|predator|adizero|solarboost)\b",
            user_query,
            re.IGNORECASE,
        ):
            return _tile_from_card(_pick_line_variant(mentioned, user_query)), []
        return None, [_tile_from_card(c) for c in mentioned[:3]]

    try:
        from commerce.conversation_context import resolve_single_product_for_commerce
    except ImportError:
        from commerce.conversation_context import resolve_single_product_for_commerce

    chosen, _ = resolve_single_product_for_commerce(session_id, conversation_history)
    if chosen:
        return chosen, []

    recent = session_recent_products.get(session_id, [])
    if recent:
        return recent[0], []

    return None, []


def get_cart(session_id: str) -> list[dict]:
    return list(session_cart.get(session_id, []))


def add_to_cart(session_id: str, tile: dict) -> bool:
    """Add tile to cart. Returns False if already present."""
    cart = session_cart.setdefault(session_id, [])
    pid = str(tile.get("id", ""))
    if pid and any(str(item.get("id")) == pid for item in cart):
        return False
    cart.append(dict(tile))
    try:
        from persistence.session_store import persist_cart_from_memory
    except ImportError:
        from persistence.session_store import persist_cart_from_memory
    persist_cart_from_memory(session_id)
    return True


def _build_cart_table(cart: list[dict]) -> str:
    rows_html = []
    total = 0
    for item in cart:
        price = item.get("price", "")
        total += _parse_inr(price)
        link = item.get("url", "")
        rows_html.append(
            f"<tr><td>{item.get('name', '')}</td>"
            f"<td>{item.get('color', '')}</td>"
            f"<td>{price}</td>"
            f"<td>{link}</td></tr>"
        )
    rows_html.append(
        f"<tr><td><b>Total</b></td><td></td><td><b>{_format_inr(total)}</b></td><td></td></tr>"
    )
    return (
        "<TABLE>\n<table>\n"
        "<thead><tr><th>Product</th><th>Color</th><th>Price</th><th>Link</th></tr></thead>\n"
        f"<tbody>{''.join(rows_html)}</tbody>\n"
        "</table>\n</TABLE>"
    )


def _tiles_block(tiles: list[dict]) -> str:
    return f"<TILES>{json.dumps(tiles)}</TILES>"


def _ambiguous_response(candidates: list[dict]) -> CommerceResult:
    return CommerceResult(
        handled=True,
        response_text=f"Which of these?\n{_tiles_block(candidates[:3])}",
    )


def handle_commerce_query(
    user_query: str,
    session_id: str,
    conversation_history: dict,
) -> CommerceResult:
    if not session_id:
        return CommerceResult(handled=False)

    q = user_query.strip()
    if not q:
        return CommerceResult(handled=False)

    if CART_VIEW_RE.search(q):
        cart = get_cart(session_id)
        if not cart:
            return CommerceResult(handled=True, response_text="Cart's empty.")
        return CommerceResult(
            handled=True,
            response_text=f"Here's your cart.\n{_build_cart_table(cart)}",
            show_checkout=False,
        )

    if SESSION_END_RE.search(q):
        cart = get_cart(session_id)
        if not cart:
            return CommerceResult(
                handled=True,
                response_text="No worries, come back anytime.",
            )
        return CommerceResult(
            handled=True,
            response_text="All good — your cart is saved. Come back anytime.",
        )

    if CHECKOUT_RE.search(q):
        cart = get_cart(session_id)
        if cart:
            return CommerceResult(
                handled=True,
                response_text=f"Here's what you've got.\n{_build_cart_table(cart)}",
                show_checkout=True,
                checkout_url=CHECKOUT_URL,
            )
        return CommerceResult(handled=True, response_text="Cart's empty.")

    if PURCHASE_RE.search(q):
        product, ambiguous = resolve_product_for_add(q, session_id, conversation_history)
        if ambiguous:
            return _ambiguous_response(ambiguous)
        if product:
            return CommerceResult(
                handled=True,
                response_text=f"Got it, here's where you grab it.\n{_tiles_block([product])}",
            )
        return CommerceResult(handled=True, response_text="Browse something first.")

    if ADD_TO_CART_RE.search(q) or ADD_AGAIN_RE.search(q):
        product, ambiguous = resolve_product_for_add(q, session_id, conversation_history)
        if ambiguous:
            return _ambiguous_response(ambiguous)
        if not product:
            return CommerceResult(handled=True, response_text="Tap a product first.")

        pid = str(product.get("id", ""))
        if pid and _in_cart(session_id, pid):
            return CommerceResult(handled=True, response_text="Already in your cart.")

        added = add_to_cart(session_id, product)
        session_active_product[session_id] = product
        if not added:
            return CommerceResult(handled=True, response_text="Already in your cart.")
        return CommerceResult(handled=True, response_text="Added.")

    return CommerceResult(handled=False)


# Back-compat for older imports
def resolve_product_reference(
    session_id: str,
    conversation_history: dict,
) -> tuple[Optional[dict], list[dict]]:
    product, ambiguous = resolve_product_for_add("", session_id, conversation_history)
    return product, ambiguous
