"""Cross-shop buyer cart, checkout and restock-notify engine.

Carts are keyed by a client-generated ``buyer_id`` (persistent device id) so a
shopper keeps one basket across every store until they clear it. Stock is
*reserved* the moment an item enters the cart: on-hand quantity in
``seller_products.json`` drops immediately and is restored when the line is
removed / decreased / the cart is cleared. Checkout converts reserved items into
an order (stock stays gone). Everything is persisted to JSON so it survives
restarts.
"""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from paths import BUYER_CARTS_JSON, BUYER_ORDERS_JSON, RESTOCK_NOTIFY_JSON

try:
    from catalog.seller_catalog import (
        adjust_seller_stock,
        available_quantity,
        get_seller_product,
        seed_product_as_seller_row,
    )
except ImportError:  # pragma: no cover - import shim for script contexts
    from adk.catalog.seller_catalog import (  # type: ignore
        adjust_seller_stock,
        available_quantity,
        get_seller_product,
        seed_product_as_seller_row,
    )

logger = logging.getLogger(__name__)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _load(path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _save(path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def _price_to_float(price: Any) -> float:
    s = str(price or "").strip().replace("$", "").replace(",", "")
    try:
        return float(s)
    except (TypeError, ValueError):
        return 0.0


def _product_snapshot(sku: str, store_id: str = "") -> Optional[dict[str, Any]]:
    row = get_seller_product(sku) or seed_product_as_seller_row(sku, store_id)
    if not row:
        return None
    return {
        "sku": str(row.get("sku") or sku).strip().upper(),
        "name": str(row.get("name") or "").strip(),
        "price": str(row.get("price") or "").strip(),
        "img": str(row.get("img") or "").strip(),
        "url": str(row.get("url") or "").strip(),
        "category": str(row.get("category") or "").strip(),
        "store_id": str(row.get("store_id") or store_id or "").strip(),
    }


def _cart_totals(items: list[dict[str, Any]]) -> dict[str, Any]:
    count = sum(int(it.get("qty") or 0) for it in items)
    subtotal = sum(_price_to_float(it.get("price")) * int(it.get("qty") or 0) for it in items)
    return {"count": count, "subtotal": round(subtotal, 2)}


def _empty_cart(buyer_id: str) -> dict[str, Any]:
    return {"buyer_id": buyer_id, "items": [], "count": 0, "subtotal": 0.0, "updated_at": _now()}


def _shape(buyer_id: str, raw: dict[str, Any]) -> dict[str, Any]:
    items = list(raw.get("items") or [])
    # Refresh live availability so the UI can show sold-out / low-stock hints.
    for it in items:
        it["available"] = available_quantity(it.get("sku", ""), it.get("store_id", ""))
    totals = _cart_totals(items)
    return {
        "buyer_id": buyer_id,
        "items": items,
        "count": totals["count"],
        "subtotal": totals["subtotal"],
        "updated_at": raw.get("updated_at") or _now(),
    }


def get_cart(buyer_id: str) -> dict[str, Any]:
    bid = str(buyer_id or "").strip()
    if not bid:
        return _empty_cart("")
    carts = _load(BUYER_CARTS_JSON)
    raw = carts.get(bid) or {"items": []}
    return _shape(bid, raw)


def add_to_cart(buyer_id: str, sku: str, store_id: str = "", qty: int = 1) -> dict[str, Any]:
    bid = str(buyer_id or "").strip()
    key = str(sku or "").strip().upper()
    qty = max(1, int(qty or 1))
    if not bid or not key:
        return {"ok": False, "error": "buyer_id and sku are required"}

    snap = _product_snapshot(key, store_id)
    if not snap:
        return {"ok": False, "error": "Product not found"}

    if available_quantity(key, store_id) < qty:
        return {"ok": False, "error": "sold_out", "cart": get_cart(bid)}

    try:
        adjust_seller_stock(key, -qty, store_id)
    except ValueError:
        return {"ok": False, "error": "sold_out", "cart": get_cart(bid)}

    carts = _load(BUYER_CARTS_JSON)
    cart = carts.get(bid) or {"items": []}
    items = list(cart.get("items") or [])
    for it in items:
        if str(it.get("sku") or "").upper() == key:
            it["qty"] = int(it.get("qty") or 0) + qty
            break
    else:
        items.append({**snap, "qty": qty, "added_at": _now()})
    cart["items"] = items
    cart["updated_at"] = _now()
    carts[bid] = cart
    _save(BUYER_CARTS_JSON, carts)
    return {"ok": True, "cart": _shape(bid, cart)}


def update_cart_qty(buyer_id: str, sku: str, qty: int) -> dict[str, Any]:
    bid = str(buyer_id or "").strip()
    key = str(sku or "").strip().upper()
    qty = max(0, int(qty or 0))
    if not bid or not key:
        return {"ok": False, "error": "buyer_id and sku are required"}

    carts = _load(BUYER_CARTS_JSON)
    cart = carts.get(bid) or {"items": []}
    items = list(cart.get("items") or [])
    line = next((it for it in items if str(it.get("sku") or "").upper() == key), None)
    if not line:
        return {"ok": False, "error": "Item not in cart", "cart": get_cart(bid)}

    current = int(line.get("qty") or 0)
    delta = qty - current
    if delta > 0 and available_quantity(key, line.get("store_id", "")) < delta:
        return {"ok": False, "error": "sold_out", "cart": _shape(bid, cart)}

    if delta != 0:
        try:
            # Reserving more -> negative stock delta; releasing -> positive.
            adjust_seller_stock(key, -delta, line.get("store_id", ""))
        except ValueError:
            return {"ok": False, "error": "sold_out", "cart": _shape(bid, cart)}

    if qty == 0:
        items = [it for it in items if str(it.get("sku") or "").upper() != key]
    else:
        line["qty"] = qty
    cart["items"] = items
    cart["updated_at"] = _now()
    carts[bid] = cart
    _save(BUYER_CARTS_JSON, carts)
    return {"ok": True, "cart": _shape(bid, cart)}


def remove_from_cart(buyer_id: str, sku: str) -> dict[str, Any]:
    return update_cart_qty(buyer_id, sku, 0)


def clear_cart(buyer_id: str, *, restore_stock: bool = True) -> dict[str, Any]:
    bid = str(buyer_id or "").strip()
    if not bid:
        return {"ok": False, "error": "buyer_id required"}
    carts = _load(BUYER_CARTS_JSON)
    cart = carts.get(bid) or {"items": []}
    if restore_stock:
        for it in list(cart.get("items") or []):
            try:
                adjust_seller_stock(it.get("sku", ""), int(it.get("qty") or 0), it.get("store_id", ""))
            except Exception as e:  # pragma: no cover - defensive
                logger.warning("clear_cart restore failed for %s: %s", it.get("sku"), e)
    carts[bid] = {"items": [], "updated_at": _now()}
    _save(BUYER_CARTS_JSON, carts)
    return {"ok": True, "cart": _empty_cart(bid)}


def _record_order(buyer_id: str, items: list[dict[str, Any]]) -> dict[str, Any]:
    order = {
        "id": f"ord-{uuid.uuid4().hex[:10]}",
        "buyer_id": buyer_id,
        "items": items,
        "total": _cart_totals(items)["subtotal"],
        "created_at": _now(),
    }
    orders = _load(BUYER_ORDERS_JSON)
    buyer_orders = list(orders.get(buyer_id) or [])
    buyer_orders.insert(0, order)
    orders[buyer_id] = buyer_orders
    _save(BUYER_ORDERS_JSON, orders)
    return order


def checkout(buyer_id: str) -> dict[str, Any]:
    """Convert the reserved cart into an order. Stock stays decremented."""
    bid = str(buyer_id or "").strip()
    if not bid:
        return {"ok": False, "error": "buyer_id required"}
    carts = _load(BUYER_CARTS_JSON)
    cart = carts.get(bid) or {"items": []}
    items = list(cart.get("items") or [])
    if not items:
        return {"ok": False, "error": "Cart is empty"}
    order = _record_order(bid, items)
    carts[bid] = {"items": [], "updated_at": _now()}
    _save(BUYER_CARTS_JSON, carts)
    return {"ok": True, "order": order, "cart": _empty_cart(bid)}


def buy_now(buyer_id: str, sku: str, store_id: str = "", qty: int = 1) -> dict[str, Any]:
    """Reserve + immediately order a single item without touching the saved cart."""
    bid = str(buyer_id or "").strip()
    key = str(sku or "").strip().upper()
    qty = max(1, int(qty or 1))
    if not bid or not key:
        return {"ok": False, "error": "buyer_id and sku are required"}

    snap = _product_snapshot(key, store_id)
    if not snap:
        return {"ok": False, "error": "Product not found"}
    if available_quantity(key, store_id) < qty:
        return {"ok": False, "error": "sold_out"}
    try:
        adjust_seller_stock(key, -qty, store_id)
    except ValueError:
        return {"ok": False, "error": "sold_out"}

    order = _record_order(bid, [{**snap, "qty": qty}])
    return {"ok": True, "order": order}


def notify_subscribe(buyer_id: str, sku: str, store_id: str = "") -> dict[str, Any]:
    bid = str(buyer_id or "").strip()
    key = str(sku or "").strip().upper()
    if not bid or not key:
        return {"ok": False, "error": "buyer_id and sku are required"}
    data = _load(RESTOCK_NOTIFY_JSON)
    subs = list(data.get(key) or [])
    if not any(str(s.get("buyer_id")) == bid for s in subs):
        subs.append({"buyer_id": bid, "store_id": str(store_id or "").strip(), "created_at": _now()})
    data[key] = subs
    _save(RESTOCK_NOTIFY_JSON, data)
    return {"ok": True}


def notify_subscriber_count(sku: str) -> int:
    key = str(sku or "").strip().upper()
    if not key:
        return 0
    data = _load(RESTOCK_NOTIFY_JSON)
    return len(list(data.get(key) or []))


def notify_broadcast(sku: str) -> dict[str, Any]:
    """Clear waitlist after seller restocks (POC: no push, just clear)."""
    key = str(sku or "").strip().upper()
    if not key:
        return {"ok": False, "error": "sku required"}
    data = _load(RESTOCK_NOTIFY_JSON)
    count = len(list(data.get(key) or []))
    data[key] = []
    _save(RESTOCK_NOTIFY_JSON, data)
    return {"ok": True, "notified": count}
