"""Dynamic store registry — sellers create shops; buyers browse by category."""

from __future__ import annotations

from paths import ENV_FILE, DATA_DIR, STATIC_DIR, PRODUCT_IMAGES_DIR, PENDING_CHAT_IMAGES_DIR, FAKE_KB_PATH, SELLER_PRODUCTS_JSON, INVENTORY_VISIBILITY_JSON, STORES_JSON, STORE_QUERIES_DIR, PRODUCT_IMAGES_JSON, BOUTIQUE_PRODUCT_IMAGES_JSON

import json
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

# ADK_DIR via paths
STORES_JSON = STORES_JSON
QUERIES_DIR = STORE_QUERIES_DIR

CATEGORIES = ("Skincare", "Apparel", "Handicrafts")
CATEGORY_ALIASES = {
    "skincare": "Skincare",
    "skin": "Skincare",
    "apparel": "Apparel",
    "apparels": "Apparel",
    "clothing": "Apparel",
    "handicrafts": "Handicrafts",
    "handicraft": "Handicrafts",
    "craft": "Handicrafts",
}


def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


def _load() -> dict[str, dict[str, Any]]:
    if not STORES_JSON.exists():
        return {}
    try:
        data = json.loads(STORES_JSON.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _save(data: dict[str, dict[str, Any]]) -> None:
    STORES_JSON.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def normalize_category(raw: str) -> str:
    key = str(raw or "").strip()
    if key in CATEGORIES:
        return key
    return CATEGORY_ALIASES.get(key.lower(), "") or "Handicrafts"


def list_stores(category: Optional[str] = None) -> list[dict[str, Any]]:
    rows = list(_load().values())
    if category:
        cat = normalize_category(category)
        rows = [r for r in rows if normalize_category(str(r.get("category") or "")) == cat]
    return sorted(rows, key=lambda r: str(r.get("created_at") or ""), reverse=True)


def get_store(store_id: str) -> Optional[dict[str, Any]]:
    if not store_id:
        return None
    return _load().get(str(store_id).strip())


def create_store(payload: dict[str, Any]) -> dict[str, Any]:
    name = str(payload.get("name") or "").strip()
    if not name:
        raise ValueError("Store name is required")
    owner_name = str(payload.get("owner_name") or "").strip()
    if not owner_name:
        raise ValueError("Owner name is required")
    category = normalize_category(str(payload.get("category") or "Handicrafts"))

    store_id = str(payload.get("id") or "").strip() or f"store_{uuid.uuid4().hex[:10]}"
    data = _load()
    if store_id in data:
        raise ValueError(f"Store id already exists: {store_id}")

    row = {
        "id": store_id,
        "name": name,
        "owner_name": owner_name,
        "owner_email": str(payload.get("owner_email") or "").strip(),
        "owner_phone": str(payload.get("owner_phone") or "").strip(),
        "category": category,
        "description": str(payload.get("description") or "").strip(),
        "address": str(payload.get("address") or "").strip(),
        "created_at": _utcnow(),
        "updated_at": _utcnow(),
    }
    data[store_id] = row
    _save(data)
    QUERIES_DIR.mkdir(parents=True, exist_ok=True)
    _queries_path(store_id).write_text("[]\n", encoding="utf-8")
    # Give this shop its own copies of the default category catalog (not shared SKUs)
    try:
        from catalog.seller_catalog import clone_default_catalog_for_store
    except ImportError:
        from catalog.seller_catalog import clone_default_catalog_for_store
    try:
        clone_default_catalog_for_store(store_id)
    except Exception:
        pass
    return row


def update_store(store_id: str, payload: dict[str, Any]) -> Optional[dict[str, Any]]:
    data = _load()
    row = data.get(store_id)
    if not row:
        return None
    for key in ("name", "owner_name", "owner_email", "owner_phone", "description", "address"):
        if key in payload and payload[key] is not None:
            row[key] = str(payload[key]).strip()
    if payload.get("category"):
        row["category"] = normalize_category(str(payload["category"]))
    row["updated_at"] = _utcnow()
    data[store_id] = row
    _save(data)
    return row


def _scrub_buyer_data_for_store(store_id: str) -> dict[str, int]:
    """Remove cart lines / orders / restock notifies tied to this shop."""
    from paths import BUYER_CARTS_JSON, BUYER_ORDERS_JSON, RESTOCK_NOTIFY_JSON

    sid = str(store_id or "").strip()
    counts = {"carts": 0, "orders": 0, "notifies": 0}

    def _load_json(path: Path, default: Any) -> Any:
        if not path.exists():
            return default
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            return default

    def _save_json(path: Path, payload: Any) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    carts = _load_json(BUYER_CARTS_JSON, {})
    if isinstance(carts, dict):
        changed = False
        for buyer_id, cart in list(carts.items()):
            items = cart.get("items") if isinstance(cart, dict) else None
            if not isinstance(items, list):
                continue
            kept = [it for it in items if str(it.get("store_id") or "").strip() != sid]
            if len(kept) != len(items):
                counts["carts"] += len(items) - len(kept)
                cart["items"] = kept
                changed = True
        if changed:
            _save_json(BUYER_CARTS_JSON, carts)

    orders = _load_json(BUYER_ORDERS_JSON, [])
    if isinstance(orders, list):
        kept_orders = []
        for order in orders:
            if not isinstance(order, dict):
                kept_orders.append(order)
                continue
            items = order.get("items") if isinstance(order.get("items"), list) else []
            if any(str(it.get("store_id") or "").strip() == sid for it in items if isinstance(it, dict)):
                # Drop whole order if it was for this shop; otherwise strip lines
                only_this = all(
                    str(it.get("store_id") or "").strip() in ("", sid)
                    for it in items
                    if isinstance(it, dict)
                )
                if only_this or str(order.get("store_id") or "").strip() == sid:
                    counts["orders"] += 1
                    continue
                order["items"] = [
                    it
                    for it in items
                    if isinstance(it, dict) and str(it.get("store_id") or "").strip() != sid
                ]
            kept_orders.append(order)
        if len(kept_orders) != len(orders):
            _save_json(BUYER_ORDERS_JSON, kept_orders)
        else:
            # items may have been stripped in-place
            _save_json(BUYER_ORDERS_JSON, kept_orders)

    notify = _load_json(RESTOCK_NOTIFY_JSON, {})
    if isinstance(notify, dict):
        changed = False
        for sku, subs in list(notify.items()):
            if not isinstance(subs, list):
                continue
            kept = [s for s in subs if str((s or {}).get("store_id") or "").strip() != sid]
            if len(kept) != len(subs):
                counts["notifies"] += len(subs) - len(kept)
                if kept:
                    notify[sku] = kept
                else:
                    notify.pop(sku, None)
                changed = True
        if changed:
            _save_json(RESTOCK_NOTIFY_JSON, notify)

    return counts


def delete_store(store_id: str, confirm_name: str) -> dict[str, Any]:
    """Delete a shop after name confirmation. Purges its catalog + buyer visibility.

    Other stores' products and registry rows are left intact.
    """
    sid = str(store_id or "").strip()
    if not sid:
        return {"ok": False, "error": "store_id is required"}

    data = _load()
    row = data.get(sid)
    if not row:
        return {"ok": False, "error": "Store not found"}

    expected = str(row.get("name") or "").strip()
    typed = str(confirm_name or "").strip()
    if not typed:
        return {"ok": False, "error": "Type the store name to confirm deletion"}
    if typed.casefold() != expected.casefold():
        return {
            "ok": False,
            "error": f'Store name does not match. Type "{expected}" exactly to delete.',
        }

    # 1) Products owned by this store (clones + seller uploads)
    try:
        from catalog.seller_catalog import purge_products_for_store
    except ImportError:
        from catalog.seller_catalog import purge_products_for_store
    product_result = purge_products_for_store(sid)

    # 2) Inbox / buyer questions for this shop
    queries_path = _queries_path(sid)
    queries_deleted = False
    if queries_path.exists():
        try:
            queries_path.unlink()
            queries_deleted = True
        except OSError:
            pass

    # 3) Buyer carts / orders / notifies referencing this shop
    buyer_scrub = _scrub_buyer_data_for_store(sid)

    # 4) Remove store from registry last (buyer /stores list)
    del data[sid]
    _save(data)

    return {
        "ok": True,
        "store_id": sid,
        "name": expected,
        "products_deleted": int(product_result.get("deleted") or 0),
        "images_deleted": int(product_result.get("images_deleted") or 0),
        "queries_deleted": queries_deleted,
        "buyer_scrub": buyer_scrub,
    }


def _queries_path(store_id: str) -> Path:
    safe = re.sub(r"[^a-zA-Z0-9_\-]", "_", store_id)
    return QUERIES_DIR / f"{safe}.json"


def list_store_queries(store_id: str, status: str = "open") -> list[dict[str, Any]]:
    path = _queries_path(store_id)
    if not path.exists():
        return []
    try:
        rows = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(rows, list):
            return []
    except Exception:
        return []
    if status and status != "all":
        rows = [r for r in rows if str(r.get("status") or "open") == status]
    return sorted(rows, key=lambda r: str(r.get("created_at") or ""), reverse=True)


def add_store_query(
    store_id: str,
    question: str,
    *,
    session_id: str = "",
    notes: str = "",
) -> dict[str, Any]:
    if not store_id or not question.strip():
        raise ValueError("store_id and question are required")
    QUERIES_DIR.mkdir(parents=True, exist_ok=True)
    path = _queries_path(store_id)
    rows: list[dict[str, Any]] = []
    if path.exists():
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(raw, list):
                rows = raw
        except Exception:
            rows = []

    q_norm = question.strip().lower()
    # Dedupe: same open question (or same session+question) within recent entries
    for row in rows[:30]:
        if str(row.get("status") or "open") != "open":
            continue
        if str(row.get("question") or "").strip().lower() == q_norm:
            return row

    entry = {
        "id": f"q_{uuid.uuid4().hex[:10]}",
        "store_id": store_id,
        "question": question.strip()[:1000],
        "notes": (notes or "").strip()[:1000],
        "session_id": session_id or "",
        "status": "open",
        "answer": "",
        "created_at": _utcnow(),
        "updated_at": _utcnow(),
    }
    rows.insert(0, entry)
    path.write_text(json.dumps(rows, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return entry


def answer_store_query(store_id: str, query_id: str, answer: str) -> Optional[dict[str, Any]]:
    path = _queries_path(store_id)
    if not path.exists():
        return None
    try:
        rows = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None
    if not isinstance(rows, list):
        return None
    for row in rows:
        if str(row.get("id")) == query_id:
            row["answer"] = (answer or "").strip()
            row["status"] = "answered" if row["answer"] else "open"
            row["updated_at"] = _utcnow()
            path.write_text(json.dumps(rows, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
            return row
    return None


def seed_demo_stores_if_empty() -> list[dict[str, Any]]:
    """Create 3 starter stores (one per category) if registry is empty."""
    data = _load()
    if data:
        return list_stores()
    demos = [
        {
            "id": "store_glow_lab",
            "name": "Glow Lab",
            "owner_name": "Demo Owner",
            "owner_email": "glow@example.com",
            "category": "Skincare",
            "description": "Serums, cleansers & daily care",
        },
        {
            "id": "store_atelier_craft",
            "name": "Atelier Craft",
            "owner_name": "Demo Owner",
            "owner_email": "craft@example.com",
            "category": "Handicrafts",
            "description": "Handmade home & artisan goods",
        },
        {
            "id": "store_thread_co",
            "name": "Thread & Co",
            "owner_name": "Demo Owner",
            "owner_email": "thread@example.com",
            "category": "Apparel",
            "description": "Everyday clothing & casual wear",
        },
    ]
    for d in demos:
        create_store(d)
    return list_stores()
