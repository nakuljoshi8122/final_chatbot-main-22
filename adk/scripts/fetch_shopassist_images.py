"""Fetch product hero images from shopassist.local search (official CDN).

Run once to refresh local cache:
    cd adk && python fetch_shopassist_images.py

Writes product_images.json — used by product_images.py at runtime.
"""

from __future__ import annotations

from paths import ENV_FILE, DATA_DIR, STATIC_DIR, PRODUCT_IMAGES_DIR, PENDING_CHAT_IMAGES_DIR, FAKE_KB_PATH, SELLER_PRODUCTS_JSON, INVENTORY_VISIBILITY_JSON, STORES_JSON, STORE_QUERIES_DIR, PRODUCT_IMAGES_JSON, BOUTIQUE_PRODUCT_IMAGES_JSON

import json
import re
import ssl
import time
import urllib.parse
import urllib.request
from pathlib import Path

try:
    import certifi
except ImportError:
    certifi = None

try:
    from catalog.shopassist_catalog import all_products
except ImportError:
    from catalog.shopassist_catalog import all_products

OUTPUT = PRODUCT_IMAGES_JSON
USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
IMG_RE = re.compile(
    r"https://assets\.shopassist\.local/images/(?:h_\d+|w_\d+),f_auto,q_auto[^\"'\\s]+?\.jpg",
    re.IGNORECASE,
)


def _tile_url(url: str) -> str:
    """Normalize to a medium tile-friendly size."""
    return re.sub(r"/images/w_\d+,", "/images/h_600,", url)


def _pick_best(urls: list[str]) -> str | None:
    for u in urls:
        low = u.lower()
        if "_hover" in low or "video" in low or "swatch" in low:
            continue
        if "_hm1" in low or "_01_standard" in low or "_standard" in low:
            return _tile_url(u)
    for u in urls:
        low = u.lower()
        if "_hover" not in low and "video" not in low:
            return _tile_url(u)
    return _tile_url(urls[0]) if urls else None


def _ssl_context() -> ssl.SSLContext:
    if certifi:
        return ssl.create_default_context(cafile=certifi.where())
    return ssl.create_default_context()


def fetch_image_for_name(name: str) -> str | None:
    query = urllib.parse.quote(f"shopassist {name}")
    url = f"https://shopassist.local/search?q={query}"
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=25, context=_ssl_context()) as resp:
            html = resp.read().decode("utf-8", errors="ignore")
    except Exception as exc:
        print(f"  skip ({exc})")
        return None

    urls = IMG_RE.findall(html)
    return _pick_best(urls)


def main() -> None:
    existing: dict[str, str] = {}
    if OUTPUT.exists():
        existing = json.loads(OUTPUT.read_text())

    products = all_products()
    images: dict[str, str] = dict(existing)
    updated = 0

    for i, product in enumerate(products, 1):
        pid = product["id"]
        if pid in images and images[pid].startswith("https://assets.shopassist.local"):
            continue
        name = product["name"]
        print(f"[{i}/{len(products)}] {name}...")
        img = fetch_image_for_name(name)
        if img:
            images[pid] = img
            updated += 1
            print(f"  -> {img[:72]}...")
        time.sleep(0.4)

    OUTPUT.write_text(json.dumps(images, indent=2))
    print(f"\nSaved {len(images)} images ({updated} new) -> {OUTPUT}")


if __name__ == "__main__":
    main()
