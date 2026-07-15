"""Classify each user turn before applying context — fresh topic vs filter add vs cart."""

from __future__ import annotations

import re

try:
    from .product_matcher import (
        NEW_TOPIC_RE,
        find_products_by_mention,
        is_best_recommendation_query,
        is_comparison_query,
        is_browse_refinement,
    )
    from .browse_filters import is_filter_addition_follow_up
    from .session_commerce import ADD_TO_CART_RE, CART_VIEW_RE, PURCHASE_RE
except ImportError:
    from product_matcher import (
        NEW_TOPIC_RE,
        find_products_by_mention,
        is_best_recommendation_query,
        is_comparison_query,
        is_browse_refinement,
    )
    from browse_filters import is_filter_addition_follow_up
    from session_commerce import ADD_TO_CART_RE, CART_VIEW_RE, PURCHASE_RE

SHOW_EXPLICIT_RE = re.compile(
    r"\b(show me|show us|find me|looking for|i want to see|pull up|bring up)\b",
    re.IGNORECASE,
)
FILTER_ONLY_RE = re.compile(
    r"^(and\s+)?("
    r"(anything|any|something)\s+in\s+\w+|"
    r"in\s+(black|white|red|blue|grey|gray|green|pink|olive|navy|yellow)|"
    r"(under|below|around|less than|max)\s*₹?\s*[\d,]+\s*k?|"
    r"any\s+cheaper|cheaper\s+options?|more affordable|same\s+in\s+\w+"
    r")\s*[?.!]*$",
    re.IGNORECASE,
)


def is_filter_only_follow_up(query: str) -> bool:
    """Short message that only stacks a filter on the current browse thread."""
    q = query.strip()
    if not q:
        return False
    if FILTER_ONLY_RE.match(q):
        return True
    if is_filter_addition_follow_up(q) and len(q.split()) <= 8:
        if not SHOW_EXPLICIT_RE.search(q) and not find_products_by_mention(q, max_results=1):
            if not NEW_TOPIC_RE.search(q) or re.search(
                r"\b(in|under|below|cheaper|for women|for men|for kids)\b", q, re.I
            ):
                return True
    if is_browse_refinement(q) and len(q.split()) <= 6:
        if not SHOW_EXPLICIT_RE.search(q) and not find_products_by_mention(q, max_results=1):
            return True
    return False


def is_new_topic_instruction(query: str) -> bool:
    """
    Fresh instruction — do not merge prior browse thread or filters.
    Exceptions: filter-only follow-ups handled separately.
    """
    q = query.strip()
    if not q:
        return False
    if is_filter_only_follow_up(q):
        return False
    if ADD_TO_CART_RE.search(q) or CART_VIEW_RE.search(q) or PURCHASE_RE.search(q):
        return False
    if is_comparison_query(q):
        return True
    if is_best_recommendation_query(q):
        return True
    if SHOW_EXPLICIT_RE.search(q):
        return True
    if find_products_by_mention(q, max_results=1):
        return True
    if NEW_TOPIC_RE.search(q):
        return True
    return False


def classify_user_intent(query: str) -> str:
    q = query.strip()
    if ADD_TO_CART_RE.search(q) or CART_VIEW_RE.search(q) or PURCHASE_RE.search(q):
        return "cart"
    if is_comparison_query(q):
        return "comparison"
    if is_best_recommendation_query(q):
        return "best_pick"
    if is_filter_only_follow_up(q):
        return "filter_add"
    if is_new_topic_instruction(q):
        return "new_topic"
    return "continue"
