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
