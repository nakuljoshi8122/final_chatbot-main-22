"""Store registry API routes."""

from fastapi import APIRouter

from api.schemas import StoreCreateIn

router = APIRouter(tags=["stores"])


@router.get("/stores")
async def get_stores(category: str | None = None):
    from stores.store_registry import list_stores, seed_demo_stores_if_empty

    seed_demo_stores_if_empty()
    return {"stores": list_stores(category=category)}


@router.post("/stores")
async def post_store(body: StoreCreateIn):
    from stores.store_registry import create_store

    try:
        row = create_store(body.model_dump())
        return {"ok": True, "store": row}
    except ValueError as e:
        return {"ok": False, "error": str(e)}


@router.get("/stores/{store_id}")
async def get_store_endpoint(store_id: str):
    from stores.store_registry import get_store

    row = get_store(store_id)
    if not row:
        return {"error": "Store not found"}
    return row


@router.get("/stores/{store_id}/queries")
async def get_store_queries(store_id: str, status: str = "open"):
    from stores.store_registry import list_store_queries

    return {"queries": list_store_queries(store_id, status=status)}


@router.post("/stores/{store_id}/queries/{query_id}/answer")
async def post_store_query_answer(store_id: str, query_id: str, body: dict):
    from stores.store_registry import answer_store_query

    answer = str((body or {}).get("answer") or "")
    row = answer_store_query(store_id, query_id, answer)
    if not row:
        return {"ok": False, "error": "Query not found"}
    return {"ok": True, "query": row}
