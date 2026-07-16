"""Dynamic store registry — sellers create shops; buyers browse by category."""

from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

ADK_DIR = Path(__file__).resolve().parent
STORES_JSON = ADK_DIR / "stores.json"
QUERIES_DIR = ADK_DIR / "store_queries"

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
