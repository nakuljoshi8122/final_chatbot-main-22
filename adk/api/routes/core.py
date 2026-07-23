"""Health, products, shop requests, and session routes."""

import os

from fastapi import APIRouter

from api import deps
from api.schemas import ActiveProductBody, SessionOnlyBody
from commerce.product_matcher import get_product_by_id
from commerce.session_commerce import set_active_product
from commerce.agent_markup import strip_agent_markup
from config.llm_config import get_llm_provider
from persistence.session_store import hydrate_session_state, load_messages, load_session
from voice.whisper_utils import is_openai_configured

router = APIRouter(tags=["core"])


@router.get("/health")
async def health_check():
    provider = get_llm_provider()
    api_configured = bool(
        os.getenv("OPENAI_API_KEY") if provider == "openai" else os.getenv("GOOGLE_API_KEY")
    )
    return {
        "status": "healthy",
        "service": deps.SERVICE_LABEL,
        "agent_mode": deps.AGENT_MODE,
        "agent_use_tools": deps.AGENT_USE_TOOLS,
        "llm_provider": provider,
        "api_configured": api_configured,
        "openai_model": os.getenv("OPENAI_MODEL", "gpt-4o-mini"),
        "whisper_configured": is_openai_configured(),
        "timestamp": "2025-01-07T08:30:00Z",
    }


@router.get("/shop/requests")
async def get_shop_requests(status: str = "open", limit: int = 50):
    from persistence.crm_models import list_shop_requests

    rows = await list_shop_requests(status=status, limit=limit)
    return {
        "requests": [
            {
                "id": r.id,
                "session_id": r.session_id,
                "item_query": r.item_query,
                "notes": r.notes,
                "status": r.status,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in rows
        ]
    }


@router.post("/shop/requests/{request_id}/fulfill")
async def fulfill_shop_request_endpoint(request_id: int):
    from persistence.crm_models import fulfill_shop_request

    ok = await fulfill_shop_request(request_id)
    return {"ok": ok, "id": request_id}


@router.get("/products/{product_id}")
async def get_product(product_id: str):
    product = get_product_by_id(product_id)
    if not product:
        return {"error": "Product not found"}
    return product


@router.post("/session/active-product")
async def mark_active_product(body: ActiveProductBody):
    hydrate_session_state(body.session_id)
    tile = set_active_product(body.session_id, body.product_id)
    if not tile:
        return {"ok": False, "error": "Product not found"}
    return {"ok": True, "product": tile}


@router.post("/session/clear-listing-draft")
async def clear_listing_draft(body: SessionOnlyBody):
    """Clear in-progress listing draft after the seller publishes from the form."""
    try:
        from commerce.seller_listing_context import clear_pending_listing
    except ImportError:
        from commerce.seller_listing_context import clear_pending_listing
    clear_pending_listing(body.session_id)
    return {"ok": True}


@router.post("/session/clear-listing-draft")
async def clear_listing_draft(body: dict):
    session_id = str(body.get("session_id") or "").strip()
    if not session_id:
        return {"ok": False, "error": "session_id required"}
    try:
        from commerce.seller_listing_context import clear_pending_listing
    except ImportError:
        from commerce.seller_listing_context import clear_pending_listing
    clear_pending_listing(session_id)
    return {"ok": True}


@router.get("/session/{session_id}/history")
async def get_session_history(session_id: str):
    hydrate_session_state(session_id)
    messages = load_messages(session_id)
    cleaned = []
    for msg in messages:
        raw = msg.get("content", "")
        entry: dict = {"role": msg.get("role", ""), "content": raw}
        if msg.get("role") == "assistant":
            entry["display"] = strip_agent_markup(raw)
        if msg.get("ts"):
            entry["ts"] = msg["ts"]
        cleaned.append(entry)
    doc = load_session(session_id)
    return {
        "session_id": session_id,
        "messages": cleaned,
        "cart": doc.get("cart", []),
    }
