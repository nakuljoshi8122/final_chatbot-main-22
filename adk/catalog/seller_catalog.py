"""Seller-listed products — live catalog overlay used by chat search_kb."""

from __future__ import annotations

from paths import (
    FAKE_KB_PATH,
    PRODUCT_IMAGES_DIR,
    SELLER_PRODUCTS_JSON,
    INVENTORY_VISIBILITY_JSON,
)

import base64
import json
import logging
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)

SELLER_JSON = SELLER_PRODUCTS_JSON
VISIBILITY_JSON = INVENTORY_VISIBILITY_JSON


def _public_base() -> str:
    return (
        os.getenv("API_PUBLIC_URL")
        or os.getenv("EXPO_PUBLIC_API_URL")
        or "http://127.0.0.1:8000"
    ).strip().rstrip("/")


def _price_amount(value: Any) -> float:
    try:
        return float(re.sub(r"[^\d.]", "", str(value or "")) or "0")
    except Exception:
        return 0.0


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
    prev = _load_visibility()
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
    # Keep permanently purged SKUs so seed catalog items do not resurrect
    for sku, row in prev.items():
        if sku in data:
            continue
        if str(row.get("status") or "").lower() == "purged":
            data[sku] = row
    _save_visibility(data)
    return {"ok": True, "count": len(data)}


def set_sku_inventory_status(sku: str, status: str, name: str = "") -> None:
    """Update one SKU in the visibility map (chat status changes)."""
    key = str(sku or "").strip().upper()
    if not key:
        return
    data = _load_visibility()
    prev = data.get(key) or {}
    data[key] = {
        "sku": key,
        "name": str(name or prev.get("name") or "").strip(),
        "status": str(status or "active").strip().lower(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    _save_visibility(data)


def inventory_status_for_sku(sku: str, fallback: str = "active") -> str:
    key = str(sku or "").strip().upper()
    if not key:
        return fallback
    row = _load_visibility().get(key)
    if row:
        return str(row.get("status") or fallback).lower()
    return fallback


def _boutique_seed_rows_for_store(store_id: str) -> list[dict[str, Any]]:
    """Pinterest/KB seed catalog for a shop's category (demo inventory)."""
    try:
        from stores.store_registry import get_store, normalize_category
        from catalog.boutique_catalog import load_image_map, enrich_product
    except ImportError:
        from stores.store_registry import get_store, normalize_category
        from catalog.boutique_catalog import load_image_map, enrich_product

    shop = get_store(store_id)
    if not shop:
        return []
    category = normalize_category(str(shop.get("category") or ""))
    if not category:
        return []

    # Parse KB seed products only (no request-scope filtering)
    kb_path = FAKE_KB_PATH
    if not kb_path.exists():
        return []

    import re

    title_re = re.compile(r"^##\s+(.+)\s*$", re.MULTILINE)
    sku_re = re.compile(r"SKU:\s*([A-Z0-9\-]+)", re.IGNORECASE)
    price_re = re.compile(r"Price:\s*(\$[\d.]+)", re.IGNORECASE)
    cat_re = re.compile(r"Category:\s*([^|]+)", re.IGNORECASE)

    text = kb_path.read_text(encoding="utf-8")
    image_map = load_image_map()
    rows: list[dict[str, Any]] = []
    for part in re.split(r"(?=^## )", text, flags=re.MULTILINE):
        part = part.strip()
        if not part.startswith("## "):
            continue
        title_m = title_re.match(part)
        sku_m = sku_re.search(part)
        if not title_m or not sku_m:
            continue
        cat_m = cat_re.search(part)
        cat = (cat_m.group(1).strip() if cat_m else "")
        if normalize_category(cat) != category:
            continue
        sku = sku_m.group(1).strip()
        status = inventory_status_for_sku(sku, "active")
        if status == "purged":
            continue
        price_m = price_re.search(part)
        desc = ""
        for line in part.splitlines()[1:]:
            line = line.strip().lstrip("- ").strip()
            if line and not line.lower().startswith("category:"):
                desc = re.sub(
                    r"^(Specs|Size|Notes|Care|Use|Features):\s*",
                    "",
                    line,
                    flags=re.I,
                )
                break
        base = {
            "sku": sku,
            "name": title_m.group(1).strip(),
            "category": category,
            "price": price_m.group(1).strip() if price_m else "",
            "description": desc[:200],
            "category_notes": "",
            "quantity": 10,
            "status": status,
            "store_id": store_id,
            "source": "seed",
            "updated_at": "",
            "created_at": "",
        }
        enriched = enrich_product(base, image_map)
        rows.append(
            {
                **base,
                "img": enriched.get("img") or "",
                "url": enriched.get("url") or "",
                "id": sku,
            }
        )
    return rows


def list_seller_products(
    active_only: bool = False,
    store_id: Optional[str] = None,
) -> list[dict[str, Any]]:
    rows = list(_load().values())
    if store_id:
        sid = str(store_id).strip()
        seller_rows = [r for r in rows if str(r.get("store_id") or "").strip() == sid]
        # Merge Pinterest/KB seed items for this shop's category
        by_sku = {
            str(r.get("sku") or "").strip().upper(): dict(r)
            for r in seller_rows
            if r.get("sku")
        }
        for seed in _boutique_seed_rows_for_store(sid):
            key = str(seed.get("sku") or "").strip().upper()
            if not key:
                continue
            if key in by_sku:
                # Seller override (e.g. status→draft) must keep seed photos
                by_sku[key] = _with_image_fallback(by_sku[key], seed)
                continue
            by_sku[key] = seed
        rows = [_with_image_fallback(r) for r in by_sku.values()]

    out: list[dict[str, Any]] = []
    for r in rows:
        sku = str(r.get("sku") or "").strip().upper()
        fallback = str(r.get("status") or "active").lower()
        status = inventory_status_for_sku(sku, fallback)
        if status == "purged":
            continue
        if status == "archive":
            status = "draft"
        row = dict(r)
        row["status"] = status
        out.append(_with_image_fallback(row))
    rows = out

    if active_only:
        rows = [r for r in rows if str(r.get("status") or "active").lower() == "active"]
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
    return _load().get(str(sku or "").strip().upper())


def available_quantity(sku: str, store_id: str = "") -> int:
    """Authoritative on-hand quantity for a SKU (materializes seed default if untouched)."""
    key = str(sku or "").strip().upper()
    if not key:
        return 0
    row = get_seller_product(key)
    if row is not None:
        try:
            return max(0, int(row.get("quantity") or 0))
        except (TypeError, ValueError):
            return 0
    seed = seed_product_as_seller_row(key, store_id)
    if seed is not None:
        try:
            return max(0, int(seed.get("quantity") or 0))
        except (TypeError, ValueError):
            return 0
    return 0


def is_sku_available(sku: str) -> bool:
    """True when a SKU is active AND has stock left (used to hide sold-out from chat)."""
    key = str(sku or "").strip().upper()
    if not key:
        return False
    if inventory_status_for_sku(key, "active") != "active":
        return False
    row = get_seller_product(key)
    if row is None:
        # Untouched seed item — assume in stock (default seed quantity)
        return True
    try:
        return int(row.get("quantity") or 0) > 0
    except (TypeError, ValueError):
        return False


def adjust_seller_stock(sku: str, delta: int, store_id: str = "") -> Optional[dict[str, Any]]:
    """Change on-hand quantity by ``delta`` (negative reserves, positive restores).

    Materializes seed/Pinterest rows into the seller store on first write so stock
    stays authoritative in ``seller_products.json``. Returns the updated row, or
    ``None`` when the SKU is unknown. Raises ValueError when reserving more than
    available stock.
    """
    key = str(sku or "").strip().upper()
    if not key:
        return None
    row = get_seller_product(key)
    if row is None:
        row = seed_product_as_seller_row(key, store_id)
    if row is None:
        return None
    try:
        current = int(row.get("quantity") or 0)
    except (TypeError, ValueError):
        current = 0
    new_qty = current + int(delta)
    if new_qty < 0:
        raise ValueError("insufficient_stock")
    payload = dict(row)
    payload["quantity"] = new_qty
    if store_id and not str(payload.get("store_id") or "").strip():
        payload["store_id"] = str(store_id).strip()
    return upsert_seller_product(payload, tag=False)


def _rewrite_public_image_url(url: str, sku: str = "") -> str:
    """Point product-images URLs at the current API_PUBLIC_URL (LAN-safe)."""
    u = str(url or "").strip()
    if not u:
        return ""
    base = _public_base()
    key = str(sku or "").strip().upper()
    if "/product-images/" in u:
        # Keep path/filename; swap host (fixes 127.0.0.1 saved from earlier upserts)
        filename = u.rsplit("/", 1)[-1]
        if filename:
            return f"{base}/product-images/{filename}"
    if key:
        local_img = PRODUCT_IMAGES_DIR / f"{key}.jpg"
        if local_img.exists() and ("127.0.0.1" in u or "localhost" in u):
            return f"{base}/product-images/{key}.jpg"
    return u


def _with_image_fallback(
    row: dict[str, Any],
    seed: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    """Ensure list/detail rows keep a usable img after status-only upserts."""
    out = dict(row)
    sku = str(out.get("sku") or "").strip().upper()
    img = str(out.get("img") or "").strip()
    url = str(out.get("url") or "").strip()
    base = _public_base()

    def _local_product_image_missing(u: str) -> bool:
        if "/product-images/" not in u:
            return False
        filename = u.rsplit("/", 1)[-1]
        if not filename:
            return True
        return not (PRODUCT_IMAGES_DIR / filename).exists()

    # Broken leftover from chat upserts (URL points at missing static file)
    if img and _local_product_image_missing(img):
        img = ""
    if not img and seed:
        img = str(seed.get("img") or "").strip()
        url = url or str(seed.get("url") or img or "").strip()
    if not img and sku:
        seed_img, seed_url = boutique_image_for_sku(sku)
        img = seed_img
        url = url or seed_url or seed_img
    img = _rewrite_public_image_url(img, sku) if img and "/product-images/" in img else img
    if url and "/product-images/" in url:
        url = _rewrite_public_image_url(url, sku)
    url = url or img

    images: list[str] = []
    raw_images = out.get("images")
    if isinstance(raw_images, list):
        for u in raw_images:
            s = str(u or "").strip()
            if not s:
                continue
            if "/product-images/" in s:
                s = _rewrite_public_image_url(s, sku)
            if s and s not in images:
                images.append(s)
    if sku:
        primary = PRODUCT_IMAGES_DIR / f"{sku}.jpg"
        if primary.exists():
            u = f"{base}/product-images/{sku}.jpg"
            if u not in images:
                images.insert(0, u)
            if not img:
                img = u
        for path in sorted(PRODUCT_IMAGES_DIR.glob(f"{sku}_*.jpg")):
            u = f"{base}/product-images/{path.name}"
            if u not in images:
                images.append(u)
    if img and img not in images:
        images.insert(0, img)
    if not img and images:
        img = images[0]

    out["img"] = img
    out["url"] = url or img
    out["images"] = images
    return out


def boutique_image_for_sku(sku: str) -> tuple[str, str]:
    """Return (img, url) for a Pinterest/KB seed SKU, or ('', '')."""
    key = str(sku or "").strip().upper()
    if not key:
        return "", ""
    base = _public_base()
    local_img = PRODUCT_IMAGES_DIR / f"{key}.jpg"
    # Prefer local static file (works for any LAN IP)
    if local_img.exists():
        img = f"{base}/product-images/{key}.jpg"
        return img, img
    try:
        from catalog.boutique_catalog import load_image_map, enrich_product
    except ImportError:
        from catalog.boutique_catalog import load_image_map, enrich_product
    entry = load_image_map().get(key) or load_image_map().get(sku) or {}
    # Try case-insensitive lookup
    if not entry:
        for k, v in load_image_map().items():
            if str(k).upper() == key:
                entry = v if isinstance(v, dict) else {}
                break
    enriched = enrich_product(
        {"sku": key, "name": key, "category": "", "price": ""},
        {key: entry} if entry else None,
    )
    img = str(enriched.get("img") or "").strip()
    url = str(enriched.get("url") or img or "").strip()
    return img, url


def seed_product_as_seller_row(sku: str, store_id: str = "") -> Optional[dict[str, Any]]:
    """Build a seller-shaped row from boutique KB for status/price updates."""
    key = str(sku or "").strip().upper()
    if not key or not FAKE_KB_PATH.exists():
        return None
    title_re = re.compile(r"^##\s+(.+)\s*$", re.MULTILINE)
    sku_re = re.compile(r"SKU:\s*([A-Z0-9\-]+)", re.IGNORECASE)
    price_re = re.compile(r"Price:\s*(\$[\d.]+)", re.IGNORECASE)
    cat_re = re.compile(r"Category:\s*([^|]+)", re.IGNORECASE)
    text = FAKE_KB_PATH.read_text(encoding="utf-8")
    for part in re.split(r"(?=^## )", text, flags=re.MULTILINE):
        part = part.strip()
        if not part.startswith("## "):
            continue
        sku_m = sku_re.search(part)
        if not sku_m or sku_m.group(1).strip().upper() != key:
            continue
        title_m = title_re.match(part)
        cat_m = cat_re.search(part)
        price_m = price_re.search(part)
        desc = ""
        for line in part.splitlines()[1:]:
            line = line.strip().lstrip("- ").strip()
            if line and not line.lower().startswith("category:"):
                desc = re.sub(
                    r"^(Specs|Size|Notes|Care|Use|Features):\s*",
                    "",
                    line,
                    flags=re.I,
                )
                break
        try:
            from stores.store_registry import normalize_category
        except ImportError:
            from stores.store_registry import normalize_category
        img, url = boutique_image_for_sku(key)
        return {
            "sku": key,
            "name": title_m.group(1).strip() if title_m else key,
            "category": normalize_category(cat_m.group(1).strip() if cat_m else "Handicrafts"),
            "price": price_m.group(1).strip() if price_m else "",
            "description": desc[:200],
            "category_notes": "",
            "quantity": 10,
            "status": inventory_status_for_sku(key, "active"),
            "img": img,
            "url": url or img,
            "source": "seed",
            "store_id": str(store_id or "").strip(),
            "tags": [],
        }
    return None


def upsert_seller_product(payload: dict[str, Any], *, tag: bool = True, force_retag: bool = False) -> dict[str, Any]:
    """Create/update a seller product. Optional image_base64 / images_base64 save to static/products."""
    sku = str(payload.get("sku") or "").strip().upper()
    if not sku:
        raise ValueError("sku is required")
    name = str(payload.get("name") or "").strip()
    if not name:
        raise ValueError("name is required")

    data = _load()
    existing = data.get(sku) or {}

    image_b64 = payload.get("image_base64")
    images_b64_raw = payload.get("images_base64")
    images_b64: list[str] = []
    if isinstance(images_b64_raw, list):
        images_b64 = [str(x) for x in images_b64_raw if str(x or "").strip()][:8]
    if image_b64 and str(image_b64).strip() and not images_b64:
        images_b64 = [str(image_b64)]
    elif image_b64 and str(image_b64).strip() and images_b64:
        # Ensure primary is first if both sent
        primary = str(image_b64)
        if primary not in images_b64:
            images_b64 = [primary, *images_b64][:8]

    image_changed = False
    saved_image_urls: list[str] = []
    base = _public_base()
    if images_b64:
        PRODUCT_IMAGES_DIR.mkdir(parents=True, exist_ok=True)
        for i, b64 in enumerate(images_b64):
            raw = re.sub(r"^data:image/[^;]+;base64,", "", str(b64))
            filename = f"{sku}.jpg" if i == 0 else f"{sku}_{i}.jpg"
            dest = PRODUCT_IMAGES_DIR / filename
            try:
                dest.write_bytes(base64.b64decode(raw))
                saved_image_urls.append(f"{base}/product-images/{filename}")
                image_changed = True
            except Exception:
                continue

    local_img = PRODUCT_IMAGES_DIR / f"{sku}.jpg"
    img = (
        str(payload.get("image_url") or "").strip()
        or (saved_image_urls[0] if saved_image_urls else "")
        or str(existing.get("img") or "").strip()
        or (f"{base}/product-images/{sku}.jpg" if local_img.exists() else "")
    )
    if local_img.exists() and (image_changed or not img):
        img = f"{base}/product-images/{sku}.jpg"
    # Keep Pinterest/seed photos when chat only changes status/fields
    if not img or (
        "/product-images/" in img
        and not (PRODUCT_IMAGES_DIR / img.rsplit("/", 1)[-1]).exists()
    ):
        seed_img, seed_url = boutique_image_for_sku(sku)
        if seed_img:
            img = seed_img
        if seed_url and not str(payload.get("url") or existing.get("url") or "").strip():
            payload = {**payload, "url": seed_url}
    elif "/product-images/" in img:
        img = _rewrite_public_image_url(img, sku)

    # Build images gallery list
    images: list[str] = []
    if saved_image_urls:
        images = saved_image_urls
    elif isinstance(existing.get("images"), list) and existing.get("images"):
        images = [str(u) for u in existing["images"] if str(u or "").strip()]
    images = [_rewrite_public_image_url(u, sku) if "/product-images/" in u else u for u in images]
    if img and img not in images:
        images = [img, *images]
    # Discover local extras sku_1.jpg …
    for path in sorted(PRODUCT_IMAGES_DIR.glob(f"{sku}_*.jpg")):
        u = f"{base}/product-images/{path.name}"
        if u not in images:
            images.append(u)
    if not images and img:
        images = [img]

    url = (
        str(payload.get("url") or "").strip()
        or str(existing.get("url") or "").strip()
        or img
        or f"{base}/product-images/{sku}.jpg"
    )
    if url and "/product-images/" in url:
        url = _rewrite_public_image_url(url, sku)

    now = datetime.now(timezone.utc).isoformat()
    store_id = str(payload.get("store_id") or existing.get("store_id") or "").strip()
    row = {
        "sku": sku,
        "name": name,
        "category": str(payload.get("category") or existing.get("category") or "Handicrafts").strip(),
        "price": str(payload.get("price") if payload.get("price") is not None else existing.get("price") or "").strip(),
        "description": str(
            payload.get("description")
            if payload.get("description") is not None
            else existing.get("description")
            or ""
        ).strip(),
        "category_notes": str(
            payload.get("category_notes")
            if payload.get("category_notes") is not None
            else existing.get("category_notes")
            or ""
        ).strip(),
        "quantity": int(
            payload.get("quantity")
            if payload.get("quantity") is not None
            else existing.get("quantity")
            or 0
        ),
        "status": str(payload.get("status") or existing.get("status") or "active").strip().lower(),
        "img": img or (images[0] if images else ""),
        "images": images,
        "url": url,
        "source": existing.get("source") or payload.get("source") or "seller",
        "store_id": store_id,
        "tags": list(existing.get("tags") or []),
        "updated_at": now,
        "created_at": existing.get("created_at") or payload.get("created_at") or now,
    }
    price_in_payload = "price" in payload
    list_price_in_payload = "list_price" in payload
    price_changed = price_in_payload and _price_amount(row.get("price")) != _price_amount(
        existing.get("price")
    )

    if payload.get("clear_discount"):
        row.pop("list_price", None)
    elif list_price_in_payload:
        lp = str(payload.get("list_price") or "").strip()
        if lp:
            row["list_price"] = lp
        else:
            row.pop("list_price", None)
    elif price_changed:
        # Manual price edits clear promo unless list_price is supplied with the new price.
        row.pop("list_price", None)
    elif existing.get("list_price"):
        row["list_price"] = str(existing.get("list_price") or "").strip()

    payload_tags = payload.get("tags")
    if isinstance(payload_tags, list) and payload_tags:
        row["tags"] = [str(t).strip().lower() for t in payload_tags if str(t).strip()]

    if tag:
        should_tag = force_retag or image_changed or not row.get("tags") or not row.get("domain")
        if should_tag:
            try:
                try:
                    from catalog.product_tagger import ensure_tags, heuristic_meta
                except ImportError:
                    from catalog.product_tagger import ensure_tags, heuristic_meta
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
    # list_seller_products prefers visibility over row.status — keep them aligned
    try:
        st = str(row.get("status") or "active").strip().lower()
        if st == "archive":
            st = "draft"
        if st != "purged":
            set_sku_inventory_status(sku, st, name=str(row.get("name") or ""))
    except Exception as e:
        logger.warning("Visibility sync failed for %s: %s", sku, e)
    return row


def delete_seller_product(sku: str) -> bool:
    data = _load()
    key = str(sku or "").strip().upper()
    if key not in data:
        return False
    del data[key]
    _save(data)
    return True


def soft_delete_seller_product(sku: str, store_id: str = "") -> Optional[dict[str, Any]]:
    """Move a listing to trash (keep row + image). Seeds hydrate if needed."""
    key = str(sku or "").strip().upper()
    if not key:
        return None
    row = get_seller_product(key) or seed_product_as_seller_row(key, store_id)
    if not row:
        set_sku_inventory_status(key, "trash")
        return {"sku": key, "status": "trash", "source": "visibility"}
    payload = dict(row)
    if store_id:
        payload["store_id"] = str(store_id).strip()
    payload["status"] = "trash"
    updated = upsert_seller_product(payload, tag=False)
    set_sku_inventory_status(key, "trash", name=str(updated.get("name") or ""))
    return updated


def purge_seller_product(sku: str) -> dict[str, Any]:
    """Permanently remove a product: seller row, local image, and hide seeds forever."""
    key = str(sku or "").strip().upper()
    if not key:
        return {"ok": False, "error": "sku required"}
    deleted_row = delete_seller_product(key)
    img_path = PRODUCT_IMAGES_DIR / f"{key}.jpg"
    deleted_image = False
    if img_path.exists():
        try:
            img_path.unlink()
            deleted_image = True
        except OSError as e:
            logger.warning("Could not delete image for %s: %s", key, e)
    # Also clear common alternate extensions
    for ext in (".jpeg", ".png", ".webp"):
        alt = PRODUCT_IMAGES_DIR / f"{key}{ext}"
        if alt.exists():
            try:
                alt.unlink()
                deleted_image = True
            except OSError:
                pass
    set_sku_inventory_status(key, "purged")
    return {
        "ok": True,
        "sku": key,
        "deleted_row": deleted_row,
        "deleted_image": deleted_image,
        "status": "purged",
    }


def retag_all_seller_products(force: bool = False) -> dict[str, Any]:
    data = _load()
    updated = 0
    for sku, row in list(data.items()):
        if not force and isinstance(row.get("tags"), list) and row["tags"] and row.get("domain"):
            continue
        try:
            try:
                from catalog.product_tagger import ensure_tags
            except ImportError:
                from catalog.product_tagger import ensure_tags
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
                "list_price": r.get("list_price") or "",
                "category": r.get("category") or "",
                "description": (r.get("description") or "")[:160],
                "kb_excerpt": seller_to_kb_chunk(r)[:1200],
                "img": r.get("img") or "",
                "images": list(r.get("images") or ([r.get("img")] if r.get("img") else [])),
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
