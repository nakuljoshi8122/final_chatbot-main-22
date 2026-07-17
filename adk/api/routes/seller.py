"""Seller catalog and inventory API routes."""

from fastapi import APIRouter

from api.schemas import SellerProductIn

router = APIRouter(tags=["seller"])


@router.get("/seller/products")
async def get_seller_products(active_only: bool = False, store_id: str | None = None):
    from catalog.seller_catalog import list_seller_products

    return {"products": list_seller_products(active_only=active_only, store_id=store_id)}


@router.post("/seller/products")
async def post_seller_product(body: SellerProductIn):
    from catalog.seller_catalog import upsert_seller_product

    try:
        payload = body.model_dump()
        force = bool(payload.pop("force_retag", False))
        row = upsert_seller_product(payload, tag=True, force_retag=force)
        return {"ok": True, "product": row}
    except ValueError as e:
        return {"ok": False, "error": str(e)}


@router.post("/seller/products/retag")
async def retag_seller_products(force: bool = True):
    from catalog.seller_catalog import retag_all_seller_products

    return retag_all_seller_products(force=force)


@router.delete("/seller/products/{sku}")
async def remove_seller_product(sku: str):
    from catalog.seller_catalog import delete_seller_product

    return {"ok": delete_seller_product(sku), "sku": sku}


@router.post("/shop/inventory-visibility")
async def post_inventory_visibility(body: dict):
    from catalog.seller_catalog import set_inventory_visibility

    items = body.get("items") if isinstance(body, dict) else None
    if not isinstance(items, list):
        return {"ok": False, "error": "items array required"}
    return set_inventory_visibility(items)
