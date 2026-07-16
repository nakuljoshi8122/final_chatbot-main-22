"""Seller-facing tools: list / add / update inventory via chat."""

from __future__ import annotations

import re
import uuid
from typing import Optional

try:
    from .seller_catalog import (
        delete_seller_product,
        get_seller_product,
        list_seller_products,
        upsert_seller_product,
    )
    from .store_scope import get_current_store_id
    from .store_registry import get_store, normalize_category
except ImportError:
    from seller_catalog import (
        delete_seller_product,
        get_seller_product,
        list_seller_products,
        upsert_seller_product,
    )
    from store_scope import get_current_store_id
    from store_registry import get_store, normalize_category


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


async def list_my_inventory(store_id: str = "", status: str = "all") -> str:
    """List products in this seller's store inventory.

    Args:
        store_id: Store id from SYSTEM NOTE (optional if already scoped).
        status: Filter: all | active | draft | archive | trash.

    Returns:
        Inventory summary for the store.
    """
    sid, err = _store_id_or_error(store_id)
    if err:
        return err
    rows = list_seller_products(active_only=False, store_id=sid)
    if status and status != "all":
        rows = [r for r in rows if str(r.get("status") or "active").lower() == status.lower()]
    if not rows:
        return f"No products in store {sid} yet. Use upsert_inventory_item to add one."
    lines = [f"INVENTORY for store {sid} ({len(rows)} items):"]
    for r in rows[:40]:
        lines.append(
            f"- {r.get('name')} | SKU={r.get('sku')} | ${r.get('price') or '?'} | "
            f"qty={r.get('quantity')} | status={r.get('status')} | cat={r.get('category')}"
        )
    if len(rows) > 40:
        lines.append(f"…and {len(rows) - 40} more")
    return "\n".join(lines)


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
        status: active | draft | archive | trash.
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
                from .chat_image_stash import consume_pending_chat_image_b64
                from .store_scope import get_current_store_id as _gid
            except ImportError:
                from chat_image_stash import consume_pending_chat_image_b64
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
    return f"Updated {sku}: {field}={updated.get(field, value)}. Catalog is live."


async def remove_inventory_item(sku: str, store_id: str = "") -> str:
    """Delete a product from this store's inventory.

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
    row = get_seller_product(sku)
    if not row:
        return f"Error: product {sku} not found."
    if str(row.get("store_id") or "") not in ("", sid) and str(row.get("store_id")) != sid:
        return f"Error: product {sku} does not belong to this store."
    ok = delete_seller_product(sku)
    return f"Deleted {sku}." if ok else f"Could not delete {sku}."
