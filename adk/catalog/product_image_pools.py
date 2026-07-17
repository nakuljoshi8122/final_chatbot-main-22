"""Curated demo image pools — category-correct stock photos (not ShopAssist).

Each product maps to a pool key from catalog metadata; we pick a stable image
per product id so shoes always look like shoes, balls like balls, etc.
"""

from __future__ import annotations

import hashlib

# Unsplash — free to hotlink for demos; one URL per slot in each pool
POOLS: dict[str, list[str]] = {
    "footwear_running": [
        "https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=800&q=80",
        "https://images.unsplash.com/photo-1606107557195-0e29a4b5b4aa?w=800&q=80",
        "https://images.unsplash.com/photo-1595950653106-6c9ebd614d3a?w=800&q=80",
        "https://images.unsplash.com/photo-1608231387042-66d1773070a5?w=800&q=80",
        "https://images.unsplash.com/photo-1460353581641-37baddab0fa2?w=800&q=80",
        "https://images.unsplash.com/photo-1549298916-b41d501d3772?w=800&q=80",
    ],
    "footwear_lifestyle": [
        "https://images.unsplash.com/photo-1606107557195-0e29a4b5b4aa?w=800&q=80",
        "https://images.unsplash.com/photo-1560769629-975ec94d6e86?w=800&q=80",
        "https://images.unsplash.com/photo-1551107696-a4b0c5a0d9a2?w=800&q=80",
        "https://images.unsplash.com/photo-1584735935682-2f2b69dff9d2?w=800&q=80",
        "https://images.unsplash.com/photo-1627225924765-315d83924938?w=800&q=80",
        "https://images.unsplash.com/photo-1549298916-b41d501d3772?w=800&q=80",
    ],
    "footwear_football": [
        "https://images.unsplash.com/photo-1517466787929-bc90951d0974?w=800&q=80",
        "https://images.unsplash.com/photo-1575361204480-aadea25e6e68?w=800&q=80",
        "https://images.unsplash.com/photo-1560272564-c83b66b1ad12?w=800&q=80",
        "https://images.unsplash.com/photo-1574629810360-7efbbe195018?w=800&q=80",
        "https://images.unsplash.com/photo-1431324155629-1a6deb1dec8d?w=800&q=80",
    ],
    "footwear_basketball": [
        "https://images.unsplash.com/photo-1600269452121-4f2416e55c28?w=800&q=80",
        "https://images.unsplash.com/photo-1546519638-68e109498ffc?w=800&q=80",
        "https://images.unsplash.com/photo-1576678927484-cc907957088c?w=800&q=80",
        "https://images.unsplash.com/photo-1511556532299-8f662fc54c82?w=800&q=80",
    ],
    "footwear_outdoor": [
        "https://images.unsplash.com/photo-1520248720143-4a6b60ae0ff4?w=800&q=80",
        "https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=800&q=80",
        "https://images.unsplash.com/photo-1620799140408-edc6dcb6d633?w=800&q=80",
        "https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=800&q=80",
    ],
    "clothing_t-shirt": [
        "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=800&q=80",
        "https://images.unsplash.com/photo-1583743814966-8936f5b7be1a?w=800&q=80",
        "https://images.unsplash.com/photo-1576566588028-4147f3842f27?w=800&q=80",
    ],
    "clothing_hoodie": [
        "https://images.unsplash.com/photo-1556821840-3a63f95609a7?w=800&q=80",
        "https://images.unsplash.com/photo-1620799140408-edc6dcb6d633?w=800&q=80",
        "https://images.unsplash.com/photo-1503342217505-b0a15ec3261c?w=800&q=80",
    ],
    "clothing_shorts": [
        "https://images.unsplash.com/photo-1591195853828-11db59a44f6b?w=800&q=80",
        "https://images.unsplash.com/photo-1596755094514-f87e34085b2c?w=800&q=80",
    ],
    "clothing_track pants": [
        "https://images.unsplash.com/photo-1506629082955-511b1aa562c8?w=800&q=80",
        "https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?w=800&q=80",
    ],
    "clothing_joggers": [
        "https://images.unsplash.com/photo-1473966968600-fa801b869a1a?w=800&q=80",
        "https://images.unsplash.com/photo-1503342217505-b0a15ec3261c?w=800&q=80",
    ],
    "clothing_jersey": [
        "https://images.unsplash.com/photo-1574629810360-7efbbe195018?w=800&q=80",
        "https://images.unsplash.com/photo-1431324155629-1a6deb1dec8d?w=800&q=80",
        "https://images.unsplash.com/photo-1522778119026-d647f0596c20?w=800&q=80",
    ],
    "clothing_leggings": [
        "https://images.unsplash.com/photo-1506629082955-511b1aa562c8?w=800&q=80",
        "https://images.unsplash.com/photo-1518310383802-640c2de311b2?w=800&q=80",
    ],
    "clothing_sports bra": [
        "https://images.unsplash.com/photo-1518310383802-640c2de311b2?w=800&q=80",
        "https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=800&q=80",
    ],
    "clothing_jacket": [
        "https://images.unsplash.com/photo-1591047139829-d91aecb6caea?w=800&q=80",
        "https://images.unsplash.com/photo-1544022613-e87ca75a784a?w=800&q=80",
    ],
    "clothing_pants": [
        "https://images.unsplash.com/photo-1473966968600-fa801b869a1a?w=800&q=80",
        "https://images.unsplash.com/photo-1503342217505-b0a15ec3261c?w=800&q=80",
    ],
    "clothing_track top": [
        "https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?w=800&q=80",
        "https://images.unsplash.com/photo-1503342217505-b0a15ec3261c?w=800&q=80",
    ],
    "clothing_default": [
        "https://images.unsplash.com/photo-1434389677669-e08b4cac3105?w=800&q=80",
        "https://images.unsplash.com/photo-1489987707025-afc232f7ea0f?w=800&q=80",
    ],
    "equipment_football": [
        "https://images.unsplash.com/photo-1614632537428-1e497c2d8065?w=800&q=80",
        "https://images.unsplash.com/photo-1575361204480-aadea25e6e68?w=800&q=80",
        "https://images.unsplash.com/photo-1560272564-c83b66b1ad12?w=800&q=80",
    ],
    "equipment_basketball": [
        "https://images.unsplash.com/photo-1546519638-68e109498ffc?w=800&q=80",
        "https://images.unsplash.com/photo-1511556532299-8f662fc54c82?w=800&q=80",
    ],
    "equipment_cricket": [
        "https://images.unsplash.com/photo-1531410400050-ca32dd27a0b0?w=800&q=80",
        "https://images.unsplash.com/photo-1624526267942-ab0ff8a3e972?w=800&q=80",
    ],
    "equipment_fitness": [
        "https://images.unsplash.com/photo-1517836357463-d25dfeac3438?w=800&q=80",
        "https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=800&q=80",
        "https://images.unsplash.com/photo-1518611012118-696072aa579a?w=800&q=80",
    ],
    "equipment_bags": [
        "https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=800&q=80",
        "https://images.unsplash.com/photo-1581605405669-fcdf9a95b45c?w=800&q=80",
    ],
    "equipment_tennis": [
        "https://images.unsplash.com/photo-1622279457126-aaeb9123f2bc?w=800&q=80",
        "https://images.unsplash.com/photo-1595435934249-5df7ed86e1c0?w=800&q=80",
    ],
    "equipment_swimming": [
        "https://images.unsplash.com/photo-1530549387789-4c1017266635?w=800&q=80",
        "https://images.unsplash.com/photo-1571902943202-507ec2618e8f?w=800&q=80",
    ],
    "equipment_default": [
        "https://images.unsplash.com/photo-1461896836934-ffe607ba8211?w=800&q=80",
        "https://images.unsplash.com/photo-1517649763961-0c62306601b7?w=800&q=80",
    ],
    "bundle_default": [
        "https://images.unsplash.com/photo-1460353581641-37baddab0fa2?w=800&q=80",
        "https://images.unsplash.com/photo-1517649763961-0c62306601b7?w=800&q=80",
    ],
}


def pool_key_for_product(product: dict) -> str:
    cat = product.get("category", "")
    if cat == "footwear":
        return f"footwear_{product.get('sport', 'lifestyle')}"
    if cat == "clothing":
        typ = product.get("type", "default")
        return f"clothing_{typ}" if f"clothing_{typ}" in POOLS else "clothing_default"
    if cat == "sports_equipment":
        eq = product.get("equipment_type") or "default"
        return f"equipment_{eq}" if f"equipment_{eq}" in POOLS else "equipment_default"
    if cat == "bundle":
        return "bundle_default"
    return "equipment_default"


def urls_for_product(product: dict) -> list[str]:
    """Ordered URLs to try — primary pool first, then shared defaults."""
    key = pool_key_for_product(product)
    primary = list(POOLS.get(key, []))
    start = int(hashlib.md5(product["id"].encode()).hexdigest(), 16) % max(len(primary), 1)
    rotated = primary[start:] + primary[:start] if primary else []
    fallbacks = POOLS.get("equipment_default", [])
    seen: set[str] = set()
    out: list[str] = []
    for url in rotated + fallbacks:
        if url not in seen:
            seen.add(url)
            out.append(url)
    return out


def image_url_for_product(product: dict) -> str:
    urls = urls_for_product(product)
    return urls[0] if urls else POOLS["equipment_default"][0]
