"""Seller AI API — Tier 1 & Tier 2 features."""

from fastapi import APIRouter

router = APIRouter(prefix="/seller/ai", tags=["seller-ai"])


@router.get("/morning-brief")
async def ai_morning_brief(store_id: str):
    from commerce.seller_ai import generate_morning_brief

    return generate_morning_brief(store_id)


@router.post("/query-draft")
async def ai_query_draft(body: dict):
    from commerce.seller_ai import draft_query_reply

    b = body or {}
    return draft_query_reply(
        str(b.get("store_id") or ""),
        str(b.get("question") or ""),
        notes=str(b.get("notes") or ""),
        target_language=str(b.get("target_language") or ""),
    )


@router.post("/listing-from-image")
async def ai_listing_from_image(body: dict):
    from commerce.seller_ai import suggest_full_listing

    b = body or {}
    return suggest_full_listing(
        str(b.get("image_base64") or ""),
        store_id=str(b.get("store_id") or ""),
        category_hint=str(b.get("category") or ""),
    )


@router.post("/restock-notify")
async def ai_restock_notify(body: dict):
    from commerce.seller_ai import broadcast_restock_with_message

    b = body or {}
    return broadcast_restock_with_message(
        str(b.get("sku") or ""),
        store_id=str(b.get("store_id") or ""),
    )


@router.get("/restock-priorities")
async def ai_restock_priorities(store_id: str):
    from commerce.seller_ai import compute_restock_priorities

    return {"ok": True, "priorities": compute_restock_priorities(store_id)}


@router.get("/pricing-suggestion")
async def ai_pricing_suggestion(store_id: str, sku: str):
    from commerce.seller_ai import suggest_pricing

    return suggest_pricing(store_id, sku)


@router.post("/promo-copy")
async def ai_promo_copy(body: dict):
    from commerce.seller_ai import generate_promo_copy

    b = body or {}
    return generate_promo_copy(
        name=str(b.get("name") or ""),
        category=str(b.get("category") or ""),
        store_name=str(b.get("store_name") or ""),
        promo=str(b.get("promo") or "10% off"),
    )


@router.get("/buyer-intent")
async def ai_buyer_intent(store_id: str):
    from commerce.seller_ai import analyze_buyer_intent

    return analyze_buyer_intent(store_id)


@router.post("/store-analytics")
async def ai_store_analytics(body: dict):
    from commerce.seller_ai import answer_store_analytics

    b = body or {}
    return answer_store_analytics(
        str(b.get("store_id") or ""),
        str(b.get("question") or ""),
    )


@router.post("/batch-photos")
async def ai_batch_photos(body: dict):
    from commerce.seller_ai import analyze_batch_photos

    b = body or {}
    images = b.get("images") if isinstance(b.get("images"), list) else []
    return analyze_batch_photos(
        images,
        category_hint=str(b.get("category") or ""),
    )


@router.post("/translate-reply")
async def ai_translate_reply(body: dict):
    from commerce.seller_ai import translate_text

    b = body or {}
    return translate_text(
        str(b.get("text") or ""),
        str(b.get("target_language") or ""),
    )
