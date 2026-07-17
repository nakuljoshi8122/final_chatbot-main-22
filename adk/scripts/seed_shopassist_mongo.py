"""Seed ShopAssist catalog + image URLs into MongoDB.

Run once (or after catalog/image changes):
    cd adk && source .venv/bin/activate
    python scripts/seed_shopassist_mongo.py
"""

from __future__ import annotations

try:
    from catalog.shopassist_data import seed_marketplace, all_products
except ImportError:
    from catalog.shopassist_data import seed_marketplace, all_products


def main() -> None:
    count = seed_marketplace("ShopAssist")
    sample = all_products()[0]
    print(f"Seeded {count} products into shopassist_marketplace_db.marketplace")
    print(f"Sample: {sample['name']} -> img={sample.get('img', '')[:72]}...")


if __name__ == "__main__":
    main()
