"""Follow-ups that reference items from the previous assistant message — exact set only."""

from __future__ import annotations

import html
import re
from typing import Optional

try:
    from .product_matcher import find_products_by_mention
    from .session_commerce import parse_tiles_from_text
except ImportError:
    from product_matcher import find_products_by_mention
    from session_commerce import parse_tiles_from_text

DESCRIBE_PRIOR_RE = re.compile(
    r"\b("
    r"describe (each of )?(them|those|these|the ones|the ones you mentioned|the ones you (showed|listed|suggested))|"
    r"tell me more about (them|those|these|each|the ones|that|it)|"
    r"more (about|on|info on) (them|those|these|each|the ones)|"
    r"explain (them|those|these|each|the ones)|"
    r"details? on (them|those|these|each|the ones)|"
    r"break (them|those|these) down|"
    r"expand on (them|those|these|the ones)|"
    r"each one|each of them|the ones you (mentioned|showed|listed|suggested)|"
    r"what about (them|those|these)"
    r")\b",
    re.IGNORECASE,
)

TABLE_HEADER_SKIP = frozenset({
    "feature", "features", "col1", "col2", "col3", "product", "size", "sizes",
})

_TABLE_BLOCK_RE = re.compile(r"<TABLE>[\s\S]*?</TABLE>", re.IGNORECASE)


def _tv():
    try:
        from .tile_validator import (
            _extract_all_tiles,
            find_catalog_product,
            product_to_tile,
            rebuild_response_with_tiles,
        )
    except ImportError:
        from tile_validator import (
            _extract_all_tiles,
            find_catalog_product,
            product_to_tile,
            rebuild_response_with_tiles,
        )
    return _extract_all_tiles, find_catalog_product, product_to_tile, rebuild_response_with_tiles


def is_describe_prior_items_query(query: str) -> bool:
    """User wants detail on items from the previous assistant reply — not new picks."""
    q = query.strip()
    if not q:
        return False
    if DESCRIBE_PRIOR_RE.search(q):
        return True
    if re.search(r"\b(describe|detail|expand)\b", q, re.IGNORECASE) and re.search(
        r"\b(them|those|these|each|ones|that)\b", q, re.IGNORECASE
    ):
        return True
    return False


def _last_assistant_content(conversation_history: dict, session_id: str) -> str:
    for msg in reversed(conversation_history.get(session_id, [])):
        if msg.get("role") == "assistant":
            return msg.get("content", "") or ""
    return ""


def _products_in_text_order(text: str, max_results: int = 10) -> list[dict]:
    """Catalog products mentioned in text, in order of first appearance."""
    text_l = text.lower()
    hits: list[tuple[int, dict]] = []
    seen: set[str] = set()

    for card in find_products_by_mention(text, max_results=20):
        name = str(card.get("name", ""))
        pos = text_l.find(name.lower())
        if pos < 0:
            for token in re.findall(r"[a-z0-9]+", name.lower()):
                if len(token) >= 5:
                    m = re.search(rf"\b{re.escape(token)}\b", text_l)
                    if m:
                        pos = m.start()
                        break
        if pos >= 0 and card.get("id") not in seen:
            seen.add(str(card.get("id")))
            hits.append((pos, card))

    hits.sort(key=lambda x: x[0])
    return [card for _, card in hits[:max_results]]


def _table_product_names(text: str) -> list[str]:
    names: list[str] = []
    for block in _TABLE_BLOCK_RE.finditer(text):
        for th in re.finditer(r"<th[^>]*>([^<]+)</th>", block.group(0), re.IGNORECASE):
            label = th.group(1).strip()
            if label and label.lower() not in TABLE_HEADER_SKIP:
                names.append(label)
    return names


def get_prior_reference_items(
    conversation_history: dict,
    session_id: str,
) -> list[dict]:
    """
    Products from the most recent assistant message — tiles, table columns, or names in text.
  Order preserved. Empty if nothing to reference.
    """
    content = _last_assistant_content(conversation_history, session_id)
    if not content:
        return []

    extract_all, find_catalog, to_tile, _ = _tv()
    tiles = extract_all(content)
    if not tiles:
        tiles = parse_tiles_from_text(content)

    if tiles:
        out: list[dict] = []
        seen: set[str] = set()
        for tile in tiles:
            pid = str(tile.get("id", ""))
            if pid and pid not in seen:
                seen.add(pid)
                product = find_catalog(str(tile.get("name", "")))
                out.append(to_tile(product) if product else dict(tile))
        if out:
            return out

    ordered: list[dict] = []
    seen_ids: set[str] = set()

    for name in _table_product_names(content):
        product = find_catalog(name)
        if product:
            pid = str(product["id"])
            if pid not in seen_ids:
                seen_ids.add(pid)
                ordered.append(to_tile(product))

    for card in _products_in_text_order(content, max_results=10):
        pid = str(card.get("id", ""))
        if pid and pid not in seen_ids:
            seen_ids.add(pid)
            product = find_catalog(str(card.get("name", "")))
            ordered.append(to_tile(product) if product else dict(card))

    return ordered


def _why_fits(tile: dict) -> str:
    features = tile.get("features") or []
    if features:
        return str(features[0])[:48]
    desc = str(tile.get("description", "")).strip()
    if desc:
        return desc[:48]
    tag = str(tile.get("tag", "")).strip()
    return tag[:48] if tag else "Solid pick"


def _key_feature(tile: dict) -> str:
    features = tile.get("features") or []
    if len(features) > 1:
        return f"{features[0]} — {features[1]}"[:56]
    if features:
        return str(features[0])[:56]
    return str(tile.get("description", ""))[:56] or "—"


def enrich_tile_description(tile: dict) -> dict:
    """One tight line for tile UI."""
    _, find_catalog, to_tile, _ = _tv()
    product = find_catalog(str(tile.get("name", "")))
    base = to_tile(product) if product else dict(tile)
    why = _why_fits(base)
    base["description"] = why
    feats = base.get("features") or []
    if feats:
        base["features"] = [str(f)[:32] for f in feats[:2]]
    return base


def _build_describe_table(tiles: list[dict]) -> str:
    rows: list[str] = []
    for tile in tiles:
        name = html.escape(str(tile.get("name", "")))
        feat = html.escape(_key_feature(tile))
        why = html.escape(_why_fits(tile))
        rows.append(f"<tr><td>{name}</td><td>{feat}</td><td>{why}</td></tr>")
    return (
        "<table>"
        "<thead><tr><th>Product</th><th>Key feature</th><th>Why it fits</th></tr></thead>"
        f"<tbody>{''.join(rows)}</tbody>"
        "</table>"
    )


def build_describe_prior_response(prior_items: list[dict], user_query: str = "") -> str:
    """TABLE + TILES for exactly the prior items — no extras."""
    _, _, _, rebuild = _tv()
    enriched = [enrich_tile_description(t) for t in prior_items]
    table_block = f"<TABLE>\n{_build_describe_table(enriched)}\n</TABLE>"
    return rebuild(
        table_block,
        enriched,
        summary_mode=False,
        user_query=user_query,
        prior_items=True,
    )


def try_describe_prior_items_response(
    user_query: str,
    session_id: str,
    conversation_history: dict,
) -> Optional[str]:
    """Deterministic answer when user references prior items. None → use LLM + sanitize."""
    if not is_describe_prior_items_query(user_query):
        return None
    prior = get_prior_reference_items(conversation_history, session_id)
    if not prior:
        return None
    return build_describe_prior_response(prior, user_query)


def prior_items_context_hint(
    conversation_history: dict,
    session_id: str,
) -> str:
    prior = get_prior_reference_items(conversation_history, session_id)
    if not prior:
        return ""
    names = ", ".join(str(t.get("name", "")) for t in prior if t.get("name"))
    return (
        f"[PRIOR ITEMS ONLY — describe exactly these, no other products: {names}. "
        "TABLE or TILES with one line each. Do not swap or add items.]"
    )
