"""Per-request scope: shop id (buyer/seller) and/or category vertical."""

from __future__ import annotations

import re
from contextvars import ContextVar
from typing import Any, Optional

# Category vertical: skincare | handicrafts | apparels
_current_store: ContextVar[Optional[str]] = ContextVar("current_store", default=None)
# Specific shop id from store_registry
_current_store_id: ContextVar[Optional[str]] = ContextVar("current_store_id", default=None)
# buyer | seller
_current_role: ContextVar[Optional[str]] = ContextVar("current_role", default=None)
# chat session id for this request
_current_session_id: ContextVar[Optional[str]] = ContextVar("current_session_id", default=None)

# Fallback when ContextVar is lost across ADK tool threads
_SESSION_SCOPE: dict[str, dict[str, Any]] = {}

STORE_ALIASES = {
    "skincare": "skincare",
    "skin": "skincare",
    "handicrafts": "handicrafts",
    "handicraft": "handicrafts",
    "craft": "handicrafts",
    "apparels": "apparels",
    "apparel": "apparels",
    "clothing": "apparels",
}

STORE_CATALOG: dict[str, dict[str, Any]] = {
    "skincare": {
        "label": "Skincare",
        "category": "Skincare",
        "domains": frozenset({"skincare"}),
        "sku_prefixes": ("SK-",),
    },
    "handicrafts": {
        "label": "Handicrafts",
        "category": "Handicrafts",
        "domains": frozenset({"handicrafts", "jewellery", "home"}),
        "sku_prefixes": ("HC-",),
    },
    "apparels": {
        "label": "Apparels",
        "category": "Apparel",
        "domains": frozenset({"apparel"}),
        "sku_prefixes": ("AP-",),
    },
}

# Demo shops inherit seed catalog for their category until sellers add products
DEMO_STORE_CATEGORY = {
    "store_glow_lab": "skincare",
    "store_atelier_craft": "handicrafts",
    "store_thread_co": "apparels",
}


def normalize_store(raw: Optional[str]) -> Optional[str]:
    if not raw:
        return None
    key = str(raw).strip().lower()
    return STORE_ALIASES.get(key) or (key if key in STORE_CATALOG else None)


def set_request_scope(
    *,
    store: Optional[str] = None,
    store_id: Optional[str] = None,
    role: Optional[str] = None,
    session_id: Optional[str] = None,
) -> None:
    """Set category tag, shop id, and role for this request."""
    sid = str(store_id).strip() if store_id else None
    _current_store_id.set(sid or None)

    cat = normalize_store(store)
    if not cat and sid:
        # Infer category from registry shop
        try:
            try:
                from .store_registry import get_store, normalize_category
            except ImportError:
                from store_registry import get_store, normalize_category
            shop = get_store(sid)
            if shop:
                cat_label = normalize_category(str(shop.get("category") or ""))
                cat = normalize_store(cat_label) or DEMO_STORE_CATEGORY.get(sid)
        except Exception:
            cat = DEMO_STORE_CATEGORY.get(sid)
    _current_store.set(cat)

    r = str(role or "").strip().lower() or None
    if r not in ("buyer", "seller"):
        r = None
    _current_role.set(r)

    sess = str(session_id or "").strip() or None
    _current_session_id.set(sess)
    if sess:
        _SESSION_SCOPE[sess] = {
            "store_id": sid,
            "store": cat,
            "role": r,
        }


def get_current_session_id() -> Optional[str]:
    return _current_session_id.get()


def scope_for_session(session_id: Optional[str]) -> dict[str, Any]:
    if not session_id:
        return {}
    return dict(_SESSION_SCOPE.get(str(session_id).strip()) or {})


def resolve_store_id(explicit: str = "", session_id: str = "") -> Optional[str]:
    """Best-effort store_id from arg → contextvar → session map."""
    if explicit and str(explicit).strip():
        return str(explicit).strip()
    cur = get_current_store_id()
    if cur:
        return cur
    mapped = scope_for_session(session_id or get_current_session_id()).get("store_id")
    return str(mapped).strip() if mapped else None


def set_current_store(store: Optional[str]) -> None:
    """Back-compat: category-only scope."""
    set_request_scope(store=store)


def get_current_store() -> Optional[str]:
    return _current_store.get()


def get_current_store_id() -> Optional[str]:
    return _current_store_id.get()


def get_current_role() -> Optional[str]:
    return _current_role.get()


def store_meta(store: Optional[str] = None) -> Optional[dict[str, Any]]:
    key = normalize_store(store) if store is not None else get_current_store()
    if not key:
        return None
    return STORE_CATALOG.get(key)


def _infer_domain(chunk: str) -> str:
    c = (chunk or "").lower()
    m = re.search(r"domain:\s*([a-z]+)", c)
    if m:
        d = m.group(1)
        return "jewellery" if d in ("jewelry", "jewelery") else d
    if "category: apparel" in c:
        return "apparel"
    if "category: skincare" in c:
        return "skincare"
    if "category: handicrafts" in c:
        return "handicrafts"
    title = c.splitlines()[0] if c else ""
    if any(k in title for k in ("earring", "bracelet", "necklace", "ring", "bead")):
        return "jewellery"
    if any(k in title for k in ("shirt", "chino", "tee", "hoodie", "jacket", "short", "pant")):
        return "apparel"
    if any(k in c for k in ("serum", "moisturizer", "cleanser", "toner")):
        return "skincare"
    return "other"


def chunk_matches_store(chunk: str, store: Optional[str] = None) -> bool:
    """Category-level filter (legacy vertical)."""
    meta = store_meta(store)
    if not meta:
        return True
    c = (chunk or "").lower()
    cat = str(meta["category"]).lower()
    if f"category: {cat}" in c:
        return True
    for d in meta["domains"]:
        if f"domain: {d}" in c:
            return True
    for prefix in meta["sku_prefixes"]:
        if re.search(rf"sku:\s*{re.escape(prefix)}", c, re.I):
            return True
    domain = _infer_domain(chunk)
    if domain in meta["domains"]:
        return True
    if meta["label"] == "Handicrafts":
        if "category: apparel" in c or "category: skincare" in c:
            return False
        if domain in ("jewellery", "handicrafts", "home"):
            return True
    return False


def product_matches_store(product: dict[str, Any], store: Optional[str] = None) -> bool:
    store_id = get_current_store_id()
    if store_id:
        pid = str(product.get("store_id") or "").strip()
        if pid:
            return pid == store_id
        # Seed / unscoped products: only allow for demo shops matching category
        demo_cat = DEMO_STORE_CATEGORY.get(store_id)
        if demo_cat:
            return product_matches_category(product, demo_cat)
        return False

    meta = store_meta(store)
    if not meta:
        return True
    return product_matches_category(product, normalize_store(store) or get_current_store())


def product_matches_category(product: dict[str, Any], store_key: Optional[str]) -> bool:
    meta = store_meta(store_key)
    if not meta:
        return True
    cat = str(product.get("category") or "").strip().lower()
    if cat == str(meta["category"]).lower():
        return True
    domain = str(product.get("domain") or "").lower()
    if domain in ("jewelry", "jewelery"):
        domain = "jewellery"
    if domain and domain in meta["domains"]:
        return True
    sku = str(product.get("sku") or product.get("id") or "").upper()
    for prefix in meta["sku_prefixes"]:
        if sku.startswith(prefix):
            return True
    return False


def chunk_matches_shop(chunk: str) -> bool:
    """When a shop id is active, prefer store_id markers; else category."""
    store_id = get_current_store_id()
    if not store_id:
        return chunk_matches_store(chunk)
    c = (chunk or "").lower()
    if f"store_id: {store_id.lower()}" in c or f"store: {store_id.lower()}" in c:
        return True
    # Seller chunks without store_id line — check via SKU lookup
    sku_m = re.search(r"sku:\s*([a-z0-9\-]+)", c, re.I)
    if sku_m:
        try:
            try:
                from .seller_catalog import get_seller_product
            except ImportError:
                from seller_catalog import get_seller_product
            row = get_seller_product(sku_m.group(1))
            if row:
                return product_matches_store(row)
        except Exception:
            pass
    # Demo shops may use seed category catalog
    if store_id in DEMO_STORE_CATEGORY:
        return chunk_matches_store(chunk, DEMO_STORE_CATEGORY[store_id])
    # Non-demo shop with no matching seller product → hide seed
    return False
