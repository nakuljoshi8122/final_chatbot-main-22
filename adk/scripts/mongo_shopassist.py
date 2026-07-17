"""Seed ShopAssist catalog into MongoDB from repo root or adk/."""

from __future__ import annotations

import sys
from pathlib import Path

# Allow running as: python scripts/mongo_shopassist.py from adk/
_ADK_ROOT = Path(__file__).resolve().parent.parent
if str(_ADK_ROOT) not in sys.path:
    sys.path.insert(0, str(_ADK_ROOT))

from pymongo import MongoClient
from catalog.shopassist_catalog import build_marketplace_document

client = MongoClient("mongodb://127.0.0.1:27017/?directConnection=true")
db = client.shopassist_marketplace_db
marketplace = db.marketplace

marketplace.delete_many({"brand.name": "ShopAssist"})
marketplace.insert_one(build_marketplace_document())
print("ShopAssist marketplace catalog inserted successfully!")
