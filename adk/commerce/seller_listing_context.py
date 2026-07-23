"""In-progress seller listing draft per chat session (form + chat listing)."""

from __future__ import annotations

import json
import re
from typing import Any, Optional

try:
    from stores.store_scope import get_current_session_id
except ImportError:
    from stores.store_scope import get_current_session_id

session_pending_listing: dict[str, dict[str, Any]] = {}

LISTING_DRAFT_RE = re.compile(r"<LISTING_DRAFT>([\s\S]*?)</LISTING_DRAFT>", re.I)

_LISTING_FIELDS = ("name", "price", "quantity", "category", "description", "sku", "status")


def _session_key(session_id: str = "") -> str:
    sid = str(session_id or get_current_session_id() or "").strip()
    return sid


def _clean_str(val: Any) -> str:
    return str(val or "").strip()


def _normalize_draft(raw: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {"in_progress": True}
    for key in _LISTING_FIELDS:
        if key in raw and raw[key] is not None:
            v = _clean_str(raw[key])
            if v:
                out[key] = v
    if raw.get("has_photo") is True or raw.get("hasPhoto") is True:
        out["has_photo"] = True
    if raw.get("source"):
        out["source"] = _clean_str(raw["source"])
    if out.get("sku"):
        out["sku"] = out["sku"].upper()
    # Drop empty in_progress-only shells
    if len(out) <= 1 and not out.get("name"):
        return {}
    return out


def get_pending_listing(session_id: str = "") -> dict[str, Any]:
    sid = _session_key(session_id)
    if not sid:
        return {}
    return dict(session_pending_listing.get(sid) or {})


def set_pending_listing(session_id: str, draft: dict[str, Any]) -> dict[str, Any]:
    sid = _session_key(session_id)
    if not sid:
        return {}
    cleaned = _normalize_draft(draft)
    if not cleaned:
        session_pending_listing.pop(sid, None)
        return {}
    session_pending_listing[sid] = cleaned
    return dict(cleaned)


def merge_pending_listing(session_id: str, patch: dict[str, Any]) -> dict[str, Any]:
    sid = _session_key(session_id)
    if not sid:
        return {}
    current = dict(session_pending_listing.get(sid) or {})
    for key, val in patch.items():
        if val is None:
            continue
        if key in _LISTING_FIELDS:
            s = _clean_str(val)
            if s:
                current[key] = s.upper() if key == "sku" else s
        elif key in ("has_photo", "hasPhoto") and val:
            current["has_photo"] = True
        elif key == "source" and _clean_str(val):
            current["source"] = _clean_str(val)
        elif key == "in_progress":
            current["in_progress"] = bool(val)
    current["in_progress"] = True
    return set_pending_listing(sid, current)


def clear_pending_listing(session_id: str = "") -> None:
    sid = _session_key(session_id)
    if sid:
        session_pending_listing.pop(sid, None)


def ingest_client_listing_context(session_id: str, ctx: Optional[dict[str, Any]]) -> dict[str, Any]:
    """Merge listing draft sent from the mobile form (authoritative when present)."""
    if not session_id or not ctx:
        return get_pending_listing(session_id)
    if not ctx.get("in_progress") and not any(ctx.get(k) for k in _LISTING_FIELDS):
        return get_pending_listing(session_id)
    patch = {
        "name": ctx.get("name"),
        "price": ctx.get("price"),
        "quantity": ctx.get("quantity"),
        "category": ctx.get("category"),
        "description": ctx.get("description"),
        "sku": ctx.get("sku"),
        "has_photo": ctx.get("has_photo") or ctx.get("hasPhoto"),
        "source": ctx.get("source") or "form",
        "in_progress": True,
    }
    return merge_pending_listing(session_id, patch)


def listing_draft_block(draft: dict[str, Any]) -> str:
    payload = {k: draft[k] for k in sorted(draft.keys()) if draft.get(k) not in (None, "", [])}
    return "<LISTING_DRAFT>" + json.dumps(payload, ensure_ascii=False) + "</LISTING_DRAFT>"


def extract_listing_draft(text: str) -> tuple[str, Optional[dict[str, Any]]]:
    """Strip LISTING_DRAFT markup and return cleaned text + parsed draft."""
    if not text:
        return text, None
    m = LISTING_DRAFT_RE.search(text)
    if not m:
        return text, None
    draft = None
    try:
        parsed = json.loads(m.group(1).strip())
        if isinstance(parsed, dict):
            draft = _normalize_draft(parsed)
    except Exception:
        draft = None
    cleaned = LISTING_DRAFT_RE.sub("", text).strip()
    return cleaned, draft


def listing_context_line(session_id: str = "") -> str:
    draft = get_pending_listing(session_id)
    if not draft or not draft.get("in_progress"):
        return ""
    parts = []
    for key in ("name", "price", "quantity", "category", "description", "sku", "status"):
        if draft.get(key):
            parts.append(f"{key}={draft[key]}")
    if draft.get("has_photo"):
        parts.append("has_photo=true")
    if not parts:
        return (
            " LISTING IN PROGRESS: seller has an open add-product form (no fields filled yet). "
            "Short field-only messages (price/qty/name) refer to THIS listing."
        )
    return (
        " LISTING IN PROGRESS (seller is adding/editing ONE item — prefer this over catalog edits): "
        + ", ".join(parts)
        + ". Pronouns like it/its/this/that + price/qty/name tweaks → apply_listing_changes. "
        "Do NOT call find_items_for_edit unless they clearly switch to a different existing SKU."
    )


def missing_required_fields(draft: dict[str, Any], store_category: str = "") -> list[str]:
    missing: list[str] = []
    if not _clean_str(draft.get("name")):
        missing.append("name")
    if not _clean_str(draft.get("price")):
        missing.append("price")
    qty = _clean_str(draft.get("quantity"))
    if qty == "":
        missing.append("quantity")
    cat = _clean_str(draft.get("category")) or _clean_str(store_category)
    if not cat:
        missing.append("category")
    return missing


def sync_draft_to_catalog(
    draft: dict[str, Any],
    store_id: str,
    session_id: str = "",
) -> dict[str, Any]:
    """Persist in-progress listing to catalog as status=draft (never active)."""
    name = _clean_str(draft.get("name"))
    if not name:
        return draft
    try:
        from catalog.seller_catalog import get_seller_product, upsert_seller_product
        from stores.store_registry import get_store, normalize_category
    except ImportError:
        from catalog.seller_catalog import get_seller_product, upsert_seller_product
        from stores.store_registry import get_store, normalize_category

    shop = get_store(store_id) or {}
    store_cat = str(shop.get("category") or "")
    cat = normalize_category(str(draft.get("category") or store_cat))
    sku = _clean_str(draft.get("sku")).upper()
    if sku:
        row = get_seller_product(sku)
        if row and str(row.get("store_id") or "") not in ("", store_id):
            sku = ""

    qty = 0
    qty_raw = _clean_str(draft.get("quantity"))
    if qty_raw:
        try:
            qty = int(float(re.sub(r"[^\d.]", "", qty_raw) or "0"))
        except Exception:
            qty = 0

    payload: dict[str, Any] = {
        "name": name,
        "category": cat,
        "quantity": qty,
        "description": _clean_str(draft.get("description")),
        "status": "draft",
        "store_id": store_id,
    }
    price = _clean_str(draft.get("price"))
    if price:
        payload["price"] = price if price.startswith("$") else f"${price.lstrip('$')}"

    if sku:
        payload["sku"] = sku
    else:
        try:
            from tools.seller_agent_tools import _next_sku
        except ImportError:
            from tools.seller_agent_tools import _next_sku
        payload["sku"] = _next_sku(cat)

    img = ""
    sess = _session_key(session_id)
    if sess and draft.get("has_photo"):
        try:
            from media.chat_image_stash import load_pending_chat_image_b64
        except ImportError:
            from media.chat_image_stash import load_pending_chat_image_b64
        try:
            img = load_pending_chat_image_b64(sess) or ""
        except Exception:
            img = ""
    if img:
        payload["image_base64"] = img

    try:
        row = upsert_seller_product(payload, tag=bool(img), force_retag=bool(img))
    except Exception:
        return draft

    merged = dict(draft)
    merged["sku"] = str(row.get("sku") or payload["sku"]).upper()
    merged["status"] = "draft"
    if row.get("price") is not None:
        merged["price"] = str(row.get("price"))
    if row.get("quantity") is not None:
        merged["quantity"] = str(row.get("quantity"))
    if sess:
        session_pending_listing[sess] = {**merged, "in_progress": True}
    return merged
