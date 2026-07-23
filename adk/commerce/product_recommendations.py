"""Association mining + correlation suggestions for buyer product search.

Association (hit path):
  When search finds matching products, mine co-purchase / co-browse style rules
  and return related SKUs for an upsell line like "You can also look at…".

Correlation (miss path):
  When search finds nothing, return in-stock items that are correlated to the
  understood query intent (domain / type / tags / audience) so the shopper is
  not left empty-handed.
"""

from __future__ import annotations

import itertools
import json
import re
import time
from collections import Counter, defaultdict
from typing import Any

from paths import BUYER_ORDERS_JSON, SELLER_PRODUCTS_JSON, INVENTORY_VISIBILITY_JSON

# Curated complementary pairs used when order history is too sparse for rules.
_SEED_ASSOCIATIONS: list[tuple[str, str]] = [
    ("serum", "moisturizer"),
    ("moisturizer", "cleanser"),
    ("cleanser", "toner"),
    ("toner", "serum"),
    ("t-shirt", "shorts"),
    ("shirt", "pants"),
    ("hoodie", "pants"),
    ("earrings", "necklace"),
    ("necklace", "bracelet"),
    ("bracelet", "earrings"),
    ("vase", "candle"),
    ("mug", "candle"),
]

_TYPE_ALIASES: dict[str, set[str]] = {
    "t-shirt": {"t-shirt", "tshirt", "tee", "shirt"},
    "shirt": {"shirt", "t-shirt", "tee", "blouse"},
    "shorts": {"shorts", "short"},
    "pants": {"pants", "pant", "chino", "trousers"},
    "hoodie": {"hoodie", "sweatshirt"},
    "jacket": {"jacket", "blazer", "coat"},
    "serum": {"serum"},
    "moisturizer": {"moisturizer", "moisturiser", "cream", "lotion"},
    "cleanser": {"cleanser", "face wash", "facewash", "wash"},
    "toner": {"toner"},
    "earrings": {"earring", "earrings", "jhumka"},
    "necklace": {"necklace", "pendant"},
    "bracelet": {"bracelet", "bangle"},
    "vase": {"vase", "pottery", "pot"},
    "candle": {"candle"},
    "mug": {"mug", "cup"},
}

_rule_cache: dict[str, Any] = {"mtime": 0.0, "built_at": 0.0, "rules": {}}


def inventory_revision() -> str:
    """Cheap fingerprint of catalog files so chat can detect inventory drift."""
    stamps: list[str] = []
    for path in (SELLER_PRODUCTS_JSON, INVENTORY_VISIBILITY_JSON, BUYER_ORDERS_JSON):
        try:
            stamps.append(f"{path.name}:{path.stat().st_mtime_ns}")
        except OSError:
            stamps.append(f"{path.name}:0")
    return "|".join(stamps)


def _norm_type(value: str) -> str:
    t = re.sub(r"[^a-z0-9]+", " ", str(value or "").lower()).strip()
    if not t:
        return ""
    compact = t.replace(" ", "")
    for canon, aliases in _TYPE_ALIASES.items():
        if t == canon or compact == canon.replace("-", "") or t in aliases or compact in {
            a.replace("-", "").replace(" ", "") for a in aliases
        }:
            return canon
    return t.split()[0] if t else ""


def _product_type(product: dict[str, Any]) -> str:
    explicit = _norm_type(str(product.get("product_type") or ""))
    if explicit:
        return explicit
    blob = " ".join(
        [
            str(product.get("name") or ""),
            str(product.get("description") or ""),
            " ".join(str(t) for t in (product.get("tags") or [])),
            str(product.get("category") or ""),
        ]
    ).lower()
    for canon, aliases in _TYPE_ALIASES.items():
        for alias in aliases | {canon}:
            if re.search(rf"\b{re.escape(alias)}\b", blob):
                return canon
    return ""


def _sku_of(product: dict[str, Any]) -> str:
    sku = str(product.get("sku") or "").strip().upper()
    if sku:
        return sku
    tid = str(product.get("id") or "")
    if tid.upper().startswith("TILE-"):
        return tid[5:].upper()
    return tid.upper()


def _is_available(product: dict[str, Any]) -> bool:
    status = str(product.get("status") or "active").lower()
    if status and status != "active":
        return False
    try:
        from catalog.seller_catalog import is_sku_available
    except ImportError:
        from catalog.seller_catalog import is_sku_available
    sku = _sku_of(product)
    if not sku:
        return True
    try:
        return is_sku_available(sku)
    except Exception:
        qty = product.get("quantity")
        if qty is None:
            return True
        try:
            return int(qty) > 0
        except (TypeError, ValueError):
            return True


def _same_shop(product: dict[str, Any], store_id: str | None) -> bool:
    if not store_id:
        return True
    sid = str(product.get("store_id") or "").strip()
    # Seed catalog rows often have no store_id; store scoping already filtered them.
    return (not sid) or sid == store_id


def _load_order_baskets() -> list[set[str]]:
    path = BUYER_ORDERS_JSON
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return []
    baskets: list[set[str]] = []
    if not isinstance(data, dict):
        return baskets
    for orders in data.values():
        if not isinstance(orders, list):
            continue
        for order in orders:
            if not isinstance(order, dict):
                continue
            skus = {
                str(it.get("sku") or "").strip().upper()
                for it in (order.get("items") or [])
                if isinstance(it, dict) and str(it.get("sku") or "").strip()
            }
            if len(skus) >= 2:
                baskets.append(skus)
    return baskets


def _build_association_rules(
    baskets: list[set[str]],
    *,
    min_support: float = 0.08,
    min_confidence: float = 0.2,
) -> dict[str, list[tuple[str, float]]]:
    """Simple 1-item → 1-item association rules with support/confidence/lift ranking."""
    n = len(baskets)
    if n < 2:
        return {}

    item_count: Counter[str] = Counter()
    pair_count: Counter[tuple[str, str]] = Counter()
    for basket in baskets:
        for sku in basket:
            item_count[sku] += 1
        for a, b in itertools.combinations(sorted(basket), 2):
            pair_count[(a, b)] += 1

    rules: dict[str, list[tuple[str, float]]] = defaultdict(list)
    for (a, b), cnt in pair_count.items():
        support = cnt / n
        if support < min_support and cnt < 2:
            continue
        for ant, cons in ((a, b), (b, a)):
            conf = cnt / max(1, item_count[ant])
            if conf < min_confidence and cnt < 2:
                continue
            lift = conf / max(1e-9, (item_count[cons] / n))
            score = support * 0.35 + conf * 0.45 + min(lift, 5.0) * 0.2
            rules[ant].append((cons, score))

    for ant, rows in rules.items():
        rows.sort(key=lambda x: x[1], reverse=True)
        rules[ant] = rows[:8]
    return dict(rules)


def _association_rules() -> dict[str, list[tuple[str, float]]]:
    try:
        mtime = BUYER_ORDERS_JSON.stat().st_mtime if BUYER_ORDERS_JSON.exists() else 0.0
    except OSError:
        mtime = 0.0
    now = time.time()
    if (
        _rule_cache["rules"]
        and _rule_cache["mtime"] == mtime
        and now - float(_rule_cache["built_at"]) < 60
    ):
        return _rule_cache["rules"]  # type: ignore[return-value]

    rules = _build_association_rules(_load_order_baskets())
    _rule_cache["mtime"] = mtime
    _rule_cache["built_at"] = now
    _rule_cache["rules"] = rules
    return rules


def _by_sku(products: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for p in products:
        sku = _sku_of(p)
        if sku:
            out[sku] = p
    return out


def _type_index(products: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    idx: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for p in products:
        ptype = _product_type(p)
        if ptype:
            idx[ptype].append(p)
    return idx


def _seed_upsells(
    source: dict[str, Any],
    products: list[dict[str, Any]],
    *,
    exclude: set[str],
    store_id: str | None,
    limit: int,
) -> list[dict[str, Any]]:
    source_type = _product_type(source)
    if not source_type:
        return []
    wanted = [
        cons
        for ant, cons in _SEED_ASSOCIATIONS
        if ant == source_type
    ]
    if not wanted:
        return []

    idx = _type_index(products)
    picks: list[dict[str, Any]] = []
    for cons in wanted:
        for cand in idx.get(cons, []):
            sku = _sku_of(cand)
            if not sku or sku in exclude:
                continue
            if not _same_shop(cand, store_id) or not _is_available(cand):
                continue
            picks.append(cand)
            exclude.add(sku)
            if len(picks) >= limit:
                return picks
    return picks


def association_upsells(
    source_products: list[dict[str, Any]],
    catalog: list[dict[str, Any]],
    *,
    store_id: str | None = None,
    limit: int = 3,
) -> list[dict[str, Any]]:
    """Return complementary products for successful search hits."""
    if not source_products or limit <= 0:
        return []

    available = [
        p
        for p in catalog
        if _same_shop(p, store_id) and _is_available(p)
    ]
    by_sku = _by_sku(available)
    exclude = {_sku_of(p) for p in source_products if _sku_of(p)}
    rules = _association_rules()

    scored: list[tuple[float, dict[str, Any]]] = []
    for src in source_products:
        sku = _sku_of(src)
        for cons, score in rules.get(sku, []):
            if cons in exclude:
                continue
            cand = by_sku.get(cons)
            if not cand:
                continue
            scored.append((score, cand))

    scored.sort(key=lambda x: x[0], reverse=True)
    picks: list[dict[str, Any]] = []
    for _, cand in scored:
        sku = _sku_of(cand)
        if not sku or sku in exclude:
            continue
        picks.append(cand)
        exclude.add(sku)
        if len(picks) >= limit:
            return picks

    # Sparse order history → curated type complements, then same-category fill.
    for src in source_products:
        more = _seed_upsells(
            src,
            available,
            exclude=exclude,
            store_id=store_id,
            limit=limit - len(picks),
        )
        picks.extend(more)
        if len(picks) >= limit:
            return picks[:limit]

    if len(picks) >= limit:
        return picks[:limit]

    # Soft fill: same category / overlapping tags, different product type.
    for src in source_products:
        src_type = _product_type(src)
        src_cat = str(src.get("category") or "").lower()
        src_tags = {str(t).lower() for t in (src.get("tags") or [])}
        ranked: list[tuple[int, dict[str, Any]]] = []
        for cand in available:
            sku = _sku_of(cand)
            if not sku or sku in exclude:
                continue
            cand_type = _product_type(cand)
            if src_type and cand_type and src_type == cand_type:
                continue
            score = 0
            if src_cat and src_cat == str(cand.get("category") or "").lower():
                score += 3
            cand_tags = {str(t).lower() for t in (cand.get("tags") or [])}
            score += min(4, len(src_tags & cand_tags))
            if score > 0:
                ranked.append((score, cand))
        ranked.sort(key=lambda x: x[0], reverse=True)
        for _, cand in ranked:
            sku = _sku_of(cand)
            if sku in exclude:
                continue
            picks.append(cand)
            exclude.add(sku)
            if len(picks) >= limit:
                return picks[:limit]
    return picks[:limit]


def _intent_terms(intent: Any) -> set[str]:
    terms: set[str] = set()
    if intent is None:
        return terms
    for attr in ("domain", "audience", "corrected", "raw"):
        val = getattr(intent, attr, None)
        if val and str(val).lower() not in ("unknown", "unisex", ""):
            terms.update(re.findall(r"[a-z0-9]+", str(val).lower()))
    for attr in ("product_types", "search_terms", "attributes"):
        vals = getattr(intent, attr, None) or []
        for v in vals:
            terms.update(re.findall(r"[a-z0-9]+", str(v).lower()))
            nt = _norm_type(str(v))
            if nt:
                terms.add(nt)
                terms.update(_TYPE_ALIASES.get(nt, set()))
    return {t for t in terms if len(t) > 1}


def related_for_miss(
    intent: Any,
    catalog: list[dict[str, Any]],
    *,
    store_id: str | None = None,
    limit: int = 3,
    min_score: int = 4,
) -> list[dict[str, Any]]:
    """Correlated in-stock products when the exact search has no hits."""
    terms = _intent_terms(intent)
    if not terms:
        return []

    domain = str(getattr(intent, "domain", "") or "").lower()
    audience = str(getattr(intent, "audience", "") or "").lower()
    wanted_types = {
        _norm_type(t)
        for t in (getattr(intent, "product_types", None) or [])
        if _norm_type(t)
    }

    scored: list[tuple[int, dict[str, Any]]] = []
    for product in catalog:
        if not _same_shop(product, store_id) or not _is_available(product):
            continue
        blob = " ".join(
            [
                str(product.get("name") or ""),
                str(product.get("description") or ""),
                str(product.get("category") or ""),
                str(product.get("domain") or ""),
                str(product.get("audience") or ""),
                str(product.get("product_type") or ""),
                " ".join(str(t) for t in (product.get("tags") or [])),
            ]
        ).lower()
        tokens = set(re.findall(r"[a-z0-9]+", blob))
        score = 0
        score += 2 * len(terms & tokens)
        ptype = _product_type(product)
        if wanted_types and ptype in wanted_types:
            score += 8
        elif wanted_types and ptype:
            # Related family (serum↔moisturizer) still counts as correlation.
            for wt in wanted_types:
                for ant, cons in _SEED_ASSOCIATIONS:
                    if (ant == wt and cons == ptype) or (cons == wt and ant == ptype):
                        score += 5
                        break
        p_domain = str(product.get("domain") or "").lower()
        if domain and domain != "unknown":
            if p_domain == domain or domain in blob:
                score += 4
            elif p_domain and p_domain != domain and domain not in ("handicrafts",):
                score -= 6
        if audience in ("men", "women"):
            p_aud = str(product.get("audience") or "").lower()
            if p_aud == audience:
                score += 2
            elif p_aud in ("men", "women") and p_aud != audience:
                score -= 3
        if score >= min_score:
            scored.append((score, product))

    scored.sort(key=lambda x: (-x[0], str(x[1].get("name") or "")))
    picks: list[dict[str, Any]] = []
    seen: set[str] = set()
    for _, product in scored:
        sku = _sku_of(product)
        if not sku or sku in seen:
            continue
        seen.add(sku)
        picks.append(product)
        if len(picks) >= limit:
            break
    return picks


def enrich_as_tiles(products: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Convert catalog/seller rows into app TILES payloads."""
    try:
        from catalog.boutique_catalog import enrich_product, tile_for_sku
    except ImportError:
        from catalog.boutique_catalog import enrich_product, tile_for_sku

    tiles: list[dict[str, Any]] = []
    for product in products:
        sku = _sku_of(product)
        tile = tile_for_sku(sku) if sku else None
        if tile:
            tiles.append(tile)
            continue
        try:
            tiles.append(enrich_product(product))
        except Exception:
            tiles.append(product)
    return tiles
