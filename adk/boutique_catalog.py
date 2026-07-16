"""Parse boutique KB products and attach Pinterest-sourced image links."""

from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any, Optional

ADK_DIR = Path(__file__).resolve().parent
KB_PATH = ADK_DIR / "fake_kb.md"
IMAGES_JSON = ADK_DIR / "boutique_product_images.json"
PRODUCT_IMAGES_DIR = ADK_DIR / "static" / "products"

_TITLE_RE = re.compile(r"^##\s+(.+)\s*$", re.MULTILINE)
_SKU_RE = re.compile(r"SKU:\s*([A-Z0-9\-]+)", re.IGNORECASE)
_PRICE_RE = re.compile(r"Price:\s*(\$[\d.]+)", re.IGNORECASE)
_CAT_RE = re.compile(r"Category:\s*([^|]+)", re.IGNORECASE)


def _public_base() -> str:
    return (os.getenv("API_PUBLIC_URL") or os.getenv("EXPO_PUBLIC_API_URL") or "http://127.0.0.1:8000").rstrip("/")


def parse_kb_products(kb_path: Path = KB_PATH) -> list[dict[str, Any]]:
    """Return structured products from fake_kb.md plus live seller-listed items."""
    products: list[dict[str, Any]] = []
    if kb_path.exists():
        text = kb_path.read_text(encoding="utf-8")
        parts = re.split(r"(?=^## )", text, flags=re.MULTILINE)
        for part in parts:
            part = part.strip()
            if not part.startswith("## "):
                continue
            title_m = _TITLE_RE.match(part)
            if not title_m:
                continue
            name = title_m.group(1).strip()
            sku_m = _SKU_RE.search(part)
            price_m = _PRICE_RE.search(part)
            cat_m = _CAT_RE.search(part)
            if not sku_m:
                continue
            sku = sku_m.group(1).strip()
            desc = ""
            for line in part.splitlines()[1:]:
                line = line.strip().lstrip("- ").strip()
                if line and not line.lower().startswith("category:"):
                    desc = re.sub(r"^(Specs|Size|Notes|Care|Use|Features):\s*", "", line, flags=re.I)
                    break
            products.append(
                {
                    "id": sku,
                    "sku": sku,
                    "name": name,
                    "price": price_m.group(1).strip() if price_m else "",
                    "category": cat_m.group(1).strip() if cat_m else "",
                    "description": desc[:160],
                    "kb_excerpt": part[:1200],
                }
            )

    # Seller listings override seed products with the same SKU
    try:
        try:
            from .seller_catalog import seller_as_catalog_products
        except ImportError:
            from seller_catalog import seller_as_catalog_products

        by_sku = {p["sku"].upper(): i for i, p in enumerate(products)}
        for sp in seller_as_catalog_products(active_only=True):
            key = sp["sku"].upper()
            if key in by_sku:
                products[by_sku[key]] = sp
            else:
                by_sku[key] = len(products)
                products.append(sp)
    except Exception:
        pass

    return products


def load_image_map(path: Path = IMAGES_JSON) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def enrich_product(product: dict[str, Any], image_map: Optional[dict] = None) -> dict[str, Any]:
    """Attach img (API or CDN) + redirectable url (Pinterest pin / source)."""
    image_map = image_map if image_map is not None else load_image_map()
    sku = product["sku"]
    entry = image_map.get(sku) or {}
    base = _public_base()
    local_file = PRODUCT_IMAGES_DIR / f"{sku}.jpg"
    if product.get("img"):
        img = str(product["img"])
    elif local_file.exists():
        img = f"{base}/product-images/{sku}.jpg"
    else:
        img = entry.get("img") or entry.get("image_url") or ""
    url = (
        product.get("url")
        or entry.get("url")
        or entry.get("source_page")
        or entry.get("pin")
        or entry.get("external_link")
        or img
        or f"{base}/docs"
    )
    features: list[str] = []
    if product.get("category"):
        features.append(str(product["category"]))
    if product.get("price"):
        features.append(str(product["price"]))
    return {
        **product,
        # tile-* prefix → Expo opens product.url in browser (Pinterest source)
        "id": f"tile-{sku}",
        "img": img,
        "url": url,
        "features": features[:2],
        "tag": product.get("category") or "",
    }


def products_with_images() -> list[dict[str, Any]]:
    image_map = load_image_map()
    return [enrich_product(p, image_map) for p in parse_kb_products()]


def tile_for_sku(sku: str) -> Optional[dict[str, Any]]:
    for p in products_with_images():
        if p["sku"].upper() == sku.upper():
            return {
                "id": p["id"],
                "name": p["name"],
                "price": p["price"],
                "category": p.get("category"),
                "description": p.get("description"),
                "features": p.get("features"),
                "tag": p.get("tag"),
                "url": p["url"],
                "img": p["img"],
            }
    return None


def format_tiles_block(tiles: list[dict[str, Any]]) -> str:
    payload = []
    for t in tiles:
        payload.append(
            {
                "id": t.get("id"),
                "name": t.get("name"),
                "price": t.get("price") or "",
                "category": t.get("category") or "",
                "description": t.get("description") or "",
                "features": t.get("features") or [],
                "tag": t.get("tag") or "",
                "url": t.get("url") or "",
                "img": t.get("img") or "",
            }
        )
    return f"<TILES>{json.dumps(payload, ensure_ascii=False)}</TILES>"
