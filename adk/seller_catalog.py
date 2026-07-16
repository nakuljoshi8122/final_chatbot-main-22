"""Seller-listed products — live catalog overlay used by chat search_kb."""

from __future__ import annotations

import base64
import json
import logging
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)

ADK_DIR = Path(__file__).resolve().parent
SELLER_JSON = ADK_DIR / "seller_products.json"
VISIBILITY_JSON = ADK_DIR / "inventory_visibility.json"
PRODUCT_IMAGES_DIR = ADK_DIR / "static" / "products"


def _public_base() -> str:
    return (
        os.getenv("API_PUBLIC_URL")
        or os.getenv("EXPO_PUBLIC_API_URL")
        or "http://127.0.0.1:8000"
    ).rstrip("/")


def _load() -> dict[str, dict[str, Any]]:
    if not SELLER_JSON.exists():
        return {}
    try:
        data = json.loads(SELLER_JSON.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _save(data: dict[str, dict[str, Any]]) -> None:
    SELLER_JSON.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def _load_visibility() -> dict[str, dict[str, Any]]:
    if not VISIBILITY_JSON.exists():
        return {}
    try:
        data = json.loads(VISIBILITY_JSON.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _save_visibility(data: dict[str, dict[str, Any]]) -> None:
    VISIBILITY_JSON.write_text(
        json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )


def set_inventory_visibility(items: list[dict[str, Any]]) -> dict[str, Any]:
    """Authoritative Active/Draft/Archive/Trash map from the seller inventory app."""
    data: dict[str, dict[str, Any]] = {}
    for raw in items:
        sku = str(raw.get("sku") or "").strip().upper()
        if not sku:
            continue
        name = str(raw.get("name") or "").strip()
        status = str(raw.get("status") or "active").strip().lower()
        data[sku] = {
            "sku": sku,
            "name": name,
            "status": status,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
    _save_visibility(data)
    return {"ok": True, "count": len(data)}


def inventory_status_for_sku(sku: str, fallback: str = "active") -> str:
    key = str(sku or "").strip().upper()
    if not key:
        return fallback
    row = _load_visibility().get(key)
    if row:
        return str(row.get("status") or fallback).lower()
    return fallback


def list_seller_products(
    active_only: bool = False,
    store_id: Optional[str] = None,
) -> list[dict[str, Any]]:
    rows = list(_load().values())
    if store_id:
        sid = str(store_id).strip()
        rows = [r for r in rows if str(r.get("store_id") or "").strip() == sid]
    if active_only:
        rows = [
            r
            for r in rows
            if inventory_status_for_sku(
                str(r.get("sku") or ""),
                str(r.get("status") or "active").lower(),
            )
            == "active"
        ]
    return sorted(rows, key=lambda r: str(r.get("updated_at") or ""), reverse=True)


def chat_suppressed_keys() -> tuple[set[str], set[str]]:
    """Titles + SKUs hidden from customer chat (draft / archive / trash listings)."""
    titles: set[str] = set()
    skus: set[str] = set()

    for sku, row in _load_visibility().items():
        status = str(row.get("status") or "active").lower()
        if status == "active":
            continue
        name = str(row.get("name") or "").strip().lower()
        if name:
            titles.add(name)
        if sku:
            skus.add(str(sku).upper())

    vis_skus = set(_load_visibility().keys())
    for row in list(_load().values()):
        sku = str(row.get("sku") or "").strip().upper()
        if sku in vis_skus:
            continue
        status = str(row.get("status") or "active").lower()
        if status == "active":
            continue
        name = str(row.get("name") or "").strip().lower()
        if name:
            titles.add(name)
        if sku:
            skus.add(sku)
    return titles, skus


def is_chat_visible(row: dict[str, Any]) -> bool:
    sku = str(row.get("sku") or "").strip().upper()
    fallback = str(row.get("status") or "active").lower()
    return inventory_status_for_sku(sku, fallback) == "active"


def get_seller_product(sku: str) -> Optional[dict[str, Any]]:
    return _load().get(sku.upper())


def upsert_seller_product(payload: dict[str, Any], *, tag: bool = True, force_retag: bool = False) -> dict[str, Any]:
    """Create/update a seller product. Optional image_base64 saves to static/products."""
    sku = str(payload.get("sku") or "").strip().upper()
    if not sku:
        raise ValueError("sku is required")
    name = str(payload.get("name") or "").strip()
    if not name:
        raise ValueError("name is required")

    data = _load()
    existing = data.get(sku) or {}

    image_b64 = payload.get("image_base64")
    image_changed = False
    if image_b64:
        PRODUCT_IMAGES_DIR.mkdir(parents=True, exist_ok=True)
        raw = re.sub(r"^data:image/[^;]+;base64,", "", str(image_b64))
        dest = PRODUCT_IMAGES_DIR / f"{sku}.jpg"
        dest.write_bytes(base64.b64decode(raw))
        image_changed = True

    base = _public_base()
    local_img = PRODUCT_IMAGES_DIR / f"{sku}.jpg"
    img = (
        payload.get("image_url")
        or existing.get("img")
        or (f"{base}/product-images/{sku}.jpg" if local_img.exists() else "")
    )
    if local_img.exists():
        img = f"{base}/product-images/{sku}.jpg"

    url = payload.get("url") or existing.get("url") or img or f"{base}/product-images/{sku}.jpg"

    now = datetime.now(timezone.utc).isoformat()
    store_id = str(payload.get("store_id") or existing.get("store_id") or "").strip()
    row = {
        "sku": sku,
        "name": name,
        "category": str(payload.get("category") or "Handicrafts").strip(),
        "price": str(payload.get("price") or "").strip(),
        "description": str(payload.get("description") or "").strip(),
        "category_notes": str(payload.get("category_notes") or "").strip(),
        "quantity": int(payload.get("quantity") or 0),
        "status": str(payload.get("status") or "active").strip().lower(),
        "img": img,
        "url": url,
        "source": "seller",
        "store_id": store_id,
        "tags": list(existing.get("tags") or []),
        "updated_at": now,
        "created_at": existing.get("created_at") or payload.get("created_at") or now,
    }

    payload_tags = payload.get("tags")
    if isinstance(payload_tags, list) and payload_tags:
        row["tags"] = [str(t).strip().lower() for t in payload_tags if str(t).strip()]

    if tag:
        should_tag = force_retag or image_changed or not row.get("tags") or not row.get("domain")
        if should_tag:
            try:
                try:
                    from .product_tagger import ensure_tags, heuristic_meta
                except ImportError:
                    from product_tagger import ensure_tags, heuristic_meta
                if force_retag or image_changed:
                    meta = ensure_tags(row, force=True)
                elif not row.get("tags"):
                    meta = heuristic_meta(
                        name=row["name"],
                        category=row["category"],
                        description=f"{row.get('description') or ''} {row.get('category_notes') or ''}",
                    )
                else:
                    meta = ensure_tags(row, force=False)
                row["tags"] = list(meta.get("tags") or [])
                row["domain"] = meta.get("domain") or row.get("domain") or ""
                row["audience"] = meta.get("audience") or row.get("audience") or "all"
                row["product_type"] = meta.get("product_type") or row.get("product_type") or ""
                # Correct store category when AI domain is clear (tee → Apparel)
                label = meta.get("category_label")
                if label and row["category"] in ("", "Handicrafts") and label != "Handicrafts":
                    row["category"] = label
                elif label and row.get("domain") == "apparel":
                    row["category"] = "Apparel"
                elif label and row.get("domain") == "skincare":
                    row["category"] = "Skincare"
            except Exception as e:
                logger.warning("Tagging failed for %s: %s", sku, e)

    data[sku] = row
    _save(data)
    return row


def delete_seller_product(sku: str) -> bool:
    data = _load()
    key = sku.upper()
    if key not in data:
        return False
    del data[key]
    _save(data)
    return True


def retag_all_seller_products(force: bool = False) -> dict[str, Any]:
    data = _load()
    updated = 0
    for sku, row in list(data.items()):
        if not force and isinstance(row.get("tags"), list) and row["tags"] and row.get("domain"):
            continue
        try:
            try:
                from .product_tagger import ensure_tags
            except ImportError:
                from product_tagger import ensure_tags
            meta = ensure_tags(row, force=force or not row.get("domain"))
            row["tags"] = list(meta.get("tags") or [])
            row["domain"] = meta.get("domain") or ""
            row["audience"] = meta.get("audience") or "all"
            row["product_type"] = meta.get("product_type") or ""
            label = meta.get("category_label")
            if row.get("domain") == "apparel":
                row["category"] = "Apparel"
            elif row.get("domain") == "skincare":
                row["category"] = "Skincare"
            elif label:
                row["category"] = label
            row["updated_at"] = datetime.now(timezone.utc).isoformat()
            data[sku] = row
            updated += 1
        except Exception as e:
            logger.warning("Retag failed for %s: %s", sku, e)
    _save(data)
    return {"ok": True, "updated": updated, "total": len(data)}


def seller_to_kb_chunk(row: dict[str, Any]) -> str:
    lines = [
        f"## {row.get('name')}",
        f"- Category: {row.get('category')} | SKU: {row.get('sku')} | Price: {row.get('price') or 'n/a'}",
    ]
    if row.get("store_id"):
        lines.append(f"- Store_id: {row['store_id']}")
    if row.get("description"):
        lines.append(f"- Specs: {row['description']}")
    if row.get("category_notes"):
        lines.append(f"- Notes: {row['category_notes']}")
    if row.get("domain"):
        lines.append(f"- Domain: {row['domain']}")
    if row.get("audience"):
        lines.append(f"- Audience: {row['audience']}")
    if row.get("product_type"):
        lines.append(f"- Type: {row['product_type']}")
    tags = row.get("tags") or []
    if tags:
        lines.append(f"- Tags: {', '.join(str(t) for t in tags)}")
    qty = row.get("quantity")
    if qty is not None:
        lines.append(f"- Stock: {qty} units")
    lines.append(f"- Status: {row.get('status') or 'active'}")
    lines.append("- Source: seller_listed (live inventory)")
    return "\n".join(lines)


def seller_kb_chunks(active_only: bool = True, store_id: Optional[str] = None) -> list[str]:
    return [
        seller_to_kb_chunk(r)
        for r in list_seller_products(active_only=active_only, store_id=store_id)
    ]


def seller_as_catalog_products(
    active_only: bool = True,
    store_id: Optional[str] = None,
) -> list[dict[str, Any]]:
    """Shape compatible with boutique_catalog.parse_kb_products()."""
    out: list[dict[str, Any]] = []
    for r in list_seller_products(active_only=active_only, store_id=store_id):
        out.append(
            {
                "id": r["sku"],
                "sku": r["sku"],
                "name": r["name"],
                "price": r.get("price") or "",
                "category": r.get("category") or "",
                "description": (r.get("description") or "")[:160],
                "kb_excerpt": seller_to_kb_chunk(r)[:1200],
                "img": r.get("img") or "",
                "url": r.get("url") or "",
                "tags": list(r.get("tags") or []),
                "domain": r.get("domain") or "",
                "audience": r.get("audience") or "",
                "product_type": r.get("product_type") or "",
                "store_id": r.get("store_id") or "",
                "source": "seller",
            }
        )
    return out
