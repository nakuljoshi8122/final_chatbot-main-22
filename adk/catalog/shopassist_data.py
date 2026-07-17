from __future__ import annotations

from paths import ENV_FILE, DATA_DIR, STATIC_DIR, PRODUCT_IMAGES_DIR, PENDING_CHAT_IMAGES_DIR, FAKE_KB_PATH, SELLER_PRODUCTS_JSON, INVENTORY_VISIBILITY_JSON, STORES_JSON, STORE_QUERIES_DIR, PRODUCT_IMAGES_JSON, BOUTIQUE_PRODUCT_IMAGES_JSON

import copy
import os
from pathlib import Path

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv(ENV_FILE, override=True)

try:
    from catalog.shopassist_catalog import build_marketplace_document, flatten_catalog
    from catalog.product_images import resolve_image_url
except ImportError:
    from catalog.shopassist_catalog import build_marketplace_document, flatten_catalog
    from catalog.product_images import resolve_image_url

client = MongoClient("mongodb://127.0.0.1:27017/?directConnection=true")
db = client.shopassist_marketplace_db
marketplace = db.marketplace


def _enrich_catalog_images(catalog: dict) -> None:
    """Attach img URL to every product in the nested catalog."""
    footwear = catalog.get("footwear", {})
    for items in footwear.values():
        for p in items:
            p["img"] = resolve_image_url(p)
    clothing = catalog.get("clothing", {})
    for items in clothing.values():
        for p in items:
            p["img"] = resolve_image_url(p)
    for p in catalog.get("sports_equipment", []):
        p["img"] = resolve_image_url(p)
    for p in catalog.get("bundles", []):
        p["img"] = resolve_image_url(p)


def build_marketplace_with_images() -> dict:
    doc = copy.deepcopy(build_marketplace_document())
    _enrich_catalog_images(doc["catalog"])
    return doc


def get_marketplace(brand: str = "ShopAssist") -> dict:
    """Fetch marketplace from MongoDB, or build in-memory if empty."""
    doc = marketplace.find_one({"brand.name": brand})
    if not doc:
        return build_marketplace_with_images()

    if "_id" in doc:
        doc["_id"] = str(doc["_id"])
    return doc


def all_products() -> list[dict]:
    """All products — source of truth is MongoDB catalog (includes img)."""
    return flatten_catalog(get_marketplace())


def seed_marketplace(brand: str = "ShopAssist") -> int:
    """Upsert catalog + image URLs into MongoDB. Run once after deploy."""
    doc = build_marketplace_with_images()
    marketplace.replace_one({"brand.name": brand}, doc, upsert=True)
    return len(flatten_catalog(doc))


def search_products(
    query: str = "",
    category: str = "",
    audience: str = "",
    sport: str = "",
    max_results: int = 8,
) -> list[dict]:
    products = all_products()
    query_lower = query.lower().strip()
    category_lower = category.lower().strip()
    audience_lower = audience.lower().strip()
    sport_lower = sport.lower().strip()

    matches = []
    for product in products:
        if category_lower and product.get("category", "").lower() != category_lower:
            continue
        if audience_lower and product.get("audience", "").lower() not in (audience_lower, "unisex"):
            continue
        if sport_lower and sport_lower not in str(product.get("sport", "")).lower() and sport_lower not in " ".join(product.get("tags", [])).lower():
            continue

        if query_lower:
            haystack = " ".join(
                [
                    product.get("name", ""),
                    product.get("category", ""),
                    product.get("audience", ""),
                    product.get("sport", ""),
                    product.get("type", ""),
                    " ".join(product.get("tags", [])),
                    " ".join(product.get("features", [])),
                ]
            ).lower()
            if query_lower not in haystack:
                continue

        matches.append(product)

    return matches[:max_results]


def get_similar_products(product_id: str = "", product_name: str = "", max_results: int = 3) -> list[dict]:
    products = all_products()
    by_id = {p["id"]: p for p in products}

    target = None
    if product_id:
        target = by_id.get(product_id)
    elif product_name:
        name_lower = product_name.lower()
        for p in products:
            if name_lower in p["name"].lower() or p["name"].lower() in name_lower:
                target = p
                break

    if not target:
        return []

    similar_ids = target.get("similar_ids", [])
    similar = [by_id[sid] for sid in similar_ids if sid in by_id]

    if len(similar) < max_results:
        for p in products:
            if p["id"] == target["id"]:
                continue
            if p.get("category") == target.get("category") and p.get("audience") == target.get("audience"):
                if p not in similar:
                    similar.append(p)
            if len(similar) >= max_results:
                break

    return similar[:max_results]


def get_all_catalog_tags() -> set[str]:
    """
    Returns a flat set of every tag string that exists across all products
    in the catalog. Used to check if a user-mentioned item has any tag overlap
    with our inventory before deciding whether to upsell.
    """
    tags: set[str] = set()
    for product in all_products():
        for tag in product.get("tags", []):
            tags.add(tag.lower().strip())
    return tags


def find_products_by_tag_overlap(user_tags: list[str], max_results: int = 3) -> list[dict]:
    """
    Given a list of tags extracted from what the user mentioned (could be
    a product not in our catalog — e.g. a Nike shoe, a Puma shirt, anything),
    find our catalog products that share the most tags with that list.

    Returns an empty list if ZERO tags overlap with the catalog at all
    (e.g. user mentions 'baby food', 'furniture', 'laptop' — nothing to upsell).

    Returns top max_results products ranked by number of overlapping tags (descending).
    """
    if not user_tags:
        return []

    catalog_tags = get_all_catalog_tags()
    user_tags_lower = {t.lower().strip() for t in user_tags}

    overlap_exists = user_tags_lower & catalog_tags
    if not overlap_exists:
        return []

    scored: list[tuple[int, dict]] = []
    for product in all_products():
        product_tags = {t.lower().strip() for t in product.get("tags", [])}
        shared_count = len(product_tags & user_tags_lower)
        if shared_count > 0:
            scored.append((shared_count, product))

    scored.sort(key=lambda x: (-x[0], x[1].get("id", "")))
    return [product for _, product in scored[:max_results]]


__all__ = [
    "get_marketplace",
    "all_products",
    "seed_marketplace",
    "search_products",
    "get_similar_products",
    "get_all_catalog_tags",
    "find_products_by_tag_overlap",
]
