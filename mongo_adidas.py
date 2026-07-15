import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "adk"))

from pymongo import MongoClient
from adidas_catalog import build_marketplace_document

client = MongoClient("mongodb://127.0.0.1:27017/?directConnection=true")
db = client.adidas_marketplace_db
marketplace = db.marketplace

marketplace.delete_many({"brand.name": "Adidas"})
marketplace.insert_one(build_marketplace_document())
print("Adidas marketplace catalog inserted successfully!")
