"""One human line before every tile set or table — never silent visual drops."""

from __future__ import annotations

import random
import re
from typing import Optional

try:
    from .product_matcher import is_comparison_query, needs_full_information, is_best_recommendation_query
    from .prior_items import is_describe_prior_items_query
except ImportError:
    from product_matcher import is_comparison_query, needs_full_information, is_best_recommendation_query
    from prior_items import is_describe_prior_items_query


def _has_substance(text: str) -> bool:
    """True if visible text is a real intro line, not empty noise."""
    t = text.strip()
    if not t:
        return False
    words = [w for w in re.split(r"\s+", t) if w]
    return len(words) >= 2


def _acknowledge_query(user_query: str) -> Optional[str]:
    q = user_query.lower()
    if is_best_recommendation_query(user_query):
        if re.search(r"\b(son|daughter|kid|child|children|boys?|girls?)\b", q):
            return "Depends what your kid needs — if I had to pick:"
        return "Depends what you need — if I had to pick:"
    if re.search(r"\b(son|daughter|kid|child|children|boys?|girls?)\b", q):
        return "For your kid — quick take:"
    if re.search(r"\b(wife|husband|partner|mom|dad|father|mother)\b", q):
        return "For them, quick breakdown."
    if "running" in q or "runner" in q:
        return "Here's what we got for running."
    if "hik" in q:
        return "Solid picks for hiking."
    if "gym" in q or "training" in q:
        return "Here's what works for training."
    if "football" in q or "soccer" in q:
        return "Here's what we've got pitch-side."
    if "gift" in q:
        return "Gift picks — check these out."
    if is_comparison_query(user_query) and not is_best_recommendation_query(user_query):
        return "Here's how they stack up."
    if is_describe_prior_items_query(user_query):
        return "Quick breakdown on each."
    if re.search(r"\b(show me|find|looking for)\b", q):
        return "Alright, check these out."
    return None


def pick_visual_intro(
    user_query: str = "",
    *,
    tile_count: int = 0,
    has_table: bool = False,
    prior_items: bool = False,
) -> str:
    """One short natural line before tiles and/or table."""
    if prior_items:
        return _acknowledge_query(user_query) or "Quick breakdown on each."

    custom = _acknowledge_query(user_query)
    if custom and has_table and tile_count == 0:
        return custom
    if custom and has_table and tile_count > 0:
        return custom.replace("stack up", "stack up — and here they are").replace(
            "breakdown", "breakdown — tiles below"
        ) if "—" not in custom else custom

    if has_table and tile_count > 0:
        pool = (
            "Here's how they stack up — check the tiles too.",
            "Quick breakdown below.",
            "Here's the diff — products under that.",
        )
        return random.choice(pool)

    if has_table:
        pool = (
            "Here's how they stack up.",
            "Quick breakdown.",
            "Here's the diff.",
        )
        return custom or random.choice(pool)

    if tile_count >= 4:
        pool = (
            "Here's what we got.",
            "Alright, check these out.",
            "These are your best bets.",
            "Yeah, here you go.",
        )
        return custom or random.choice(pool)

    if tile_count > 0:
        pool = (
            "Here you go.",
            "Check these out.",
            "These fit what you asked.",
        )
        return custom or random.choice(pool)

    return custom or "Here you go."


def ensure_complete_sentences(visible: str) -> str:
    """Drop truncated trailing fragments before tiles/tables."""
    visible = visible.strip()
    if not visible:
        return visible

    visible = re.sub(
        r"\s+(The|A|An|Let me know if you|Here's the|Here is the)\s*$",
        "",
        visible,
        flags=re.IGNORECASE,
    )

    if visible and visible[-1] not in ".!?":
        parts = re.split(r"(?<=[.!?])\s+", visible)
        if len(parts) > 1 and parts[-1] and parts[-1][-1] not in ".!?":
            visible = " ".join(parts[:-1]).strip()
        else:
            last_period = max(visible.rfind("."), visible.rfind("!"), visible.rfind("?"))
            if last_period > 0:
                visible = visible[: last_period + 1].strip()

    return visible.strip()


def ensure_visual_handoff(
    visible: str,
    user_query: str = "",
    *,
    tile_count: int = 0,
    has_table: bool = False,
    prior_items: bool = False,
) -> str:
    """Guarantee one intro line before any tiles or table."""
    if tile_count <= 0 and not has_table:
        return visible.strip()

    if _has_substance(visible):
        return ensure_complete_sentences(visible.strip())

    intro = pick_visual_intro(
        user_query,
        tile_count=tile_count,
        has_table=has_table,
        prior_items=prior_items,
    )
    return ensure_complete_sentences(intro)
