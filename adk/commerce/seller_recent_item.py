"""Track the seller's most recently touched inventory item in this chat session.

Used so follow-ups like "bring it back" / "make it active" resolve to the item
just trashed or updated — not a random active catalog search.
"""

from __future__ import annotations

import re
from typing import Any, Optional

try:
    from stores.store_scope import get_current_session_id
except ImportError:
    from stores.store_scope import get_current_session_id

# session_id -> {sku, name, status, action, store_id}
session_recent_item: dict[str, dict[str, Any]] = {}


def _sid(session_id: str = "") -> str:
    return str(session_id or get_current_session_id() or "").strip()


def set_recent_item(
    session_id: str,
    *,
    sku: str,
    name: str = "",
    status: str = "",
    action: str = "",
    store_id: str = "",
) -> dict[str, Any]:
    sid = _sid(session_id)
    if not sid or not sku:
        return {}
    row = {
        "sku": str(sku).strip().upper(),
        "name": str(name or "").strip(),
        "status": str(status or "").strip().lower(),
        "action": str(action or "").strip().lower(),
        "store_id": str(store_id or "").strip(),
    }
    session_recent_item[sid] = row
    return dict(row)


def get_recent_item(session_id: str = "") -> dict[str, Any]:
    sid = _sid(session_id)
    if not sid:
        return {}
    return dict(session_recent_item.get(sid) or {})


def clear_recent_item(session_id: str = "") -> None:
    sid = _sid(session_id)
    if sid:
        session_recent_item.pop(sid, None)


def recent_item_context_line(session_id: str = "", current_query: str = "") -> str:
    item = get_recent_item(session_id)
    if not item.get("sku"):
        item = _infer_recent_from_history(session_id)
    if not item.get("sku"):
        return ""

    # If the seller clearly named a different product, do NOT push RECENT_ITEM as the target.
    if current_query and _query_names_different_product(current_query, item):
        return (
            " RECENT_ITEM exists but CURRENT MESSAGE names a DIFFERENT product — "
            "IGNORE RECENT_ITEM for this turn. Match the named product (e.g. trash "
            "search via restore_inventory_item item_query=… or find_items_for_edit)."
        )

    bits = [f"sku={item['sku']}"]
    if item.get("name"):
        bits.append(f"name={item['name']}")
    if item.get("status"):
        bits.append(f"status={item['status']}")
    if item.get("action"):
        bits.append(f"last_action={item['action']}")
    line = (
        " RECENT_ITEM (only for vague pronouns it/this/that/the item/bring it back — "
        "NOT when they name a different product): "
        + ", ".join(bits)
        + "."
    )
    if item.get("action") == "trash" or item.get("status") == "trash":
        line += (
            " Vague bring-back with no product name → restore_inventory_item "
            "with this sku. If they name another item (e.g. grey pants), use "
            "item_query instead — never restore the wrong SKU."
        )
    return line


_PRONOUN_ONLY_RE = re.compile(
    r"\b(it|its|this|that|them|the\s+item|the\s+product|the\s+one)\b",
    re.I,
)
_ACTION_STOP = frozenset(
    """
    a an the and or for to of in on is it my me with can you please change update set make
    bring back restore keep put move from trash to active again undo delete deleted
    price prices dollar dollars usd qty quantity stock restock publish draft
    item items product products wanna want need show cool yeah ok okay
    """.split()
)


def _content_words(text: str) -> set[str]:
    raw = re.findall(r"[a-z0-9]+", str(text or "").lower())
    out: set[str] = set()
    for t in raw:
        if t.isdigit() or t in _ACTION_STOP or len(t) < 2:
            continue
        if t == "gray":
            t = "grey"
        out.add(t)
        if t.endswith("s") and len(t) > 3:
            out.add(t[:-1])
    return out


def _query_names_different_product(query: str, recent: dict[str, Any]) -> bool:
    """True when the user message likely refers to a product other than RECENT_ITEM."""
    q = str(query or "").strip()
    if not q:
        return False
    # Pure pronoun / undo with no product words → keep recent
    words = _content_words(q)
    if not words:
        return False
    recent_name = str(recent.get("name") or "").lower().replace("gray", "grey")
    recent_sku = str(recent.get("sku") or "").lower()
    if recent_sku and recent_sku in q.lower():
        return False
    # Overlap between query content words and recent product name
    name_tokens = _content_words(recent_name)
    if not name_tokens:
        return True
    overlap = words & name_tokens
    # e.g. "gray pants" vs "Plaid Button-Up Shirt" → no overlap → different
    if not overlap:
        return True
    # Weak overlap (1 short color word only) still treat as different if query
    # has extra product-type words not in recent name
    extra = words - name_tokens
    productish = {"pants", "pant", "shirt", "tee", "bag", "tote", "skirt", "hoodie", "sweater", "scarf", "bra", "shorts"}
    if extra & productish and len(overlap) <= 1:
        return True
    return False


_MOVED_TRASH_RE = re.compile(
    r"Moved\s+([A-Z0-9\-]+)\s+\(([^)]+)\)\s+to\s+Trash",
    re.I,
)
_UPDATED_RE = re.compile(
    r"Updated\s+(.+?)\s+\(([A-Z0-9\-]+)\):",
    re.I,
)
_RESTORED_RE = re.compile(
    r"Restored\s+(.+?)\s+\(([A-Z0-9\-]+)\)\s+to\s+Active",
    re.I,
)


def _infer_recent_from_history(session_id: str) -> dict[str, Any]:
    """Fallback when in-memory recent item was lost (server reload)."""
    sid = _sid(session_id)
    if not sid:
        return {}
    try:
        from persistence.session_store import load_messages
    except ImportError:
        from persistence.session_store import load_messages
    msgs = load_messages(sid) or []
    for msg in reversed(msgs[-12:]):
        if msg.get("role") != "assistant":
            continue
        content = str(msg.get("content") or "")
        m = _MOVED_TRASH_RE.search(content)
        if m:
            row = set_recent_item(
                sid,
                sku=m.group(1),
                name=m.group(2).strip(),
                status="trash",
                action="trash",
            )
            return row
        m = _RESTORED_RE.search(content)
        if m:
            row = set_recent_item(
                sid,
                sku=m.group(2),
                name=m.group(1).strip(),
                status="active",
                action="restore",
            )
            return row
        m = _UPDATED_RE.search(content)
        if m:
            row = set_recent_item(
                sid,
                sku=m.group(2),
                name=m.group(1).strip(),
                status="",
                action="update",
            )
            return row
    return {}
