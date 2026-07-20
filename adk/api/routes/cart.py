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
    """Seller marks restock notify as sent (clears waiting list for SKU)."""
    from commerce.buyer_cart import notify_broadcast

    b = body or {}
    return notify_broadcast(str(b.get("sku") or ""))
