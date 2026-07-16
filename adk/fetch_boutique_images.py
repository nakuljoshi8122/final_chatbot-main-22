#!/usr/bin/env python3
"""
Fetch one Pinterest product image per boutique SKU and wire redirectable links.

Uses the scraper's search + download helpers from:
  ~/Downloads/web-scrapper-agent/pinterest_scraper.py

Writes:
  adk/static/products/{SKU}.jpg     — served at /product-images/{SKU}.jpg
  adk/boutique_product_images.json  — sku → img + Pinterest pin URL (click-through)

Usage (from adk/ with venv active):
  pip install requests Pillow
  python fetch_boutique_images.py --limit-per 1
  python fetch_boutique_images.py --sku HC-VASE-TP10   # one product
  python fetch_boutique_images.py --dry-run            # list queries only

Cookie: reads web-scrapper-agent/cookie.txt by default (or --cookie-file).
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import time
from pathlib import Path

ADK_DIR = Path(__file__).resolve().parent
SCRAPER_DIR = Path.home() / "Downloads" / "web-scrapper-agent"
DEFAULT_COOKIE = SCRAPER_DIR / "cookie.txt"
OUT_JSON = ADK_DIR / "boutique_product_images.json"
PRODUCT_DIR = ADK_DIR / "static" / "products"

sys.path.insert(0, str(SCRAPER_DIR))

try:
    from boutique_catalog import parse_kb_products, _public_base
except ImportError:
    from adk.boutique_catalog import parse_kb_products, _public_base  # type: ignore


def _pinterest_query(product: dict) -> str:
    cat = (product.get("category") or "").strip()
    name = product["name"]
    # Keep queries product-ish so we get shoppable lookalikes
    if "Handicraft" in cat:
        return f"{name} handmade product photography"
    if "Apparel" in cat:
        return f"{name} clothing product photo"
    if "Skincare" in cat:
        return f"{name} skincare bottle product photo"
    return f"{name} product photography"


def _load_cookie(path: Path) -> str:
    if not path.exists():
        raise FileNotFoundError(
            f"Cookie file not found: {path}\n"
            "Log into Pinterest in a browser, copy cookies into cookie.txt "
            "(see web-scrapper-agent README / pinterest_scraper.py)."
        )
    return path.read_text(encoding="utf-8").strip()


def _load_existing() -> dict:
    if OUT_JSON.exists():
        try:
            return json.loads(OUT_JSON.read_text(encoding="utf-8"))
        except Exception:
            return {}
    return {}


def fetch_one(product: dict, cookie: str, domain: str, scratch_dir: Path) -> dict | None:
    from pinterest_scraper import scrape_with_cookie

    query = _pinterest_query(product)
    sku = product["sku"]
    # Fresh scratch so we can pick the new file easily
    if scratch_dir.exists():
        shutil.rmtree(scratch_dir)
    scratch_dir.mkdir(parents=True)

    added = scrape_with_cookie(
        cookie,
        [query],
        limit=1,
        domain=domain,
        out_dir=str(scratch_dir),
        min_width=640,
        min_height=480,
        workers=4,
        account_email="",
    )
    man_path = scratch_dir / "manifest" / "manifest.json"
    if not man_path.exists() or added < 1:
        return None

    manifest = json.loads(man_path.read_text(encoding="utf-8"))
    if not manifest:
        return None
    entry = manifest[-1]
    src = Path(entry["local_path"])
    if not src.exists():
        return None

    PRODUCT_DIR.mkdir(parents=True, exist_ok=True)
    dest = PRODUCT_DIR / f"{sku}.jpg"
    # Normalize extension to .jpg for the FastAPI static mount convention
    shutil.copy2(src, dest)

    pin = entry.get("source_page") or entry.get("image_url") or ""
    base = _public_base()
    return {
        "sku": sku,
        "name": product["name"],
        "category": product.get("category"),
        "price": product.get("price"),
        "search_term": query,
        "img": f"{base}/product-images/{sku}.jpg",
        "image_url": entry.get("image_url") or "",
        "url": pin,  # redirectable Pinterest pin page
        "source_page": pin,
        "external_link": entry.get("external_link") or "",
        "local_path": str(dest),
        "width": entry.get("width"),
        "height": entry.get("height"),
        "downloaded_at": entry.get("downloaded_at"),
        "source": "pinterest",
    }


def main() -> None:
    ap = argparse.ArgumentParser(description="Pinterest images for boutique SKUs")
    ap.add_argument("--cookie-file", type=Path, default=DEFAULT_COOKIE)
    ap.add_argument("--domain", default="www.pinterest.com")
    ap.add_argument("--sku", help="Only fetch this SKU")
    ap.add_argument("--limit-products", type=int, default=0, help="Max products to fetch (0=all)")
    ap.add_argument("--sleep", type=float, default=2.0, help="Seconds between products")
    ap.add_argument("--skip-existing", action="store_true", default=True)
    ap.add_argument("--force", action="store_true", help="Re-download even if JSON entry exists")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    products = parse_kb_products()
    if args.sku:
        products = [p for p in products if p["sku"].upper() == args.sku.upper()]
        if not products:
            print(f"SKU not found: {args.sku}")
            sys.exit(1)
    if args.limit_products > 0:
        products = products[: args.limit_products]

    print(f"Products to process: {len(products)}")
    if args.dry_run:
        for p in products:
            print(f"  {p['sku']}: {_pinterest_query(p)}")
        return

    cookie = _load_cookie(args.cookie_file)
    existing = _load_existing()
    scratch = ADK_DIR / "_pinterest_scratch"
    ok, fail = 0, 0

    for i, product in enumerate(products, 1):
        sku = product["sku"]
        local = PRODUCT_DIR / f"{sku}.jpg"
        if not args.force and args.skip_existing and sku in existing and local.exists():
            print(f"[{i}/{len(products)}] skip {sku} (already have image)")
            continue

        print(f"[{i}/{len(products)}] fetch {sku} — {product['name']}")
        try:
            row = fetch_one(product, cookie, args.domain, scratch)
        except Exception as e:
            print(f"  ERROR: {e}")
            fail += 1
            time.sleep(args.sleep)
            continue

        if not row:
            print("  no pins saved")
            fail += 1
        else:
            existing[sku] = row
            OUT_JSON.write_text(json.dumps(existing, indent=2, ensure_ascii=False), encoding="utf-8")
            print(f"  saved → {row['local_path']}")
            print(f"  click → {row['url']}")
            ok += 1

        time.sleep(args.sleep)

    if scratch.exists():
        shutil.rmtree(scratch, ignore_errors=True)

    print(f"\nDone. ok={ok} fail={fail}")
    print(f"Manifest: {OUT_JSON}")
    print(f"Images:   {PRODUCT_DIR}")
    print("Restart FastAPI so /product-images serves new files.")


if __name__ == "__main__":
    main()
