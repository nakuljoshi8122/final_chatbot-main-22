"""Download category-correct demo images for every catalog product.

Uses curated stock photo pools (shoes → sneaker photos, balls → ball photos, etc.)
so images always match the product type in our catalog. Not ShopAssist photos.

Run:
    cd adk && pip install certifi
    python download_product_images.py --force
"""

from __future__ import annotations

from paths import ENV_FILE, DATA_DIR, STATIC_DIR, PRODUCT_IMAGES_DIR, PENDING_CHAT_IMAGES_DIR, FAKE_KB_PATH, SELLER_PRODUCTS_JSON, INVENTORY_VISIBILITY_JSON, STORES_JSON, STORE_QUERIES_DIR, PRODUCT_IMAGES_JSON, BOUTIQUE_PRODUCT_IMAGES_JSON

import argparse
import json
import os
import ssl
import time
import urllib.request
from pathlib import Path

try:
    import certifi
except ImportError:
    certifi = None

try:
    from catalog.shopassist_catalog import all_products
    from catalog.product_image_pools import pool_key_for_product, urls_for_product
except ImportError:
    from catalog.shopassist_catalog import all_products
    from catalog.product_image_pools import pool_key_for_product, urls_for_product

OUT_DIR = PRODUCT_IMAGES_DIR
MANIFEST = PRODUCT_IMAGES_JSON
MIN_BYTES = 5_000
USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"


def _ssl_context() -> ssl.SSLContext:
    if certifi:
        return ssl.create_default_context(cafile=certifi.where())
    return ssl.create_default_context()


def download_one(product: dict, force: bool = False) -> bool:
    pid = product["id"]
    dest = OUT_DIR / f"{pid}.jpg"
    if dest.exists() and not force and dest.stat().st_size >= MIN_BYTES:
        return True

    key = pool_key_for_product(product)
    for url in urls_for_product(product):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=30, context=_ssl_context()) as resp:
                data = resp.read()
            if len(data) < MIN_BYTES:
                continue
            dest.write_bytes(data)
            print(f"  saved {dest.name} ({len(data) // 1024} KB) — {key}")
            return True
        except Exception:
            continue

    print(f"  failed {product['name']}")
    return False


def write_manifest() -> None:
    base = os.getenv("API_PUBLIC_URL", "http://127.0.0.1:8000").rstrip("/") + "/product-images"
    manifest = {
        p["id"]: f"{base}/{p['id']}.jpg"
        for p in all_products()
        if (OUT_DIR / f"{p['id']}.jpg").exists()
    }
    MANIFEST.write_text(json.dumps(manifest, indent=2))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true", help="Re-download even if file exists")
    args = parser.parse_args()

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    products = all_products()
    ok = 0

    for i, product in enumerate(products, 1):
        print(f"[{i}/{len(products)}] {product['name']} ({pool_key_for_product(product)})")
        if download_one(product, force=args.force):
            ok += 1
        time.sleep(0.15)

    write_manifest()
    print(f"\nDone — {ok}/{len(products)} images in {OUT_DIR}")


if __name__ == "__main__":
    main()
