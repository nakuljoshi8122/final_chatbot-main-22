"""Customer-support tools for the artisan boutique agent.

Includes mock RAG over fake_kb.md (handicrafts, apparel, skincare) plus Postgres CRM helpers.
Docstrings are part of the tool schema the LLM sees — keep them precise.
"""

from __future__ import annotations

from paths import ENV_FILE, DATA_DIR, STATIC_DIR, PRODUCT_IMAGES_DIR, PENDING_CHAT_IMAGES_DIR, FAKE_KB_PATH, SELLER_PRODUCTS_JSON, INVENTORY_VISIBILITY_JSON, STORES_JSON, STORE_QUERIES_DIR, PRODUCT_IMAGES_JSON, BOUTIQUE_PRODUCT_IMAGES_JSON

import re
from pathlib import Path
from typing import Optional

from sqlalchemy import select

try:
    from persistence.crm_models import (
        AsyncSessionLocal,
        Contact,
        Note,
        get_or_create_contact,
        log_shop_request as _log_shop_request,
        _utcnow,
    )
except ImportError:
    from persistence.crm_models import (
        AsyncSessionLocal,
        Contact,
        Note,
        get_or_create_contact,
        log_shop_request as _log_shop_request,
        _utcnow,
    )

KB_PATH = FAKE_KB_PATH

ALLOWED_STATUSES = frozenset(
    {
        "new",
        "contacted",
        "interested",
        "order_pending",
        "order_placed",
        "requires_human",
        "resolved",
        "unqualified",
    }
)

# Common stopwords skipped when scoring KB chunks against a query
_STOPWORDS = frozenset(
    (
        "a an the and or for to of in on is it my me with can you what how much please "
        "any some else also no yes just looking want need show something"
    ).split()
)

# Intent → search terms (narrow — avoid coupling jewellery with menswear)
_QUERY_EXPANSIONS: dict[str, list[str]] = {
    "jewellery": ["jewelry", "jewellery", "earring", "earrings", "bracelet", "necklace", "ring", "accessory"],
    "jewelry": ["jewelry", "jewellery", "earring", "earrings", "bracelet", "necklace", "ring", "accessory"],
    "jewelery": ["jewelry", "jewellery", "earring", "earrings", "bracelet", "necklace", "ring"],
    "earrings": ["earring", "earrings", "jewellery", "jewelry", "accessory"],
    "earring": ["earring", "earrings", "jewellery", "jewelry", "accessory"],
    "apparel": ["apparel", "clothing", "shirt", "tee", "t-shirt", "chino", "pant", "short", "hoodie"],
    "apparels": ["apparel", "clothing", "shirt", "tee", "summer"],
    "clothing": ["apparel", "clothing", "shirt", "tee", "chino"],
    "skincare": ["skincare", "serum", "moisturizer", "moisturiser", "cleanser", "toner", "spf", "beauty"],
    "serum": ["serum", "skincare", "brightening", "vitamin"],
    "brightening": ["brightening", "serum", "vitamin", "skincare"],
    "shorts": ["shorts", "short", "apparel", "clothing"],
    "men": ["men", "mens", "male", "apparel", "clothing", "shirt", "tee", "chino", "short"],
    "mens": ["men", "mens", "male", "apparel", "clothing"],
    "women": ["women", "womens", "female", "jewellery", "jewelry", "apparel"],
    "summer": ["summer", "apparel", "cotton", "linen", "light"],
}

_JEWELLERY_MARKERS = frozenset(
    "jewellery jewelry earring earrings bracelet necklace pendant ring jhumka accessory".split()
)
_APPAREL_MARKERS = frozenset(
    "apparel clothing shirt shirts tee tees tshirt tshirts t-shirt t-shirts chino pant pants "
    "short shorts hoodie jacket dress skirt linen denim".split()
)
_SKINCARE_MARKERS = frozenset(
    "skincare serum moisturizer moisturiser cleanser toner spf beauty brightening".split()
)

# Normalize query tokens so shirts/tshirts match "T-shirt" in catalog
_TOKEN_ALIASES: dict[str, list[str]] = {
    "shirts": ["shirt", "tee", "tshirt", "t-shirt"],
    "shirt": ["shirt", "tee", "tshirt", "t-shirt"],
    "tshirts": ["tshirt", "t-shirt", "tee", "shirt"],
    "tshirt": ["tshirt", "t-shirt", "tee", "shirt"],
    "tees": ["tee", "tshirt", "t-shirt", "shirt"],
    "tee": ["tee", "tshirt", "t-shirt", "shirt"],
    "pants": ["pant", "chino"],
    "shorts": ["short", "shorts"],
}


def _contains_marker(text: str, markers: frozenset[str] | set[str]) -> bool:
    """Word-boundary aware marker match (avoid 'ring' inside 'fringed')."""
    t = text.lower()
    for m in markers:
        if len(m) <= 4:
            if re.search(rf"\b{re.escape(m)}\b", t):
                return True
        elif m in t:
            return True
    return False


def _normalize_query_tokens(query: str) -> set[str]:
    raw = {
        t for t in re.findall(r"[a-z0-9]+", query.lower()) if t not in _STOPWORDS and len(t) > 1
    }
    out: set[str] = set()
    for t in raw:
        out.add(t)
        # simple plural strip
        if t.endswith("ses") and len(t) > 4:
            out.add(t[:-2])
        elif t.endswith("s") and len(t) > 3:
            out.add(t[:-1])
        for alias in _TOKEN_ALIASES.get(t, []):
            out.add(alias)
            out.update(alias.replace("-", "").split())
        # tshirt / t-shirt forms
        if t in ("tshirt", "tshirts") or t.startswith("tshirt"):
            out.update({"tee", "shirt", "t-shirt", "tshirt"})
    return {x for x in out if x and x not in _STOPWORDS}


def _expand_query(query: str) -> str:
    q = query.lower().strip()
    extras: list[str] = []
    tokens = _normalize_query_tokens(q)
    for key, vals in _QUERY_EXPANSIONS.items():
        if key in q or key in tokens:
            extras.extend(vals)
    # apparel synonyms from aliases
    for t in list(tokens):
        extras.extend(_TOKEN_ALIASES.get(t, []))
    seen = set()
    out = []
    for w in list(tokens) + extras:
        w = w.lower().strip()
        if not w or w in seen or w in _STOPWORDS:
            continue
        seen.add(w)
        out.append(w)
    return " ".join(out) if out else query


def _detect_intent(query: str) -> dict[str, bool]:
    q = query.lower()
    tokens = _normalize_query_tokens(q)
    return {
        "jewellery": bool(tokens & _JEWELLERY_MARKERS) or "jewel" in q,
        "apparel": bool(tokens & _APPAREL_MARKERS)
        or any(t in tokens for t in ("men", "mens", "women", "womens", "summer", "outfit")),
        "skincare": bool(tokens & _SKINCARE_MARKERS),
        "men": any(t in tokens for t in ("men", "mens", "male", "man")),
        "women": any(t in tokens for t in ("women", "womens", "female", "woman", "ladies")),
    }


def _chunk_domain(chunk: str) -> str:
    c = chunk.lower()
    m = re.search(r"domain:\s*([a-z]+)", c)
    if m:
        d = m.group(1)
        return "jewellery" if d in ("jewelry", "jewelery") else d
    if "category: apparel" in c or "category: apparel |" in c:
        return "apparel"
    if "category: skincare" in c:
        return "skincare"
    # Infer from content
    if any(k in c for k in _JEWELLERY_MARKERS):
        # Seed products named bracelet etc.
        title = c.splitlines()[0] if c else ""
        if any(k in title for k in ("earring", "bracelet", "necklace", "ring", "bead bracelet")):
            return "jewellery"
    if "category: apparel" in c or any(
        k in c.splitlines()[0] for k in ("shirt", "chino", "tee", "hoodie", "jacket", "short", "pant")
    ):
        return "apparel"
    if "category: skincare" in c or any(k in c for k in ("serum", "moisturizer", "cleanser")):
        return "skincare"
    if "category: handicrafts" in c:
        return "handicrafts"
    return "other"


def _chunk_audience(chunk: str) -> str:
    c = chunk.lower()
    m = re.search(r"audience:\s*([a-z]+)", c)
    if m:
        return m.group(1)
    if "unisex" in c:
        return "unisex"
    return "all"


def _load_kb_chunks(*, mode: str = "auto") -> list[str]:
    """Merge Pinterest/seed KB with live seller uploads (seller overrides same title)."""
    seller_chunks: list[str] = []
    try:
        try:
            from catalog.seller_catalog import seller_kb_chunks, list_seller_products
        except ImportError:
            from catalog.seller_catalog import seller_kb_chunks, list_seller_products

        if list_seller_products(active_only=True):
            try:
                try:
                    from stores.store_scope import get_current_store_id
                except ImportError:
                    from stores.store_scope import get_current_store_id
                sid = get_current_store_id()
            except Exception:
                sid = None
            seller_chunks = seller_kb_chunks(active_only=True, store_id=sid)
    except Exception:
        pass

    if mode == "seller":
        return seller_chunks

    seed_chunks: list[str] = []
    if KB_PATH.exists():
        text = KB_PATH.read_text(encoding="utf-8")
        parts = re.split(r"(?=^## )", text, flags=re.MULTILINE)
        seed_chunks = [p.strip() for p in parts if p.strip() and p.strip().startswith("##")]

    if mode == "seed":
        return seed_chunks

    # auto: seed (Pinterest catalog) + active seller uploads only
    try:
        try:
            from catalog.seller_catalog import chat_suppressed_keys
        except ImportError:
            from catalog.seller_catalog import chat_suppressed_keys
        suppressed_titles, suppressed_skus = chat_suppressed_keys()
    except Exception:
        suppressed_titles, suppressed_skus = set(), set()

    try:
        try:
            from stores.store_scope import chunk_matches_shop, get_current_store, get_current_store_id
        except ImportError:
            from stores.store_scope import chunk_matches_shop, get_current_store, get_current_store_id
        store = get_current_store()
        store_id = get_current_store_id()
    except Exception:
        store = None
        store_id = None

        def chunk_matches_shop(chunk: str) -> bool:  # type: ignore
            return True

    def _chunk_visible(chunk: str) -> bool:
        if not chunk.startswith("##"):
            return True
        if not chunk_matches_shop(chunk):
            return False
        title = chunk.splitlines()[0].lstrip("# ").strip().lower()
        if title in suppressed_titles:
            return False
        sku_m = re.search(r"SKU:\s*([A-Z0-9\-]+)", chunk, re.I)
        if sku_m and sku_m.group(1).upper() in suppressed_skus:
            return False
        return True

    # Non-demo shop with store_id: seller products only (no seed catalog)
    try:
        from stores.store_scope import DEMO_STORE_CATEGORY
    except ImportError:
        try:
            from stores.store_scope import DEMO_STORE_CATEGORY
        except ImportError:
            DEMO_STORE_CATEGORY = {}

    seller_chunks = [c for c in seller_chunks if chunk_matches_shop(c)]
    seller_titles = {
        c.splitlines()[0].lstrip("# ").strip().lower()
        for c in seller_chunks
        if c.startswith("##")
    }

    use_seed = True
    if store_id and store_id not in DEMO_STORE_CATEGORY:
        use_seed = False
    # Seller role managing their shop: still allow seed for demo only

    merged: list[str] = []
    if use_seed:
        merged = [
            c
            for c in seed_chunks
            if _chunk_visible(c)
            and c.splitlines()[0].lstrip("# ").strip().lower() not in seller_titles
        ]
    merged.extend(seller_chunks)
    return merged


def _score_chunk(query: str, chunk: str, intent: Optional[dict] = None) -> int:
    q_raw = query.lower().strip()
    q_tokens = _normalize_query_tokens(q_raw)
    if not q_tokens and len(q_raw) < 3:
        return 0
    c_lower = chunk.lower()
    c_compact = re.sub(r"[^a-z0-9]+", "", c_lower)
    score = 0
    for t in q_tokens:
        if len(t) <= 2:
            continue
        if re.search(rf"\b{re.escape(t)}\b", c_lower):
            score += 1
        elif "-" in t and t.replace("-", "") in c_compact:
            score += 2
        elif len(t) > 3 and t in c_compact:
            score += 1
    title = chunk.splitlines()[0].lstrip("# ").strip().lower() if chunk.startswith("##") else ""
    title_compact = re.sub(r"[^a-z0-9]+", "", title)
    if q_raw and (q_raw in title or q_raw in c_lower):
        score += 5
    if title and (title in q_raw or q_raw == title):
        score += 8
    # shirts / tshirts ↔ t-shirt / tee
    for t in q_tokens:
        if t in ("shirt", "shirts", "tee", "tshirt", "t-shirt") and (
            "shirt" in title_compact or "tee" in title_compact or "tshirt" in title_compact
        ):
            score += 10
            break
    if score > 0 and "seller_listed" in c_lower:
        score += 3  # prefer live shop listings

    intent = intent or {}
    domain = _chunk_domain(chunk)
    audience = _chunk_audience(chunk)

    # Hard domain filters — stop earrings showing for menswear, etc.
    if intent.get("jewellery") and not intent.get("apparel"):
        if domain in ("apparel", "skincare"):
            return 0
        if domain != "jewellery" and not _contains_marker(c_lower, _JEWELLERY_MARKERS):
            return 0
        if domain == "jewellery" or _contains_marker(title, _JEWELLERY_MARKERS):
            score += 5
    if intent.get("apparel") and not intent.get("jewellery"):
        if domain == "jewellery":
            return 0
        if domain == "skincare":
            return 0
        if domain == "apparel":
            score += 4
        for garment in ("short", "shorts", "shirt", "tee", "tshirt", "t-shirt", "chino", "hoodie", "jacket"):
            if garment in q_tokens and (
                garment in c_lower or garment.replace("-", "") in c_compact
            ):
                score += 8
    if intent.get("skincare") and not intent.get("apparel"):
        if domain == "jewellery":
            return 0
        if domain == "apparel":
            return 0
        if domain == "skincare":
            score += 6
    if intent.get("men") and not intent.get("jewellery"):
        if domain == "jewellery":
            return 0
        if audience == "women":
            return 0
        if domain == "apparel" or audience in ("men", "unisex", "all"):
            score += 3
    if intent.get("women") and domain == "jewellery":
        score += 3

    return score


def _query_focus_terms(q_intent, query: str) -> set[str]:
    """Buyer-facing terms that must ground a 'hit' (ignore store-domain filler)."""
    terms: set[str] = set()
    raw = (query or "").lower()
    terms.update(t for t in re.findall(r"[a-z0-9]+", raw) if len(t) > 2 and t not in _STOPWORDS)
    if q_intent is not None:
        for val in (
            getattr(q_intent, "corrected", None),
            *(getattr(q_intent, "product_types", None) or []),
            *(getattr(q_intent, "attributes", None) or []),
            *(getattr(q_intent, "search_terms", None) or []),
        ):
            terms.update(
                t
                for t in re.findall(r"[a-z0-9]+", str(val or "").lower())
                if len(t) > 2 and t not in _STOPWORDS
            )
    # Store domain words alone must not count as a product match
    noise = {
        "handicraft",
        "handicrafts",
        "apparel",
        "apparels",
        "clothing",
        "skincare",
        "jewellery",
        "jewelry",
        "jewelery",
        "product",
        "products",
        "item",
        "items",
        "store",
        "shop",
        "buy",
        "want",
        "need",
        "looking",
        "show",
        "find",
    }
    return {t for t in terms if t not in noise}


def _chunk_grounded_in_query(chunk: str, focus_terms: set[str]) -> bool:
    """True when the chunk mentions at least one real query term (not just domain)."""
    if not focus_terms:
        return True
    c_lower = (chunk or "").lower()
    title = chunk.splitlines()[0].lstrip("# ").strip().lower() if chunk.startswith("##") else ""
    for t in focus_terms:
        if len(t) <= 2:
            continue
        if re.search(rf"\b{re.escape(t)}\b", title) or re.search(rf"\b{re.escape(t)}\b", c_lower):
            return True
        if len(t) > 3 and t in re.sub(r"[^a-z0-9]+", "", title):
            return True
    return False


async def search_kb(query: str) -> str:
    """Search the store knowledge base for product details, pricing, ingredients, or sizing.

    You MUST call this before answering any product, inventory, price, size chart,
    ingredient, dimension, materials, care, shipping, or warranty question.
    Never invent product specs. Covers handicrafts, apparel, and skincare.

    Args:
        query: Natural-language product question or keywords (e.g. "terracotta vase
            height", "linen shirt sizes", "vitamin C serum ingredients").

    Returns:
        Matching product document excerpt(s) from the knowledge base, or a
        message that nothing matched so you can ask a clarifying question.
    """
    if not query or not str(query).strip():
        return "Error: query is required to search the knowledge base."

    query = str(query).strip()

    # 1) Understand intent (category / product type / audience) BEFORE search
    try:
        try:
            from commerce.query_understand import (
                understand_query,
                build_search_wrapper,
                intent_to_score_flags,
                format_intent_header,
                score_boost_for_intent,
            )
        except ImportError:
            from commerce.query_understand import (
                understand_query,
                build_search_wrapper,
                intent_to_score_flags,
                format_intent_header,
                score_boost_for_intent,
            )
        q_intent = await understand_query(query)
        search_query = build_search_wrapper(q_intent)
        intent = intent_to_score_flags(q_intent)
        # Merge legacy token intent so older markers still help
        legacy = _detect_intent(q_intent.corrected or query)
        for k, v in legacy.items():
            intent[k] = bool(intent.get(k) or v)
        intent_header = format_intent_header(q_intent)
    except Exception as exc:
        q_intent = None
        intent = _detect_intent(query)
        search_query = _expand_query(query)
        intent_header = f"[QUERY INTENT | fallback=legacy | err={exc}]"
        score_boost_for_intent = None  # type: ignore

    chunks = _load_kb_chunks(mode="auto")
    if not chunks:
        return "Error: knowledge base is empty."

    def _rank_score(c: str) -> int:
        base = _score_chunk(search_query, c, intent)
        if q_intent is not None and score_boost_for_intent is not None:
            boost = score_boost_for_intent(c, q_intent)
            if boost <= -100:
                return 0
            base += boost
        return base

    ranked = sorted(
        ((_rank_score(c), c) for c in chunks),
        key=lambda x: x[0],
        reverse=True,
    )
    # Require a real match — score 1 is often a weak token overlap.
    # Also drop domain-prior-only hits (e.g. every handicraft scoring ~11 for
    # "quantum flux capacitor") so correlation / miss handling can run.
    focus_terms = _query_focus_terms(q_intent, query)
    hits = [
        c
        for score, c in ranked
        if score >= 2 and _chunk_grounded_in_query(c, focus_terms)
    ][:5]

    store_id = None
    try:
        from stores.store_scope import get_current_store_id, resolve_store_id
        store_id = get_current_store_id() or resolve_store_id()
    except Exception:
        store_id = None

    if not hits:
        titles = [c.splitlines()[0].lstrip("# ").strip() for c in chunks if c.startswith("##")]
        # Auto-record for buyer shop queries so seller inbox never depends on the LLM
        try:
            try:
                from stores.store_scope import get_current_role, resolve_store_id, get_current_session_id
                from stores.store_registry import add_store_query
            except ImportError:
                from stores.store_scope import get_current_role, resolve_store_id, get_current_session_id
                from stores.store_registry import add_store_query
            if (get_current_role() or "") == "buyer":
                sid = resolve_store_id() or store_id
                sess = get_current_session_id() or ""
                if sid:
                    add_store_query(
                        sid,
                        query,
                        session_id=sess,
                        notes="auto: no catalog match from search_kb",
                    )
        except Exception:
            pass

        # Correlation fallback: related in-stock items when the exact ask is missing
        related_block = ""
        try:
            try:
                from catalog.boutique_catalog import format_tiles_block, parse_kb_products
                from commerce.product_recommendations import enrich_as_tiles, related_for_miss
            except ImportError:
                from catalog.boutique_catalog import format_tiles_block, parse_kb_products
                from commerce.product_recommendations import enrich_as_tiles, related_for_miss
            catalog = parse_kb_products()
            related = related_for_miss(
                q_intent,
                catalog,
                store_id=store_id,
                limit=3,
            )
            related_tiles = enrich_as_tiles(related)
            if related_tiles:
                related_block = (
                    "\n\nCORRELATED ALTERNATIVES (exact item missing — show these):\n"
                    "Tell the customer you noted their request for the owner, AND that "
                    "these related items are available. Start the product line with "
                    "'You can also look at…' then end with this exact TILES block:\n"
                    + format_tiles_block(related_tiles)
                )
        except Exception:
            related_block = ""

        if related_block:
            return (
                f"{intent_header}\n\n"
                "No strong KB match for that exact query. We do not currently stock that exact item. "
                "You MUST call log_shop_request with the customer's requested item name "
                "(and store_id from the SYSTEM NOTE) so the store owner can see it. "
                "Then show the correlated alternatives below — do NOT invent other products.\n"
                f"{related_block}"
            )

        return (
            f"{intent_header}\n\n"
            "No strong KB match for that query. We do not currently stock this item. "
            "You MUST call log_shop_request with the customer's requested item name "
            "(and store_id from the SYSTEM NOTE) so the store owner can see it. "
            "Tell the customer you've noted their request and the owner will follow up. "
            "Do NOT show unrelated product TILES. "
            "Available products: "
            + ", ".join(titles[:40])
            + ("…" if len(titles) > 40 else "")
            + "."
        )

    body = (
        f"{intent_header}\n\n"
        "KNOWLEDGE BASE RESULTS (matched after intent wrapper):\n\n"
        + "\n\n---\n\n".join(hits)
    )

    # Attach IMAGE + TILES metadata (from Pinterest fetch manifest) when available
    try:
        try:
            from catalog.boutique_catalog import enrich_product, format_tiles_block, parse_kb_products
            from commerce.product_recommendations import association_upsells, enrich_as_tiles
        except ImportError:
            from catalog.boutique_catalog import enrich_product, format_tiles_block, parse_kb_products
            from commerce.product_recommendations import association_upsells, enrich_as_tiles

        hit_names = {
            h.splitlines()[0].lstrip("# ").strip().lower()
            for h in hits
            if h.startswith("##")
        }
        catalog = parse_kb_products()
        primary: list[dict] = []
        for p in catalog:
            if p["name"].lower() in hit_names:
                primary.append(enrich_product(p))

        upsells = association_upsells(
            primary,
            catalog,
            store_id=store_id,
            limit=2,
        )
        upsell_tiles = enrich_as_tiles(upsells)

        # Keep primary first; cap total cards so the UI stays scannable
        tiles = primary[:4]
        primary_skus = {
            str(t.get("sku") or "").upper()
            for t in tiles
            if t.get("sku")
        }
        for t in upsell_tiles:
            sku = str(t.get("sku") or "").upper()
            if sku and sku in primary_skus:
                continue
            tiles.append(t)
            if len(tiles) >= 5:
                break

        if tiles:
            lines = ["", "PRODUCT MEDIA (use these exact img/url values in TILES):"]
            for t in tiles:
                lines.append(
                    f"- {t['name']} | sku={t['sku']} | img={t.get('img') or '(missing — run fetch_boutique_images.py)'} "
                    f"| link={t.get('url') or ''}"
                )
            if upsell_tiles:
                names = ", ".join(str(t.get("name") or "") for t in upsell_tiles if t.get("name"))
                lines.append("")
                lines.append(
                    "ASSOCIATION UPSELLS (bought/looked-with complementary items): "
                    f"{names}. After the main picks, add one short sentence starting with "
                    "'You can also look at…' covering these upsells. Include ALL tiles below "
                    "in one TILES block (primary + upsells)."
                )
            lines.append("")
            lines.append(
                "When showing these products to the customer, end your reply with this exact TILES block "
                "(do not invent img or url):"
            )
            lines.append(format_tiles_block(tiles))
            body += "\n".join(lines)
    except Exception:
        pass

    return body


async def get_contact(session_id: str) -> str:
    """Load this customer's CRM contact record for the current chat session.

    Call near the start of a conversation or when you need their current
    support/lead status. Use the exact session_id from the SYSTEM NOTE.

    Args:
        session_id: Exact session_id from the SYSTEM NOTE in the user message.

    Returns:
        A short summary of lead_status and basic profile fields.
    """
    if not session_id or not str(session_id).strip():
        return "Error: session_id is required."

    session_id = str(session_id).strip()
    contact = await get_or_create_contact(session_id)

    return (
        f"session_id: {contact.session_id}\n"
        f"lead_status: {contact.lead_status}\n"
        f"name: {contact.name or '(not set)'}\n"
        f"email: {contact.email or '(not set)'}\n"
        f"phone: {contact.phone or '(not set)'}"
    )


async def update_contact(session_id: str, new_status: str) -> str:
    """Update the customer's CRM lead_status for this chat session.

    Use when the customer's stage changes (interested in a product, order
    pending, issue resolved, etc.). Use escalate_to_human instead when they
    ask for the owner or are angry — that tool sets requires_human.

    Args:
        session_id: Exact session_id from the SYSTEM NOTE.
        new_status: New status such as interested, order_pending, order_placed,
            resolved, or contacted.

    Returns:
        Confirmation of the updated status, or an error for invalid values.
    """
    if not session_id or not str(session_id).strip():
        return "Error: session_id is required."
    if not new_status or not str(new_status).strip():
        return "Error: new_status is required."

    session_id = str(session_id).strip()
    new_status = str(new_status).strip().lower().replace(" ", "_")

    if new_status not in ALLOWED_STATUSES:
        allowed = ", ".join(sorted(ALLOWED_STATUSES))
        return f"Error: invalid status '{new_status}'. Allowed: {allowed}."

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Contact).where(Contact.session_id == session_id))
        contact = result.scalar_one_or_none()
        if contact is None:
            contact = Contact(
                session_id=session_id,
                lead_status=new_status,
                created_at=_utcnow(),
                updated_at=_utcnow(),
            )
            db.add(contact)
        else:
            contact.lead_status = new_status
            contact.updated_at = _utcnow()
        await db.commit()

    return f"Contact session_id={session_id} updated to status '{new_status}'."


async def create_followup(session_id: str, note: str) -> str:
    """Create an owner follow-up reminder as a private CRM note.

    Use when you need the store owner to email, ship, or personally follow up
    later (order confirmation questions, custom requests, restock promises).
    Do not tell the customer you are writing an internal note unless asked.

    Args:
        session_id: Exact session_id from the SYSTEM NOTE.
        note: Concise follow-up instruction for the owner (what / when / why).

    Returns:
        Confirmation that the follow-up note was saved.
    """
    if not session_id or not str(session_id).strip():
        return "Error: session_id is required."
    if not note or not str(note).strip():
        return "Error: note is required."

    session_id = str(session_id).strip()
    note = str(note).strip()
    contact = await get_or_create_contact(session_id)

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Contact).where(Contact.session_id == session_id))
        contact = result.scalar_one_or_none()
        if contact is None:
            return f"Error: could not resolve contact for session_id={session_id}."

        db.add(
            Note(
                contact_id=contact.id,
                content=f"[FOLLOW-UP] {note}",
                created_at=_utcnow(),
            )
        )
        contact.updated_at = _utcnow()
        await db.commit()

    return f"Follow-up note saved for owner (session_id={session_id})."


async def log_shop_request(
    session_id: str,
    item_query: str,
    notes: str = "",
    store_id: str = "",
) -> str:
    """Log a customer product request / unanswered question for the shop owner.

    You MUST call this when search_kb finds no match and the customer wants to
    buy something, or when you cannot answer a question from the catalog.
    The store owner sees open requests in their seller Queries inbox.

    Args:
        session_id: Exact session_id from the SYSTEM NOTE.
        item_query: What the customer asked for (e.g. "sunscreen SPF 50").
        notes: Optional context (skin type, budget, urgency).
        store_id: Exact STORE_ID from the SYSTEM NOTE (required for seller inbox).

    Returns:
        Confirmation that the request was saved for the store owner.
    """
    if not session_id or not str(session_id).strip():
        return "Error: session_id is required."
    if not item_query or not str(item_query).strip():
        return "Error: item_query is required."

    session_id = str(session_id).strip()
    item_query = str(item_query).strip()
    notes = str(notes or "").strip()

    messages = []
    try:
        try:
            from stores.store_scope import resolve_store_id
            from stores.store_registry import add_store_query
        except ImportError:
            from stores.store_scope import resolve_store_id
            from stores.store_registry import add_store_query
        sid = resolve_store_id(store_id, session_id)
        if not sid:
            return (
                "Error: store_id missing. Pass STORE_ID from the SYSTEM NOTE "
                "so the seller can see this query."
            )
        entry = add_store_query(sid, item_query, session_id=session_id, notes=notes)
        messages.append(f"Saved to store query inbox as {entry['id']} (store={sid}).")
    except Exception as e:
        messages.append(f"(file inbox note: {e})")

    try:
        row = await _log_shop_request(session_id, item_query, notes)
        messages.append(f"CRM request #{row.id} saved.")
    except Exception as e:
        if not any("Saved to store query" in m for m in messages):
            return f"Error saving shop request: {e}"
        messages.append(f"(CRM note: {e})")

    return (
        " ".join(messages)
        + f" Noted for owner: '{item_query}'. Tell the customer the owner will follow up."
    )


async def escalate_to_human(session_id: str, reason: str) -> str:
    """Escalate this conversation to the store owner / human agent.

    You MUST call this when the customer is angry, makes a complaint that needs
    the owner, asks to speak to a human/owner/manager, or reports a safety or
    payment dispute you cannot resolve from the knowledge base.

    Args:
        session_id: Exact session_id from the SYSTEM NOTE.
        reason: Brief reason for escalation (anger, owner request, unresolved issue).

    Returns:
        Instructions for what to tell the customer, confirming the case was
        flagged as requires_human.
    """
    if not session_id or not str(session_id).strip():
        return "Error: session_id is required."
    if not reason or not str(reason).strip():
        return "Error: reason is required."

    session_id = str(session_id).strip()
    reason = str(reason).strip()

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Contact).where(Contact.session_id == session_id))
        contact = result.scalar_one_or_none()
        if contact is None:
            contact = Contact(
                session_id=session_id,
                lead_status="requires_human",
                created_at=_utcnow(),
                updated_at=_utcnow(),
            )
            db.add(contact)
            await db.flush()
        else:
            contact.lead_status = "requires_human"
            contact.updated_at = _utcnow()

        db.add(
            Note(
                contact_id=contact.id,
                content=f"[ESCALATION] {reason}",
                created_at=_utcnow(),
            )
        )
        await db.commit()

    return (
        "Escalation recorded. Status set to requires_human. "
        "Tell the customer that the store owner has been notified and will follow up shortly. "
        f"Reason logged: {reason}"
    )
