"""Seller-facing tools: list / add / update inventory via chat."""

from __future__ import annotations

import json
import re
import uuid
from typing import Any, Optional

try:
    from catalog.seller_catalog import (
        get_seller_product,
        list_seller_products,
        seed_product_as_seller_row,
        set_sku_inventory_status,
        upsert_seller_product,
    )
    from stores.store_scope import get_current_store_id
    from stores.store_registry import get_store, normalize_category
except ImportError:
    from catalog.seller_catalog import (
        get_seller_product,
        list_seller_products,
        seed_product_as_seller_row,
        set_sku_inventory_status,
        upsert_seller_product,
    )
    from stores.store_scope import get_current_store_id
    from stores.store_registry import get_store, normalize_category


REQUIRED_LISTING_FIELDS = ("name", "price", "category", "quantity")


def _store_id_or_error(explicit: str = "") -> tuple[Optional[str], Optional[str]]:
    sid = (explicit or get_current_store_id() or "").strip()
    if not sid:
        return None, "Error: store_id is required. Open a store first."
    if not get_store(sid):
        return None, f"Error: store '{sid}' not found."
    return sid, None


def _next_sku(category: str) -> str:
    prefix = {"Skincare": "SK", "Apparel": "AP", "Handicrafts": "HC"}.get(
        normalize_category(category), "HC"
    )
    return f"{prefix}-NEW-{uuid.uuid4().hex[:5].upper()}"


def _format_price(price: Any) -> str:
    p = str(price or "").strip()
    if not p:
        return ""
    return p if p.startswith("$") else f"${p}"


def _row_to_tile(row: dict[str, Any], *, pick: bool = False) -> dict[str, Any]:
    """Shape a seller product into the tile schema the app renders."""
    sku = str(row.get("sku") or "").strip().upper()
    status = str(row.get("status") or "active").strip().lower()
    qty = row.get("quantity")
    images = row.get("images") if isinstance(row.get("images"), list) else []
    images = [str(u) for u in images if str(u or "").strip()]
    img = str(row.get("img") or (images[0] if images else ""))
    tile = {
        "id": sku,
        "sku": sku,
        "name": str(row.get("name") or sku),
        "price": _format_price(row.get("price")),
        "list_price": _format_price(row.get("list_price")) if row.get("list_price") else "",
        "category": str(row.get("category") or ""),
        "description": str(row.get("description") or "")[:220],
        "status": status,
        "quantity": qty if isinstance(qty, int) else 0,
        "tag": "TAP TO PICK" if pick else status.upper(),
        "img": img,
        "images": images or ([img] if img else []),
        "url": str(row.get("url") or img or ""),
    }
    if pick:
        tile["pick"] = True
    return tile


def _tiles_block(rows: list[dict[str, Any]], *, pick: bool = False) -> str:
    tiles = [_row_to_tile(r, pick=pick) for r in rows if r.get("sku")]
    return "<TILES>" + json.dumps(tiles, ensure_ascii=False) + "</TILES>"


_EDIT_STOPWORDS = frozenset(
    """
    a an the and or for to of in on is it my me with can you please change update set make
    price prices dollar dollars usd qty quantity stock restock publish draft trash delete
    remove item items product products this that those these wanna want need show
    """.split()
)


def _query_tokens(text: str) -> list[str]:
    raw = re.findall(r"[a-z0-9]+", str(text or "").lower())
    out: list[str] = []
    for t in raw:
        if t.isdigit() or t in _EDIT_STOPWORDS or len(t) < 2:
            continue
        # Normalize gray→grey so both spellings score the same
        if t == "gray":
            t = "grey"
        out.append(t)
        if t.endswith("s") and len(t) > 3:
            stem = t[:-1]
            out.append("grey" if stem == "gray" else stem)
    # preserve order, unique
    seen: set[str] = set()
    uniq: list[str] = []
    for t in out:
        if t not in seen:
            seen.add(t)
            uniq.append(t)
    return uniq


def _norm_match_text(text: str) -> str:
    """Lowercase + gray/grey alias for substring matching."""
    return str(text or "").lower().replace("gray", "grey")


def _content_tokens(query: str) -> list[str]:
    """Tokens used for 'all must appear in name' checks (drop plural stems)."""
    toks = _query_tokens(query)
    # Prefer surface forms: if both "pants" and "pant" exist, keep longer
    skip = {t for t in toks if len(t) > 2 and f"{t}s" in toks}
    return [t for t in toks if t not in skip]


def _score_inventory_row(query: str, row: dict[str, Any]) -> int:
    """Rank how well a catalog row matches the seller's wording."""
    q = _norm_match_text(query).strip()
    if not q:
        return 0
    name = _norm_match_text(row.get("name") or "")
    sku = str(row.get("sku") or "").lower()
    blob = " ".join(
        [
            name,
            sku,
            _norm_match_text(row.get("description") or ""),
            _norm_match_text(row.get("category") or ""),
            " ".join(_norm_match_text(t) for t in (row.get("tags") or [])),
        ]
    )
    # Prefer phrase match on product words only (ignore edit verbs / prices)
    content = " ".join(_content_tokens(q))
    if content and content in name:
        return 100 + len(content)
    if q and q in name:
        return 100 + len(q)
    if content and content in blob:
        return 40 + len(content)

    tokens = _query_tokens(q)
    if not tokens:
        return 0
    score = 0
    name_hits = 0
    for t in tokens:
        if t in name:
            score += 8
            name_hits += 1
        elif t in sku:
            score += 6
        elif t in blob:
            score += 3
    if name_hits >= 2:
        score += 12
    # Prefer active listings slightly
    if str(row.get("status") or "active").lower() == "active":
        score += 1
    return score


def _rank_inventory_matches(
    query: str,
    rows: list[dict[str, Any]],
    *,
    limit: int = 8,
    min_score: int = 6,
) -> list[dict[str, Any]]:
    scored = [(_score_inventory_row(query, r), r) for r in rows]
    scored = [(s, r) for s, r in scored if s >= min_score]
    scored.sort(key=lambda x: (-x[0], str(x[1].get("name") or "")))
    if not scored:
        return []
    # Keep near-top relevance only (drop weak tails when top is strong)
    top = scored[0][0]
    margin = 8 if top < 80 else 18
    tight = [(s, r) for s, r in scored if s >= max(min_score, top - margin)]

    # When several items score, prefer ones whose NAME contains all content tokens
    # (e.g. "grey pants" → both Gray/grey pants, not "Grey pant … combo").
    content = _content_tokens(query)
    if len(tight) > 1 and content:
        complete = []
        for s, r in tight:
            name = _norm_match_text(r.get("name") or "")
            if all(t in name for t in content):
                complete.append((s, r))
        if complete:
            tight = complete

    return [r for _, r in tight[:limit]]


async def find_items_for_edit(
    item_query: str,
    store_id: str = "",
    status: str = "live",
) -> str:
    """Find inventory items matching the seller's wording before an edit.

    ALWAYS call this before update_inventory_field / remove_inventory_item when the
    seller names a product in natural language (not an exact SKU) AND there is no
    clear RECENT_ITEM from the prior turn.

    For restore / bring-back of something just trashed: use restore_inventory_item
    with RECENT_ITEM sku — do NOT call this tool on active items.

    Args:
        item_query: Words from the seller message describing the product
            (e.g. "grey pants", "vitamin c serum").
        store_id: Store id from SYSTEM NOTE.
        status: live (active+draft, default) | active | draft | trash | all.
            Use trash when restoring an unnamed deleted item and RECENT_ITEM is missing.

    Returns:
        Match summary + optional <TILES> block (pick mode when ambiguous).
    """
    sid, err = _store_id_or_error(store_id)
    if err:
        return err
    q = str(item_query or "").strip()
    if not q:
        return "Error: item_query is required (use words from the seller's message)."

    status_f = str(status or "live").strip().lower() or "live"
    rows = list_seller_products(active_only=False, store_id=sid)
    if status_f == "live":
        rows = [
            r
            for r in rows
            if str(r.get("status") or "active").lower() not in ("trash",)
        ]
    elif status_f != "all":
        rows = [
            r
            for r in rows
            if str(r.get("status") or "active").lower() == status_f
        ]

    matches = _rank_inventory_matches(q, rows)
    if not matches:
        # Fallback: loose substring on name
        ql = q.lower()
        matches = [
            r
            for r in rows
            if ql in str(r.get("name") or "").lower()
            or any(t in str(r.get("name") or "").lower() for t in _query_tokens(q)[:4])
        ][:6]

    if not matches:
        hint = (
            " If restoring, try status=trash or ask which trashed item."
            if status_f != "trash"
            else " Ask the seller which trashed item (name or SKU)."
        )
        return (
            f"No inventory items match “{q}” (filter={status_f}). "
            f"Ask the seller for a clearer name or SKU.{hint} "
            "Do NOT invent an update."
        )

    if len(matches) == 1:
        row = matches[0]
        sku = str(row.get("sku") or "").upper()
        return (
            f"SINGLE_MATCH sku={sku} name={row.get('name')} status={row.get('status')}. "
            f"You may call update_inventory_field / remove / restore with this exact sku now.\n"
            + _tiles_block([row])
        )

    return (
        f"AMBIGUOUS: {len(matches)} items match “{q}” (filter={status_f}). "
        "Do NOT update yet. Ask the seller to tap the correct card, then use that SKU.\n"
        + _tiles_block(matches, pick=True)
    )

async def list_my_inventory(store_id: str = "", status: str = "all", query: str = "") -> str:
    """List products in this seller's store inventory as tappable product tiles.

    Args:
        store_id: Store id from SYSTEM NOTE (optional if already scoped).
        status: Filter: all | active | draft | trash.
        query: Optional search text to match by name, SKU, or category.

    Returns:
        A short summary line followed by a <TILES>...</TILES> block. ALWAYS include
        the <TILES>...</TILES> block verbatim in your reply so the app can show cards.
    """
    sid, err = _store_id_or_error(store_id)
    if err:
        return err
    rows = list_seller_products(active_only=False, store_id=sid)
    if status and status != "all":
        rows = [r for r in rows if str(r.get("status") or "active").lower() == status.lower()]

    q = str(query or "").strip()
    if q:
        ranked = _rank_inventory_matches(q, rows, limit=24, min_score=3)
        if ranked:
            rows = ranked
        else:
            ql = q.lower()

            def _match(r: dict[str, Any]) -> bool:
                return (
                    ql in str(r.get("name") or "").lower()
                    or ql in str(r.get("sku") or "").lower()
                    or ql in str(r.get("category") or "").lower()
                    or ql in str(r.get("description") or "").lower()
                )

            rows = [r for r in rows if _match(r)]

    if not rows:
        if q:
            return f"No items match “{query}”. Try another name, or say ‘show all items’."
        return (
            f"No products in store {sid} yet. Tell me a product name, price and quantity "
            "(or upload a photo) and I'll list it for you."
        )

    shown = rows[:24]
    scope = "" if status in ("", "all") else f" {status}"
    label = f"“{query}”" if q else f"{len(rows)}{scope} item" + ("s" if len(rows) != 1 else "")
    summary = (
        f"REPLY RULE: ONE short sentence only — do NOT list product names/prices/stock in text; "
        f"cards carry the catalog. Say something like: "
        f"Here {'is' if len(shown) == 1 else 'are'} your {label}. Tap a card to view or edit.\n"
        f"Here {'is' if len(shown) == 1 else 'are'} your {label}. Tap a card to view or edit."
    )
    return summary + "\n" + _tiles_block(shown)


async def find_similar_inventory_from_photo(
    store_id: str = "",
    session_id: str = "",
) -> str:
    """Find inventory items that look like a photo the seller uploaded in chat.

    Matches by product TYPE (shirt, jeans, serum…) and visible features — NOT the
    exact guessed product title. Use this when the seller asks "do I have this?",
    "anything like this?", or "similar in my inventory?" with a photo.

    Args:
        store_id: Store id from SYSTEM NOTE.
        session_id: Chat session_id from SYSTEM NOTE (required for pending photo).

    Returns:
        Summary + <TILES> block of similar catalog items, or a clear no-match message.
    """
    sid, err = _store_id_or_error(store_id)
    if err:
        return err
    sess = str(session_id or "").strip()
    if not sess:
        return "Error: session_id is required to read the uploaded photo."

    try:
        try:
            from media.chat_image_stash import (
                load_pending_chat_image_b64,
                load_pending_vision_analysis,
            )
        except ImportError:
            from media.chat_image_stash import (
                load_pending_chat_image_b64,
                load_pending_vision_analysis,
            )
        try:
            from catalog.product_vision_guess import guess_product_from_image
        except ImportError:
            from catalog.product_vision_guess import guess_product_from_image
        try:
            from catalog.inventory_similarity import find_similar_inventory_rows
        except ImportError:
            from catalog.inventory_similarity import find_similar_inventory_rows
        try:
            from stores.store_registry import get_store
        except ImportError:
            from stores.store_registry import get_store
    except ImportError as e:
        return f"Error: similarity search unavailable ({e})."

    vision = load_pending_vision_analysis(sess)
    if not vision or not vision.get("product_type"):
        image_b64 = load_pending_chat_image_b64(sess)
        if not image_b64:
            return (
                "No pending photo found for this chat. Ask the seller to re-send the image."
            )
        shop = get_store(sid) or {}
        hint = str(shop.get("category") or "")
        vision = guess_product_from_image(image_b64, category_hint=hint)
        if not vision.get("ok"):
            return (
                "Could not analyze the photo. Try a clearer image or describe the item."
            )

    product_type = str(vision.get("product_type") or "item").strip()
    rows = [
        r
        for r in list_seller_products(active_only=False, store_id=sid)
        if str(r.get("status") or "active").lower() == "active"
    ]
    matches = find_similar_inventory_rows(rows, vision)

    if not matches:
        type_label = product_type or "that type"
        return (
            f"No similar {type_label} items in your active inventory. "
            "Want to list this as a new product?"
        )

    matched_rows = [r for _, r in matches]
    n = len(matched_rows)
    type_label = product_type or "item"
    traits = vision.get("search_keywords") or []
    trait_hint = f" ({', '.join(traits[:3])})" if traits else ""
    summary = (
        f"REPLY RULE: ONE short sentence only — do NOT rewrite these as a text list.\n"
        f"Found {n} similar {type_label}{'s' if n != 1 else ''} in your catalog{trait_hint}. "
        "Tap a card to compare."
    )
    return summary + "\n" + _tiles_block(matched_rows)


async def get_restock_priorities(store_id: str = "") -> str:
    """Rank which SKUs to restock first (waitlist, sold-out, low stock).

    Use when seller asks what to restock, priorities, or what needs attention first.
    """
    sid, err = _store_id_or_error(store_id)
    if err:
        return err
    try:
        from commerce.seller_ai import compute_restock_priorities
    except ImportError:
        from adk.commerce.seller_ai import compute_restock_priorities  # type: ignore
    items = compute_restock_priorities(sid)
    if not items:
        return "Nothing urgent to restock right now."
    skus = [it["sku"] for it in items[:5] if it.get("sku")]
    rows = [get_seller_product(s) for s in skus]
    rows = [r for r in rows if r]
    top = items[0]
    summary = (
        f"REPLY RULE: ONE short sentence only — do NOT number products in text; cards show them.\n"
        f"Restock {top.get('name')} first — {top.get('reason', 'highest priority')} "
        f"({len(items)} priorit{'y' if len(items) == 1 else 'ies'}). Tap a card to restock."
    )
    if rows:
        return summary + "\n" + _tiles_block(rows)
    return summary


async def suggest_pricing_for_item(store_id: str = "", sku: str = "") -> str:
    """AI pricing suggestion for one SKU based on category average and stock."""
    sid, err = _store_id_or_error(store_id)
    if err:
        return err
    key = str(sku or "").strip().upper()
    if not key:
        return "Error: sku is required."
    try:
        from commerce.seller_ai import suggest_pricing
    except ImportError:
        from adk.commerce.seller_ai import suggest_pricing  # type: ignore
    out = suggest_pricing(sid, key)
    if not out.get("ok"):
        return str(out.get("error") or "Could not suggest price.")
    return (
        f"{out.get('rationale')} "
        f"Current ${out.get('current_price')} → suggest ${out.get('suggested_price')} "
        f"(category avg ${out.get('category_average')})."
    )


async def analyze_buyer_questions(store_id: str = "") -> str:
    """Summarize themes in buyer questions (shipping, sizing, stock, pricing).

    For listing the actual open questions, use list_open_buyer_queries instead.
    """
    sid, err = _store_id_or_error(store_id)
    if err:
        return err
    try:
        from commerce.seller_ai import analyze_buyer_intent
    except ImportError:
        from adk.commerce.seller_ai import analyze_buyer_intent  # type: ignore
    out = analyze_buyer_intent(sid)
    themes = out.get("themes") or []
    open_n = int(out.get("open_count") or 0)
    if open_n > 0:
        hint = (
            f"{open_n} open. NEXT: call list_open_buyer_queries(store_id) to show "
            "the actual questions in chat — do not only report the count."
        )
    else:
        hint = out.get("tip") or "Inbox is clear."
    if not themes:
        return f"No question themes yet. {hint}"
    parts = [f"{t['label']} ({t['count']})" for t in themes[:4]]
    return f"Buyer question themes: {', '.join(parts)}. {hint}"


async def list_open_buyer_queries(store_id: str = "") -> str:
    """List open buyer Inbox questions with the actual text (do this in Assist chat).

    Use when the seller asks what their open queries are, to list/show/open them,
    or says "yes open it" / "list them" after hearing there are open queries.
    Do NOT send them to the Inbox tab — paste the questions here.
    """
    sid, err = _store_id_or_error(store_id)
    if err:
        return err
    try:
        from stores.store_registry import list_store_queries
    except ImportError:
        from stores.store_registry import list_store_queries
    rows = list_store_queries(sid, "open")
    if not rows:
        return "Inbox clear — no open buyer questions."
    lines = [
        f"OPEN_QUERIES ({len(rows)}). Show these in chat. Offer to draft a reply "
        "(draft_buyer_query_reply) or send one (answer_buyer_query). "
        "Do NOT only say the count. Do NOT mention the Inbox tab.",
    ]
    for i, row in enumerate(rows[:12], 1):
        qid = str(row.get("id") or "")
        q = str(row.get("question") or "").strip() or "(no text)"
        notes = str(row.get("notes") or "").strip()
        extra = f" — note: {notes}" if notes else ""
        lines.append(f"{i}. [{qid}] {q}{extra}")
    if len(rows) > 12:
        lines.append(f"…and {len(rows) - 12} more.")
    return "\n".join(lines)


async def draft_buyer_query_reply(store_id: str = "", query_id: str = "") -> str:
    """Draft a short reply for one open buyer question (does not send yet)."""
    sid, err = _store_id_or_error(store_id)
    if err:
        return err
    qid = str(query_id or "").strip()
    if not qid:
        return "Error: query_id required (from list_open_buyer_queries)."
    try:
        from stores.store_registry import list_store_queries
        from commerce.seller_ai import draft_query_reply
    except ImportError:
        from stores.store_registry import list_store_queries
        from commerce.seller_ai import draft_query_reply
    rows = list_store_queries(sid, "open")
    row = next((r for r in rows if str(r.get("id")) == qid), None)
    if not row:
        # Also search all in case id was answered mid-turn
        all_rows = list_store_queries(sid, "all")
        row = next((r for r in all_rows if str(r.get("id")) == qid), None)
    if not row:
        return f"Error: open query {qid} not found. Call list_open_buyer_queries first."
    out = draft_query_reply(
        sid,
        str(row.get("question") or ""),
        notes=str(row.get("notes") or ""),
    )
    draft = str(out.get("draft") or "").strip()
    return (
        f"DRAFT for [{qid}] «{row.get('question')}»:\n"
        f"{draft}\n"
        "Ask the seller if this is good. If they approve, call "
        f"answer_buyer_query(store_id, query_id='{qid}', answer=the draft)."
    )


async def answer_buyer_query(
    store_id: str = "",
    query_id: str = "",
    answer: str = "",
) -> str:
    """Send/save a reply to a buyer question and mark it answered."""
    sid, err = _store_id_or_error(store_id)
    if err:
        return err
    qid = str(query_id or "").strip()
    body = str(answer or "").strip()
    if not qid:
        return "Error: query_id required."
    if not body:
        return "Error: answer text required."
    try:
        from stores.store_registry import answer_store_query
    except ImportError:
        from stores.store_registry import answer_store_query
    updated = answer_store_query(sid, qid, body)
    if not updated:
        return f"Error: could not answer query {qid}."
    left = 0
    try:
        from stores.store_registry import list_store_queries

        left = len(list_store_queries(sid, "open"))
    except Exception:
        pass
    return (
        f"Sent reply for «{updated.get('question')}» and marked it answered. "
        f"{left} open question{'s' if left != 1 else ''} left."
    )


async def ask_store_analytics(store_id: str = "", question: str = "") -> str:
    """Answer COUNT / insight questions only: how many drafts, top sellers, focus today.

    Do NOT use this to browse or status-dump listings — use list_my_inventory /
    list_low_stock_items so the app shows product cards.
    """
    sid, err = _store_id_or_error(store_id)
    if err:
        return err
    q = str(question or "").strip()
    if not q:
        return "Error: ask a question like 'what sold best?' or 'how many drafts?'"
    try:
        from commerce.seller_ai import answer_store_analytics
    except ImportError:
        from adk.commerce.seller_ai import answer_store_analytics  # type: ignore
    out = answer_store_analytics(sid, q)
    if out.get("redirect") == "list_my_inventory":
        status = str(out.get("status") or "active")
        return (
            f"REDIRECT: Call list_my_inventory(store_id, status='{status}') now. "
            "Do NOT list products in text — cards only. "
            f"Hint: {out.get('answer') or ''}"
        )
    if out.get("redirect") == "list_low_stock_items":
        return (
            "REDIRECT: Call list_low_stock_items(store_id) now. "
            "Do NOT list products in text — cards only."
        )
    if out.get("redirect") == "list_open_buyer_queries":
        return (
            "REDIRECT: Call list_open_buyer_queries(store_id) now. "
            "Show the actual buyer questions in chat — do not only report a count."
        )
    return str(out.get("answer") or "No analytics available yet.")


def _qty_of(row: dict[str, Any]) -> int:
    try:
        return int(row.get("quantity") or 0)
    except (TypeError, ValueError):
        return 0


async def list_low_stock_items(store_id: str = "", threshold: int = 3) -> str:
    """Show inventory that needs restocking, as product tiles.

    Priority logic: if any items are OUT OF STOCK (0 units) show only those;
    otherwise show items with fewer than ``threshold`` units; if none qualify,
    report that nothing is low on stock.

    Args:
        store_id: Store id from SYSTEM NOTE (optional if already scoped).
        threshold: Low-stock cutoff in units (default 3 -> shows 1-2 units).

    Returns:
        A short summary line, optionally followed by a <TILES>...</TILES> block.
        ALWAYS include the <TILES>...</TILES> block verbatim so the app shows cards.
    """
    sid, err = _store_id_or_error(store_id)
    if err:
        return err
    try:
        cutoff = int(threshold)
    except (TypeError, ValueError):
        cutoff = 3
    if cutoff < 1:
        cutoff = 3

    # Seller's live inventory (exclude trashed items).
    rows = [
        r
        for r in list_seller_products(active_only=False, store_id=sid)
        if str(r.get("status") or "active").lower() != "trash"
    ]

    out_of_stock = sorted((r for r in rows if _qty_of(r) <= 0), key=_qty_of)
    low_stock = sorted((r for r in rows if 0 < _qty_of(r) < cutoff), key=_qty_of)

    if out_of_stock:
        shown = out_of_stock[:24]
        n = len(out_of_stock)
        summary = (
            f"REPLY RULE: ONE short sentence only — do NOT list names/prices in text.\n"
            f"{n} item{'s' if n != 1 else ''} {'are' if n != 1 else 'is'} out of stock — "
            "tap a card to restock."
        )
        return summary + "\n" + _tiles_block(shown)

    if low_stock:
        shown = low_stock[:24]
        n = len(low_stock)
        summary = (
            f"REPLY RULE: ONE short sentence only — do NOT list names/prices in text.\n"
            f"{n} item{'s' if n != 1 else ''} {'are' if n != 1 else 'is'} running low "
            f"(under {cutoff} units) — tap a card to restock."
        )
        return summary + "\n" + _tiles_block(shown)

    return "Good news — no items are low on stock right now."


async def upsert_inventory_item(
    name: str,
    store_id: str = "",
    sku: str = "",
    price: str = "",
    category: str = "",
    quantity: str = "",
    description: str = "",
    status: str = "active",
    image_base64: str = "",
    use_pending_chat_image: str = "true",
    session_id: str = "",
) -> str:
    """Create or update a product in this store's inventory (persisted to database/catalog).

    Ask follow-up questions if name/price/category/quantity are missing.
    If the seller uploaded a photo in chat, set use_pending_chat_image to "true"
    (default) and pass session_id from the SYSTEM NOTE — do NOT paste base64.

    Args:
        name: Product name (required).
        store_id: Store id from SYSTEM NOTE.
        sku: Existing SKU to update; omit to create new.
        price: Price string e.g. "32" or "$32".
        category: Handicrafts | Apparel | Skincare.
        quantity: Stock count as string/number.
        description: Specs / details.
        status: active | draft | trash.
        image_base64: Optional (prefer pending chat image instead).
        use_pending_chat_image: "true" to attach the photo uploaded in this chat turn.
        session_id: Exact session_id from SYSTEM NOTE (needed for pending image).

    Returns:
        Confirmation or a list of missing required fields.
    """
    sid, err = _store_id_or_error(store_id)
    if err:
        return err

    missing = []
    if not name or not str(name).strip():
        missing.append("name")
    if not str(price).strip():
        missing.append("price")
    if not str(category).strip():
        # default from store category
        shop = get_store(sid)
        category = (shop or {}).get("category") or ""
        if not category:
            missing.append("category (Handicrafts, Apparel, or Skincare)")
    if str(quantity).strip() == "":
        missing.append("quantity")
    if missing:
        return (
            "Missing required fields: "
            + ", ".join(missing)
            + ". Ask the seller for these before saving."
        )

    cat = normalize_category(category)
    qty = 0
    try:
        qty = int(float(re.sub(r"[^\d.]", "", str(quantity)) or "0"))
    except Exception:
        qty = 0

    price_clean = str(price).strip()

    use_sku = str(sku).strip().upper() or _next_sku(cat)
    payload = {
        "sku": use_sku,
        "name": str(name).strip(),
        "price": price_clean,
        "category": cat,
        "quantity": qty,
        "description": str(description or "").strip(),
        "status": str(status or "active").strip().lower() or "active",
        "store_id": sid,
    }

    img = str(image_base64 or "").strip()
    use_pending = str(use_pending_chat_image or "true").strip().lower() in (
        "1",
        "true",
        "yes",
        "y",
    )
    if not img and use_pending:
        try:
            try:
                from media.chat_image_stash import consume_pending_chat_image_b64
                from stores.store_scope import get_current_store_id as _gid
            except ImportError:
                from media.chat_image_stash import consume_pending_chat_image_b64
            sess = str(session_id or "").strip()
            if sess:
                img = consume_pending_chat_image_b64(sess) or ""
        except Exception:
            img = ""
    if img:
        payload["image_base64"] = img

    try:
        row = upsert_seller_product(payload, tag=True, force_retag=bool(img))
    except Exception as e:
        return f"Error saving product: {e}"

    photo_note = " Photo attached." if img else ""
    return (
        f"Saved product '{row.get('name')}' (SKU={row.get('sku')}) in store {sid}. "
        f"price={row.get('price')} qty={row.get('quantity')} status={row.get('status')}."
        f"{photo_note} Changes are live in the catalog.\n"
        + _tiles_block([row])
    )


async def apply_listing_changes(
    store_id: str = "",
    session_id: str = "",
    name: str = "",
    price: str = "",
    quantity: str = "",
    category: str = "",
    description: str = "",
    status: str = "",
    finalize: str = "false",
) -> str:
    """Apply chat edits to the seller's in-progress listing (form or prior chat turns).

    Use when the seller tweaks fields while listing ("make its price 1000", "qty 50",
    "call it Blue Tee") — especially pronouns (it/this/that) referring to the item
    they are currently adding. Merge with LISTING IN PROGRESS from SYSTEM NOTE.

    NEVER set finalize=true — only the seller's "List product" button on the form
    publishes to active. This tool always keeps status=draft in the catalog.

    Do NOT use for editing existing catalog SKUs — use find_items_for_edit +
    update_inventory_field instead.

    Args:
        store_id: Store id from SYSTEM NOTE.
        session_id: Exact session_id from SYSTEM NOTE.
        name, price, quantity, category, description: Fields to merge (omit unchanged).
        status: Ignored (draft-only until form publish).
        finalize: Ignored — do not publish from chat.

    Returns:
        Confirmation, missing-field prompt, and <LISTING_DRAFT> block for the form.
    """
    sid, err = _store_id_or_error(store_id)
    if err:
        return err
    try:
        from commerce.seller_listing_context import (
            get_pending_listing,
            listing_draft_block,
            merge_pending_listing,
            missing_required_fields,
            sync_draft_to_catalog,
        )
        from stores.store_scope import get_current_session_id
    except ImportError:
        from commerce.seller_listing_context import (
            get_pending_listing,
            listing_draft_block,
            merge_pending_listing,
            missing_required_fields,
            sync_draft_to_catalog,
        )
        from stores.store_scope import get_current_session_id

    sess = str(session_id or get_current_session_id() or "").strip()
    patch: dict[str, Any] = {}
    for key, val in (
        ("name", name),
        ("price", price),
        ("quantity", quantity),
        ("category", category),
        ("description", description),
    ):
        if str(val or "").strip():
            patch[key] = str(val).strip()

    draft = merge_pending_listing(sess, patch) if patch else get_pending_listing(sess)
    if not draft:
        return (
            "No listing in progress. Ask what product they want to add, or open the add form."
        )

    shop = get_store(sid) or {}
    store_cat = str(shop.get("category") or "")
    missing = missing_required_fields(draft, store_cat)

    # Sync every alteration to catalog as draft (stable SKU once assigned).
    if str(draft.get("name") or "").strip():
        draft = sync_draft_to_catalog(draft, sid, sess)

    have = ", ".join(
        f"{k}={draft[k]}"
        for k in sorted(draft)
        if k not in ("in_progress", "has_photo", "source") and draft.get(k)
    )
    sku_note = f" (draft SKU {draft['sku']})" if draft.get("sku") else ""

    if missing:
        return (
            f"Updated your listing draft{sku_note}: {have or 'started'}. "
            f"Still need: {', '.join(missing)}. "
            "The form below is updated — tap List product when ready to go live.\n"
            + listing_draft_block(draft)
        )
    return (
        f"Draft saved{sku_note}: {have}. "
        "Form updated — tap List product when you want it live. "
        "They can keep chatting or ask other shop questions in between.\n"
        + listing_draft_block(draft)
    )


async def update_inventory_field(
    sku: str,
    field: str,
    value: str,
    store_id: str = "",
) -> str:
    """Update one field on an existing inventory item (price, quantity, status, name, description).

    Args:
        sku: Product SKU.
        field: One of price, quantity, status, name, description, category.
        value: New value.
        store_id: Store id from SYSTEM NOTE.

    Returns:
        Confirmation or error.
    """
    sid, err = _store_id_or_error(store_id)
    if err:
        return err
    sku = str(sku or "").strip().upper()
    if not sku:
        return "Error: sku is required."
    row = get_seller_product(sku)
    if not row:
        # Seed/Pinterest items live in KB until first edit — hydrate so status
        # changes keep the photo instead of creating a blank seller override.
        try:
            from catalog.seller_catalog import resolve_store_product
        except ImportError:
            from catalog.seller_catalog import resolve_store_product
        row = resolve_store_product(sku, sid) or seed_product_as_seller_row(sku, sid)
    if not row:
        return f"Error: product {sku} not found."
    # Prefer the store-owned SKU (cloned catalog) when the shared seed was referenced
    sku = str(row.get("sku") or sku).strip().upper()
    if str(row.get("store_id") or "") not in ("", sid) and str(row.get("store_id")) != sid:
        try:
            from catalog.seller_catalog import resolve_store_product
        except ImportError:
            from catalog.seller_catalog import resolve_store_product
        owned = resolve_store_product(sku, sid)
        if not owned:
            return f"Error: product {sku} does not belong to store {sid}."
        row = owned
        sku = str(row.get("sku") or sku).strip().upper()

    field = str(field or "").strip().lower()
    allowed = {"price", "quantity", "status", "name", "description", "category"}
    if field not in allowed:
        return f"Error: field must be one of {sorted(allowed)}."

    payload = dict(row)
    payload["store_id"] = sid
    if field == "quantity":
        try:
            payload["quantity"] = int(float(re.sub(r"[^\d.]", "", str(value)) or "0"))
        except Exception:
            return "Error: quantity must be a number."
    elif field == "category":
        payload["category"] = normalize_category(value)
    elif field == "status":
        payload["status"] = str(value).strip().lower()
    elif field == "price":
        payload["price"] = str(value).strip()
        payload.pop("list_price", None)
    else:
        payload[field] = str(value).strip()

    try:
        updated = upsert_seller_product(payload, tag=False)
    except Exception as e:
        return f"Error updating product: {e}"

    if field == "status":
        try:
            set_sku_inventory_status(
                sku,
                str(updated.get("status") or value),
                name=str(updated.get("name") or ""),
            )
        except Exception:
            pass

    # Return ONLY this product's card — never a related search dump.
    try:
        from commerce.seller_recent_item import set_recent_item
        from stores.store_scope import get_current_session_id
    except ImportError:
        from commerce.seller_recent_item import set_recent_item
        from stores.store_scope import get_current_session_id
    action = "update"
    status_now = str(updated.get("status") or "")
    if field == "status":
        status_now = str(updated.get("status") or value or "").lower()
        if status_now == "trash":
            action = "trash"
        elif status_now == "active":
            action = "restore"
    set_recent_item(
        get_current_session_id() or "",
        sku=sku,
        name=str(updated.get("name") or ""),
        status=status_now,
        action=action,
        store_id=sid,
    )
    return (
        f"Updated {updated.get('name')} ({sku}): {field}={updated.get(field, value)}. "
        "Show ONLY this tile — do not list other products.\n"
        + _tiles_block([updated])
    )


async def restore_inventory_item(
    sku: str = "",
    item_query: str = "",
    store_id: str = "",
    session_id: str = "",
) -> str:
    """Restore a trashed item back to Active.

    Prefer this for "bring it back", "undo delete", "keep it active", "restore".

    Priority:
    1) Exact sku if provided
    2) item_query (product words from the seller message, e.g. "grey pants") —
       search Trash only; NEVER fall back to RECENT_ITEM when item_query is set
    3) RECENT_ITEM only when the message is vague (no product name)
    4) Otherwise show Trash pick cards

    Args:
        sku: Exact SKU to restore.
        item_query: Product wording from the current message (overrides RECENT_ITEM).
        store_id: Store id from SYSTEM NOTE.
        session_id: Exact session_id from SYSTEM NOTE.

    Returns:
        Confirmation + ONE restored tile, or trash pick tiles if unclear.
    """
    sid, err = _store_id_or_error(store_id)
    if err:
        return err
    try:
        from commerce.seller_recent_item import get_recent_item, set_recent_item
        from stores.store_scope import get_current_session_id
    except ImportError:
        from commerce.seller_recent_item import get_recent_item, set_recent_item
        from stores.store_scope import get_current_session_id

    sess = str(session_id or get_current_session_id() or "").strip()
    sku = str(sku or "").strip().upper()
    q = str(item_query or "").strip()

    trash_rows = [
        r
        for r in list_seller_products(active_only=False, store_id=sid)
        if str(r.get("status") or "").lower() == "trash"
    ]

    if not sku and q:
        matches = _rank_inventory_matches(q, trash_rows, limit=8, min_score=6)
        if not matches:
            ql = q.lower()
            matches = [
                r
                for r in trash_rows
                if ql in str(r.get("name") or "").lower()
                or any(t in str(r.get("name") or "").lower() for t in _query_tokens(q)[:4])
            ][:6]
        if not matches:
            if not trash_rows:
                return f"Trash is empty — nothing matching “{q}” to restore."
            return (
                f"No trashed item matches “{q}”. Which one? Tap a Trash card "
                "(not Active).\n"
                + _tiles_block(trash_rows[:12], pick=True)
            )
        if len(matches) > 1:
            return (
                f"AMBIGUOUS: {len(matches)} trashed items match “{q}”. "
                "Tap the correct card, then I'll restore that SKU only.\n"
                + _tiles_block(matches, pick=True)
            )
        sku = str(matches[0].get("sku") or "").upper()

    if not sku:
        recent = get_recent_item(sess)
        if not recent.get("sku"):
            try:
                from commerce.seller_recent_item import _infer_recent_from_history
            except ImportError:
                from commerce.seller_recent_item import _infer_recent_from_history
            recent = _infer_recent_from_history(sess)
        if recent.get("sku") and (
            recent.get("action") == "trash" or recent.get("status") == "trash"
        ):
            sku = str(recent["sku"]).upper()

    if not sku:
        if not trash_rows:
            return "Trash is empty — nothing to bring back. Ask which item they meant."
        if len(trash_rows) == 1:
            sku = str(trash_rows[0].get("sku") or "").upper()
        else:
            return (
                "Which trashed item should I restore? Tap a card (Trash only — not Active).\n"
                + _tiles_block(trash_rows[:12], pick=True)
            )

    row = get_seller_product(sku)
    if not row:
        try:
            from catalog.seller_catalog import resolve_store_product, seed_product_as_seller_row
        except ImportError:
            from catalog.seller_catalog import resolve_store_product, seed_product_as_seller_row
        row = resolve_store_product(sku, sid) or seed_product_as_seller_row(sku, sid)
    if not row:
        return f"Error: product {sku} not found."
    if str(row.get("store_id") or "") not in ("", sid) and str(row.get("store_id")) != sid:
        try:
            from catalog.seller_catalog import resolve_store_product
        except ImportError:
            from catalog.seller_catalog import resolve_store_product
        owned = resolve_store_product(sku, sid)
        if not owned:
            return (
                f"Error: product {sku} does not belong to store {sid}. "
                "Try restoring by name from Trash."
            )
        row = owned
        sku = str(row.get("sku") or sku).strip().upper()
    else:
        sku = str(row.get("sku") or sku).strip().upper()

    cur = str(row.get("status") or "active").lower()
    if cur != "trash":
        set_recent_item(
            sess,
            sku=sku,
            name=str(row.get("name") or ""),
            status=cur,
            action="restore",
            store_id=sid,
        )
        return (
            f"{row.get('name')} ({sku}) is already {cur}. Show ONLY this tile.\n"
            + _tiles_block([row])
        )

    payload = dict(row)
    payload["store_id"] = sid
    payload["status"] = "active"
    try:
        updated = upsert_seller_product(payload, tag=False)
    except Exception as e:
        return f"Error restoring product: {e}"
    try:
        set_sku_inventory_status(sku, "active", name=str(updated.get("name") or ""))
    except Exception:
        pass

    set_recent_item(
        sess,
        sku=sku,
        name=str(updated.get("name") or ""),
        status="active",
        action="restore",
        store_id=sid,
    )
    return (
        f"Restored {updated.get('name')} ({sku}) to Active. Show ONLY this tile.\n"
        + _tiles_block([updated])
    )


async def remove_inventory_item(sku: str, store_id: str = "") -> str:
    """Move a product to Trash (soft delete). Use permanently_delete_inventory_item to erase it.

    Args:
        sku: Product SKU to delete.
        store_id: Store id from SYSTEM NOTE.

    Returns:
        Confirmation or error.
    """
    sid, err = _store_id_or_error(store_id)
    if err:
        return err
    sku = str(sku or "").strip().upper()
    if not sku:
        return "Error: sku is required."
    try:
        from catalog.seller_catalog import soft_delete_seller_product
    except ImportError:
        from catalog.seller_catalog import soft_delete_seller_product
    row = soft_delete_seller_product(sku, sid)
    if not row:
        return f"Error: product {sku} not found."
    try:
        from commerce.seller_recent_item import set_recent_item
        from stores.store_scope import get_current_session_id
    except ImportError:
        from commerce.seller_recent_item import set_recent_item
        from stores.store_scope import get_current_session_id
    set_recent_item(
        get_current_session_id() or "",
        sku=sku,
        name=str(row.get("name") or ""),
        status="trash",
        action="trash",
        store_id=sid,
    )
    return (
        f"Moved {sku} ({row.get('name')}) to Trash. "
        "If they ask to bring it back / keep it active, call restore_inventory_item "
        f"with sku={sku}. Show ONLY this tile.\n"
        + _tiles_block([row])
    )

async def permanently_delete_inventory_item(sku: str, store_id: str = "") -> str:
    """Permanently erase a product (seller row, image, and seed visibility). Cannot be undone.

    Args:
        sku: Product SKU to permanently delete.
        store_id: Store id from SYSTEM NOTE.

    Returns:
        Confirmation or error.
    """
    sid, err = _store_id_or_error(store_id)
    if err:
        return err
    sku = str(sku or "").strip().upper()
    if not sku:
        return "Error: sku is required."
    try:
        from catalog.seller_catalog import get_seller_product, purge_seller_product, seed_product_as_seller_row
    except ImportError:
        from catalog.seller_catalog import get_seller_product, purge_seller_product, seed_product_as_seller_row
    row = get_seller_product(sku) or seed_product_as_seller_row(sku, sid)
    if row and str(row.get("store_id") or "") not in ("", sid) and str(row.get("store_id")) != sid:
        return f"Error: product {sku} does not belong to this store."
    result = purge_seller_product(sku)
    if not result.get("ok"):
        return f"Could not permanently delete {sku}."
    return f"Permanently deleted {sku}."
