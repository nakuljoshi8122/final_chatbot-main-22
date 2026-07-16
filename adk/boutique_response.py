"""Force boutique agent replies into short prose + clickable <TILES> cards."""

from __future__ import annotations

import re
from typing import Any

try:
    from .boutique_catalog import (
        enrich_product,
        format_tiles_block,
        parse_kb_products,
        tile_for_sku,
    )
except ImportError:
    from boutique_catalog import (  # type: ignore
        enrich_product,
        format_tiles_block,
        parse_kb_products,
        tile_for_sku,
    )

TILES_RE = re.compile(r"<TILES>([\s\S]*?)</TILES>", re.IGNORECASE)
MD_IMG_RE = re.compile(r"!\[[^\]]*\]\([^)]+\)")
MD_LINK_RE = re.compile(r"\[([^\]]*)\]\(([^)]+)\)")
PRODUCT_IMG_RE = re.compile(
    r"/product-images/([A-Za-z0-9\-]+)\.(?:jpe?g|png|webp)",
    re.IGNORECASE,
)
SKU_INLINE_RE = re.compile(r"\b((?:HC|AP|SK)-[A-Z0-9\-]+)\b", re.IGNORECASE)


def _unique_tiles(tiles: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for t in tiles:
        key = str(t.get("id") or t.get("sku") or t.get("name") or "")
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(t)
    return out


def _tiles_from_existing_block(text: str) -> list[dict[str, Any]]:
    import json

    tiles: list[dict[str, Any]] = []
    for match in TILES_RE.finditer(text or ""):
        raw = match.group(1).strip()
        try:
            parsed = json.loads(raw)
        except Exception:
            continue
        entries = parsed if isinstance(parsed, list) else [parsed]
        for entry in entries:
            if isinstance(entry, dict) and entry.get("name"):
                tiles.append(entry)
    return tiles


def _tiles_from_skus(skus: list[str]) -> list[dict[str, Any]]:
    tiles: list[dict[str, Any]] = []
    catalog = parse_kb_products()
    by_sku = {p["sku"].upper(): p for p in catalog}
    for sku in skus:
        key = sku.upper()
        tile = tile_for_sku(key)
        if tile:
            tiles.append(tile)
            continue
        # Fuzzy: model may invent close SKUs (SK-SER-VC30 vs SK-SERUM-VC30)
        fuzzy = None
        for cand, p in by_sku.items():
            if key in cand or cand in key:
                fuzzy = p
                break
        if fuzzy:
            tiles.append(enrich_product(fuzzy))
    return tiles


def _tiles_from_names(text: str, limit: int = 5) -> list[dict[str, Any]]:
    lower = (text or "").lower()
    matched: list[dict[str, Any]] = []
    # Longest names first so "Aloe Vera Hydrating Moisturizer" beats "Aloe"
    products = sorted(parse_kb_products(), key=lambda p: len(p["name"]), reverse=True)
    for p in products:
        name = p["name"].lower().strip()
        if not name:
            continue
        # Word-ish boundary so "t-shirt" does not match inside "t-shirts" miss copy
        # ("do not have t-shirts") and invent a tile for an out-of-stock reply.
        if re.search(rf"(?<![a-z0-9]){re.escape(name)}(?![a-z0-9])", lower):
            matched.append(enrich_product(p))
            if len(matched) >= limit:
                break
    return matched


def _collect_skus(text: str) -> list[str]:
    found: list[str] = []
    for rx in (PRODUCT_IMG_RE, SKU_INLINE_RE):
        for m in rx.finditer(text or ""):
            sku = m.group(1).upper()
            if sku not in found:
                found.append(sku)
    return found


def _clean_prose(text: str) -> str:
    prose = TILES_RE.sub(" ", text or "")
    prose = MD_IMG_RE.sub(" ", prose)
    # Drop markdown links entirely (e.g. View Here → pinterest)
    prose = MD_LINK_RE.sub(" ", prose)
    prose = re.sub(r"https?://\S+", " ", prose)
    prose = re.sub(r"[ \t]+", " ", prose)
    prose = re.sub(r"\n{3,}", "\n\n", prose)
    return prose.strip()


def _filter_tiles_for_query(tiles: list[dict[str, Any]], user_query: str) -> list[dict[str, Any]]:
    """Drop obviously off-intent tiles (e.g. earrings when user asked for menswear)."""
    q = (user_query or "").lower()
    tokens = set(re.findall(r"[a-z0-9]+", q))
    want_men = bool(tokens & {"men", "mens", "male", "man"})
    want_apparel = bool(
        tokens
        & {
            "apparel",
            "apparels",
            "clothing",
            "shirt",
            "shirts",
            "tee",
            "tees",
            "tshirt",
            "tshirts",
            "shorts",
            "short",
            "chino",
            "summer",
            "outfit",
        }
    ) or want_men or ("t-shirt" in q) or ("t-shirts" in q)
    want_jewellery = bool(
        tokens & {"jewellery", "jewelry", "earring", "earrings", "bracelet", "necklace", "ring"}
    )
    want_skincare = bool(
        tokens & {"skincare", "serum", "moisturizer", "moisturiser", "brightening", "cleanser"}
    )

    def domain_of(t: dict[str, Any]) -> str:
        d = str(t.get("domain") or "").lower()
        if d in ("jewelry", "jewelery"):
            d = "jewellery"
        if d:
            return d
        blob = f"{t.get('name')} {t.get('category')} {t.get('tag')} {' '.join(t.get('features') or [])}".lower()
        if any(k in blob for k in ("earring", "bracelet", "necklace", "jewellery", "jewelry", "bead")):
            return "jewellery"
        if any(k in blob for k in ("shirt", "tee", "chino", "apparel", "hoodie", "short")):
            return "apparel"
        if any(k in blob for k in ("serum", "moisturizer", "skincare")):
            return "skincare"
        cat = str(t.get("category") or "").lower()
        if "apparel" in cat:
            return "apparel"
        if "skincare" in cat:
            return "skincare"
        return "other"

    out: list[dict[str, Any]] = []
    for t in tiles:
        d = domain_of(t)
        if want_jewellery and not want_apparel and d not in ("jewellery", "other", "handicrafts"):
            continue
        if want_apparel and not want_jewellery and d == "jewellery":
            continue
        if want_skincare and not want_apparel and d in ("jewellery", "apparel"):
            continue
        if want_men and not want_jewellery and d == "jewellery":
            continue
        out.append(t)
    return out or tiles


def sanitize_boutique_response(
    response_text: str,
    user_query: str = "",
    store: str | None = None,
) -> str:
    """
    Ensure product recommendations render as app tiles:
    short intro + <TILES>[...]</TILES> with img + clickable url.
    Never leave raw markdown images/links in the customer-facing answer.
    """
    try:
        from dotenv import load_dotenv
        from pathlib import Path

        load_dotenv(Path(__file__).resolve().parent / ".env", override=False)
    except Exception:
        pass

    if store:
        try:
            try:
                from .store_scope import set_current_store
            except ImportError:
                from store_scope import set_current_store
            set_current_store(store)
        except Exception:
            pass

    text = response_text or ""
    low_text = text.lower()
    miss_reply = any(
        p in low_text
        for p in (
            "couldn't find",
            "could not find",
            "noted your request",
            "do not currently",
            "don't currently",
            "currently do not have",
            "currently don't have",
            "do not have",
            "don't have",
            "not have shirts",
            "not have t-shirt",
            "not in our catalog",
            "not currently stock",
            "not in stock",
            "do not have that",
            "don't have that",
            "out of stock",
            "owner to follow",
            "owner will follow",
        )
    )
    if miss_reply:
        # Don't attach unrelated catalog cards when we already said we don't have it
        prose = _clean_prose(text)
        return prose or text.strip()

    existing = _tiles_from_existing_block(text)
    # Prefer TILES the model copied from search_kb; only fall back to name mining if empty
    if existing:
        merged = _unique_tiles(existing)[:5]
    else:
        from_skus = _tiles_from_skus(_collect_skus(text))
        from_names = _tiles_from_names(text)
        merged = _unique_tiles(from_skus + from_names)[:5]

    tiles: list[dict[str, Any]] = []
    for t in merged:
        sku = ""
        tid = str(t.get("id") or "")
        if tid.startswith("tile-"):
            sku = tid[5:]
        sku = sku or str(t.get("sku") or "")
        fresh = tile_for_sku(sku) if sku else None
        tiles.append(fresh or t)

    if not tiles and user_query:
        tiles = _unique_tiles(_tiles_from_names(user_query, limit=3))

    tiles = _filter_tiles_for_query(tiles, user_query)
    try:
        try:
            from .store_scope import product_matches_store, get_current_store
        except ImportError:
            from store_scope import product_matches_store, get_current_store
        if get_current_store():
            tiles = [t for t in tiles if product_matches_store(t)]
    except Exception:
        pass

    prose = _clean_prose(text)
    looked_like_product_dump = bool(
        MD_IMG_RE.search(text or "")
        or MD_LINK_RE.search(text or "")
        or (prose.count("$") >= 2)
        or re.search(r"^\s*\d+\.\s+\*?\*?", prose, re.M)
    )
    if tiles and (not prose or len(prose) > 280 or looked_like_product_dump):
        prose = "Here are a few options — tap a card for the photo and details."

    if not tiles:
        return prose or text.strip()

    return f"{prose}\n{format_tiles_block(tiles)}".strip()
