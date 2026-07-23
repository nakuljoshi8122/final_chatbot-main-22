"""Smoke checks for association / correlation recommendations.

Run from adk/:
  python scripts/smoke_recommendations.py
"""

from __future__ import annotations

import sys
from pathlib import Path

ADK = Path(__file__).resolve().parents[1]
if str(ADK) not in sys.path:
    sys.path.insert(0, str(ADK))

from commerce.product_recommendations import (  # noqa: E402
    association_upsells,
    inventory_revision,
    related_for_miss,
)
from commerce.query_understand import QueryIntent  # noqa: E402
from commerce.boutique_response import sanitize_boutique_response  # noqa: E402


def _sample_catalog() -> list[dict]:
    return [
        {
            "sku": "SK-SER-1",
            "name": "Vitamin C Serum",
            "category": "Skincare",
            "domain": "skincare",
            "product_type": "serum",
            "tags": ["serum", "brightening"],
            "status": "active",
            "quantity": 5,
            "store_id": "store_skin",
        },
        {
            "sku": "SK-MOI-1",
            "name": "Hydrating Moisturizer",
            "category": "Skincare",
            "domain": "skincare",
            "product_type": "moisturizer",
            "tags": ["moisturizer", "hydrating"],
            "status": "active",
            "quantity": 5,
            "store_id": "store_skin",
        },
        {
            "sku": "SK-CLN-1",
            "name": "Gentle Cleanser",
            "category": "Skincare",
            "domain": "skincare",
            "product_type": "cleanser",
            "tags": ["cleanser"],
            "status": "active",
            "quantity": 5,
            "store_id": "store_skin",
        },
        {
            "sku": "AP-TEE-1",
            "name": "Classic Tee",
            "category": "Apparel",
            "domain": "apparel",
            "product_type": "t-shirt",
            "tags": ["tee", "cotton"],
            "status": "active",
            "quantity": 5,
            "store_id": "store_apparel",
        },
        {
            "sku": "AP-SHT-1",
            "name": "Summer Shorts",
            "category": "Apparel",
            "domain": "apparel",
            "product_type": "shorts",
            "tags": ["shorts", "summer"],
            "status": "active",
            "quantity": 5,
            "store_id": "store_apparel",
        },
    ]


def main() -> None:
    catalog = _sample_catalog()
    serum = catalog[0]

    # Association: serum → moisturizer / cleanser
    upsells = association_upsells([serum], catalog, store_id="store_skin", limit=2)
    upsell_skus = {u["sku"] for u in upsells}
    assert "SK-SER-1" not in upsell_skus, upsell_skus
    assert upsell_skus & {"SK-MOI-1", "SK-CLN-1"}, upsell_skus
    print("OK association_upsells", sorted(upsell_skus))

    # Correlation miss: sunscreen not in catalog → skincare related
    intent = QueryIntent(
        raw="SPF 50 sunscreen",
        corrected="SPF 50 sunscreen",
        domain="skincare",
        product_types=["moisturizer"],
        audience="unknown",
        attributes=["spf"],
        search_terms=["sunscreen", "spf", "moisturizer", "skincare"],
        intent="product_lookup",
        source="heuristic",
    )
    related = related_for_miss(intent, catalog, store_id="store_skin", limit=3, min_score=3)
    assert related, "expected correlated skincare items"
    assert all(r["domain"] == "skincare" for r in related)
    print("OK related_for_miss", [r["sku"] for r in related])

    # Sanitizer keeps tool tiles on miss prose
    tiles_json = (
        '[{"id":"tile-SK-MOI-1","sku":"SK-MOI-1","name":"Hydrating Moisturizer",'
        '"price":"$28","category":"Skincare","description":"","features":[],'
        '"tag":"Skincare","url":"","img":""}]'
    )
    miss = (
        "We don't currently stock SPF 50 sunscreen. I've noted your request.\n"
        f"<TILES>{tiles_json}</TILES>"
    )
    cleaned = sanitize_boutique_response(miss, "SPF 50 sunscreen")
    assert "<TILES>" in cleaned
    assert "You can also look" in cleaned
    assert "Hydrating Moisturizer" in cleaned
    print("OK sanitize keeps correlated tiles")

    # Pure miss without tiles stays tile-free
    pure = "We don't currently stock SPF 50 sunscreen. I've noted your request for the owner."
    cleaned_pure = sanitize_boutique_response(pure, "SPF 50 sunscreen")
    assert "<TILES>" not in cleaned_pure
    print("OK sanitize strips invented tiles on pure miss")

    rev = inventory_revision()
    assert "seller_products.json" in rev
    print("OK inventory_revision", rev[:80], "...")

    print("\nAll recommendation smoke checks passed.")


if __name__ == "__main__":
    main()
