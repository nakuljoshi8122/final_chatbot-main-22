"""Buyer cart, checkout and restock-notify API routes."""

from fastapi import APIRouter

router = APIRouter(tags=["cart"])


@router.get("/cart")
async def get_cart_endpoint(buyer_id: str):
    from commerce.buyer_cart import get_cart

    return get_cart(buyer_id)


@router.post("/cart/add")
async def add_to_cart_endpoint(body: dict):
    from commerce.buyer_cart import add_to_cart

    b = body or {}
    return add_to_cart(
        str(b.get("buyer_id") or ""),
        str(b.get("sku") or ""),
        str(b.get("store_id") or ""),
        int(b.get("qty") or 1),
    )


@router.post("/cart/update")
async def update_cart_endpoint(body: dict):
    from commerce.buyer_cart import update_cart_qty

    b = body or {}
    return update_cart_qty(
        str(b.get("buyer_id") or ""),
        str(b.get("sku") or ""),
        int(b.get("qty") or 0),
    )


@router.post("/cart/remove")
async def remove_from_cart_endpoint(body: dict):
    from commerce.buyer_cart import remove_from_cart

    b = body or {}
    return remove_from_cart(str(b.get("buyer_id") or ""), str(b.get("sku") or ""))


@router.post("/cart/clear")
async def clear_cart_endpoint(body: dict):
    from commerce.buyer_cart import clear_cart

    b = body or {}
    return clear_cart(str(b.get("buyer_id") or ""))


@router.post("/cart/checkout")
async def checkout_endpoint(body: dict):
    from commerce.buyer_cart import checkout

    b = body or {}
    return checkout(str(b.get("buyer_id") or ""))


@router.post("/buy-now")
async def buy_now_endpoint(body: dict):
    from commerce.buyer_cart import buy_now

    b = body or {}
    return buy_now(
        str(b.get("buyer_id") or ""),
        str(b.get("sku") or ""),
        str(b.get("store_id") or ""),
        int(b.get("qty") or 1),
    )


@router.post("/notify/subscribe")
async def notify_subscribe_endpoint(body: dict):
    from commerce.buyer_cart import notify_subscribe

    b = body or {}
    return notify_subscribe(
        str(b.get("buyer_id") or ""),
        str(b.get("sku") or ""),
        str(b.get("store_id") or ""),
    )


@router.get("/notify/count")
async def notify_count_endpoint(sku: str):
    """How many buyers asked to be notified for this SKU."""
    from commerce.buyer_cart import notify_subscriber_count

    return {"sku": sku, "count": notify_subscriber_count(sku)}


@router.post("/notify/broadcast")
async def notify_broadcast_endpoint(body: dict):
    """Seller notifies waitlist — AI message + buyer inbox when store_id provided."""
    b = body or {}
    sku = str(b.get("sku") or "")
    store_id = str(b.get("store_id") or "")
    if store_id:
        from commerce.seller_ai import broadcast_restock_with_message

        return broadcast_restock_with_message(sku, store_id=store_id)
    from commerce.buyer_cart import notify_broadcast

    return notify_broadcast(sku)


@router.get("/notify/inbox")
async def notify_inbox_endpoint(buyer_id: str):
    """Buyer restock / seller notification inbox."""
    try:
        from paths import DATA_DIR
    except ImportError:
        from adk.paths import DATA_DIR  # type: ignore
    import json

    path = DATA_DIR / "buyer_notifications.json"
    if not path.exists():
        return {"notifications": []}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        rows = list(data.get(str(buyer_id).strip()) or [])
        return {"notifications": rows[:30]}
    except Exception:
        return {"notifications": []}
