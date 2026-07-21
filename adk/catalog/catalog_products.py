"""Unified product listing for chat commerce helpers.

Boutique KB + seller overlay — no sports/Mongo catalog.
"""

from __future__ import annotations

from typing import Any


def all_products() -> list[dict[str, Any]]:
    """Active boutique/seller products with images."""
    try:
        from catalog.boutique_catalog import products_with_images
    except ImportError:
        from catalog.boutique_catalog import products_with_images
    return products_with_images()
