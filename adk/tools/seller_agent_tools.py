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


def _row_to_tile(row: dict[str, Any]) -> dict[str, Any]:
    """Shape a seller product into the tile schema the app renders."""
    sku = str(row.get("sku") or "").strip().upper()
    status = str(row.get("status") or "active").strip().lower()
    qty = row.get("quantity")
    images = row.get("images") if isinstance(row.get("images"), list) else []
    images = [str(u) for u in images if str(u or "").strip()]
    img = str(row.get("img") or (images[0] if images else ""))
    return {
        "id": sku,
        "sku": sku,
        "name": str(row.get("name") or sku),
        "price": _format_price(row.get("price")),
        "list_price": _format_price(row.get("list_price")) if row.get("list_price") else "",
        "category": str(row.get("category") or ""),
        "description": str(row.get("description") or "")[:220],
        "status": status,
        "quantity": qty if isinstance(qty, int) else 0,
        "tag": status.upper(),
        "img": img,
        "images": images or ([img] if img else []),
        "url": str(row.get("url") or img or ""),
    }


def _tiles_block(rows: list[dict[str, Any]]) -> str:
    tiles = [_row_to_tile(r) for r in rows if r.get("sku")]
    return "<TILES>" + json.dumps(tiles, ensure_ascii=False) + "</TILES>"


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

    q = str(query or "").strip().lower()
    if q:
        def _match(r: dict[str, Any]) -> bool:
            return (
                q in str(r.get("name") or "").lower()
                or q in str(r.get("sku") or "").lower()
                or q in str(r.get("category") or "").lower()
                or q in str(r.get("description") or "").lower()
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
    summary = f"Here " + ("is" if len(shown) == 1 else "are") + f" your {label}. Tap a card to view details or edit."
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
    lines = [f"Restock priorities for your store:"]
    for i, it in enumerate(items[:5], 1):
        lines.append(f"{i}. {it['name']} — {it.get('reason', '')} (qty {it.get('quantity', 0)})")
    skus = [it["sku"] for it in items[:5] if it.get("sku")]
    rows = [get_seller_product(s) for s in skus]
    rows = [r for r in rows if r]
    if rows:
        return "\n".join(lines) + "\n" + _tiles_block(rows)
    return "\n".join(lines)


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
    """Summarize themes in buyer questions (shipping, sizing, stock, pricing)."""
    sid, err = _store_id_or_error(store_id)
    if err:
        return err
    try:
        from commerce.seller_ai import analyze_buyer_intent
    except ImportError:
        from adk.commerce.seller_ai import analyze_buyer_intent  # type: ignore
    out = analyze_buyer_intent(sid)
    themes = out.get("themes") or []
    if not themes:
        return f"No question themes yet ({out.get('open_count', 0)} open). {out.get('tip', '')}"
    parts = [f"{t['label']} ({t['count']})" for t in themes[:4]]
    return f"Buyer question themes: {', '.join(parts)}. Tip: {out.get('tip', '')}"


async def ask_store_analytics(store_id: str = "", question: str = "") -> str:
    """Answer business questions: top sellers, drafts, low stock, what to focus on."""
    sid, err = _store_id_or_error(store_id)
    if err:
        return err
    q = str(question or "").strip()
    if not q:
        return "Error: ask a question like 'what sold best?' or 'what should I restock?'"
    try:
        from commerce.seller_ai import answer_store_analytics
    except ImportError:
        from adk.commerce.seller_ai import answer_store_analytics  # type: ignore
    out = answer_store_analytics(sid, q)
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
            f"{n} item{'s' if n != 1 else ''} {'are' if n != 1 else 'is'} out of stock — "
            "tap a card to restock."
        )
        return summary + "\n" + _tiles_block(shown)

    if low_stock:
        shown = low_stock[:24]
        n = len(low_stock)
        summary = (
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
        f"{photo_note} Changes are live in the catalog."
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
        row = seed_product_as_seller_row(sku, sid)
    if not row:
        return f"Error: product {sku} not found."
    if str(row.get("store_id") or "") not in ("", sid) and str(row.get("store_id")) != sid:
        return f"Error: product {sku} does not belong to store {sid}."

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

    return f"Updated {sku}: {field}={updated.get(field, value)}. Catalog is live."


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
    return f"Moved {sku} to Trash. It can be restored from the Trash tab."


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
