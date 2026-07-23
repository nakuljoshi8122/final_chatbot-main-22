"""Force seller Assist replies into short prose + product tiles (no catalog dumps)."""

from __future__ import annotations

import json
import re
from typing import Any, Optional

TILES_RE = re.compile(r"<TILES>([\s\S]*?)</TILES>", re.IGNORECASE)
# Model-written product spam: bullets / markdown names with prices / stock.
DUMP_LINE_RE = re.compile(
    r"(?im)^\s*(?:[-*•]|\d+[.)])\s*(?:\*\*[^*]+\*\*|[A-Z][^:\n]{2,60})\s*"
    r"(?:[-–—:]\s*)?(?:\$\s*\d|\d+\s*(?:in stock|units?|left))",
)
PRICE_HIT_RE = re.compile(r"\$\s*\d+(?:\.\d+)?")
STOCK_HIT_RE = re.compile(r"\b\d+\s*(?:in stock|units?|left)\b", re.I)
MD_BOLD_PRODUCT_RE = re.compile(r"\*\*[^*]{3,80}\*\*\s*[-–—].*?\$\s*\d")
INBOX_HINT_RE = re.compile(
    r"(?i)\b(open quer|buyer (?:asked|question)|inbox|q_\w+|draft for \[|"
    r"draft_buyer|answer_buyer|\[q_)",
)


def _tile_count(tiles_block: str) -> int:
    try:
        raw = TILES_RE.search(tiles_block or "")
        if not raw:
            return 0
        data = json.loads(raw.group(1))
        if isinstance(data, list):
            return len(data)
        if isinstance(data, dict) and data.get("name"):
            return 1
    except Exception:
        return 0
    return 0


def _looks_like_product_dump(prose: str) -> bool:
    """True when the model rewrote inventory as a text catalog."""
    text = prose or ""
    if not text.strip():
        return False
    # Buyer inbox lists are allowed text — never treat as product dumps.
    if INBOX_HINT_RE.search(text) and len(PRICE_HIT_RE.findall(text)) < 3:
        return False
    dump_lines = DUMP_LINE_RE.findall(text)
    price_hits = PRICE_HIT_RE.findall(text)
    stock_hits = STOCK_HIT_RE.findall(text)
    bold_priced = MD_BOLD_PRODUCT_RE.findall(text)
    # Dense name–price spam in one paragraph (common in the screenshots).
    inline_items = len(re.findall(r"\*\*[^*]+\*\*\s*[-–—]", text))
    if len(dump_lines) >= 2:
        return True
    if len(bold_priced) >= 2:
        return True
    if inline_items >= 3 and len(price_hits) >= 3:
        return True
    if len(price_hits) >= 4 and len(stock_hits) >= 2:
        return True
    if len(price_hits) >= 5:
        return True
    # Long reply that keeps repeating "$" + stock wording.
    if len(text) > 280 and len(price_hits) >= 3:
        return True
    return False


def _looks_like_inbox_reply(prose: str) -> bool:
    text = prose or ""
    if INBOX_HINT_RE.search(text):
        return True
    # Numbered questions without prices — typical open-query listing.
    numbered = re.findall(r"(?m)^\s*\d+[.)]\s+\S+", text)
    if len(numbered) >= 1 and len(PRICE_HIT_RE.findall(text)) == 0:
        return True
    return False


def _default_tile_caption(n: int) -> str:
    if n <= 0:
        return "Tap a card for details."
    if n == 1:
        return "Here's the item — tap the card to view or edit."
    return f"{n} items — tap a card to view or edit."


def _shorten_safe_prose(prose: str, *, max_chars: int = 220) -> str:
    """Keep at most ~2 short sentences; drop trailing product-list fragments."""
    text = re.sub(r"[ \t]+", " ", (prose or "").strip())
    if not text:
        return ""
    # Only cut at list markers that look like priced products, not inbox Qs.
    text = re.split(
        r"\s+[-*•]\s+\*?\*?[^*\n]{0,40}\$?\d",
        text,
        maxsplit=1,
    )[0].strip(" :-")
    parts = re.split(r"(?<=[.!?])\s+", text)
    kept: list[str] = []
    for p in parts:
        if _looks_like_product_dump(p):
            break
        kept.append(p)
        if len(" ".join(kept)) >= max_chars or len(kept) >= 2:
            break
    out = " ".join(kept).strip()
    if len(out) > max_chars:
        out = out[: max_chars - 1].rstrip() + "…"
    return out


def _preserve_inbox_prose(prose: str, *, max_chars: int = 1200) -> str:
    """Keep numbered buyer questions readable (newlines OK)."""
    text = (prose or "").strip()
    # Soft-normalize spaces but keep line breaks between questions.
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r"[ \t]{2,}", " ", text)
    if len(text) > max_chars:
        text = text[: max_chars - 1].rstrip() + "…"
    return text


def sanitize_seller_response(text: str) -> str:
    """Collapse catalog text-dumps when product tiles already carry the items.

    Lazy-seller rule: cards show the inventory; prose is only counts / next action
    / things tiles cannot express (buyer questions, pricing tip, errors).
    """
    raw = text or ""
    tiles_match = TILES_RE.search(raw)
    tiles_block = tiles_match.group(0) if tiles_match else ""
    prose = TILES_RE.sub("\n", raw)
    prose = re.sub(r"<TILES>.*$", "\n", prose, flags=re.S | re.I)  # truncated
    # Drop tool meta the model sometimes echoes.
    prose = re.sub(r"(?im)^\s*REPLY RULE:.*?(?:\n|$)", "\n", prose)
    prose = re.sub(r"(?i)REPLY RULE:\s*[^.]*\.\s*", "", prose)
    prose = re.sub(r"(?im)^\s*REDIRECT:.*?(?:\n|$)", "\n", prose)
    prose = re.sub(r"(?im)^\s*OPEN_QUERIES[^\n]*\n?", "", prose)
    prose = prose.strip()

    if tiles_block:
        # Flatten for dump detection beside cards.
        flat = re.sub(r"\s+", " ", prose).strip()
        n = _tile_count(tiles_block)
        if _looks_like_product_dump(flat) or len(flat) > 260:
            prose = _default_tile_caption(n)
        else:
            prose = _shorten_safe_prose(flat) or _default_tile_caption(n)
        return f"{prose}\n{tiles_block}".strip()

    # No tiles — keep inbox/query replies intact; kill product essays only.
    if _looks_like_product_dump(prose):
        return (
            "I can show those as cards — ask me to show your active items, "
            "drafts, or low stock."
        )
    if _looks_like_inbox_reply(prose):
        return _preserve_inbox_prose(prose)
    flat = re.sub(r"\s+", " ", prose).strip()
    return _shorten_safe_prose(flat, max_chars=320) or flat
