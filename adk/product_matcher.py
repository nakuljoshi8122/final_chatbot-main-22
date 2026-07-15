"""Match user queries to catalog products for instant chat tiles."""

import re
from typing import Optional

try:
    from .adidas_catalog import all_products
except ImportError:
    from adidas_catalog import all_products

GREETING_ONLY = re.compile(
    r"^(hi|hello|hey|hola|namaste|good\s*(morning|afternoon|evening)|what'?s\s*up)[\s!.,?]*$",
    re.IGNORECASE,
)

PRODUCT_SIGNALS = (
    "shoe", "shoes", "sneaker", "footwear", "trainer", "boot", "samba", "ultraboost",
    "shirt", "tee", "hoodie", "jersey", "legging", "pant", "jogger", "apparel", "clothing",
    "football", "running", "basketball", "gym", "training", "hiking", "outdoor", "trek", "trekking", "trail",
    "ball", "backpack", "equipment", "bundle", "kit", "men", "women", "kids", "kid", "buy",
    "show", "find", "looking", "need", "want", "recommend", "suggest", "price", "under",
    "budget", "size", "cricket", "yoga", "swim", "jacket", "shorts", "bra", "socks",
)

REFINEMENT_SIGNALS = (
    "lightweight", "light weight", "light-weight", "waterproof", "water resistant",
    "water-repellent", "cheap", "cheaper", "affordable", "premium", "comfortable",
    "comfy", "breathable", "leather", "suede", "boost", "chunky", "casual", "sporty",
    "gore-tex", "insulated", "warm", "soft", "durable", "fast", "speed",
)

FOLLOW_UP_WORDS = frozenset({
    "ones", "those", "these", "that", "it", "them", "options", "something", "anything",
    "pair", "pairs", "any", "similar", "like", "instead", "rather", "maybe", "also",
})

COMPARE_RE = re.compile(
    r"\b(compare|compared|comparing|comparison|versus|vs\.?|vs\b|"
    r"diff|diffs?|difference|differences|better|worse|which\s+one|between|b/w|b\/w)\b",
    re.IGNORECASE,
)

INFO_QUESTION_RE = re.compile(
    r"\b("
    r"what'?s the difference|difference between|how does|how do|how is|how are|"
    r"what is|what are|why does|why is|why are|explain|tell me about|"
    r"describe|is .+ good for|good for wide|good for flat|good for running|"
    r"does it|do they|can i use|which is better|which one is|pros and cons|"
    r"how .+ work|how .+ works|what makes|what about|any difference|"
    r"materials?|made of|better for|help me (pick|choose|decide)"
    r")\b",
    re.IGNORECASE,
)

FULL_INFO_RE = re.compile(
    r"\b("
    r"what'?s the difference|difference between|how does|how do|how .+ work|how .+ works|"
    r"compare|compared|comparison|versus|vs\.?|which is better|which one is better|"
    r"better for|good for|materials?|made of|explain|tell me about|what makes|"
    r"pros and cons|help me (pick|choose|decide)|any difference|"
    r"why (is|does|are|do)\b|should i (get|buy)|worth it|advise"
    r")\b",
    re.IGNORECASE,
)

BRIEF_FACT_RE = re.compile(
    r"\b(price|cost|how much|what'?s the price|size chart|what size|in stock|available)\b",
    re.IGNORECASE,
)

BEST_REC_RE = re.compile(
    r"\b("
    r"what(?:'?s| is) (?:the )?best|which (?:is )?(?:the )?best|"
    r"the best\b|best overall|best .+ (?:for|overall)|"
    r"recommend the best|pick the best|who(?:'?s| is) the best"
    r")\b",
    re.IGNORECASE,
)

SHOW_EXPLICIT_RE = re.compile(
    r"\b(show me|show us|let me see|can i see|i want to see|i'?d like to see|"
    r"display|pull up|bring up|see the|see those|see some)\b",
    re.IGNORECASE,
)

BUYING_SIGNAL_RE = re.compile(
    r"\b("
    r"buy|purchase|add to cart|add it|add that|i'?ll take|i will take|"
    r"i want|i need|get me|checkout|check out|how much|what'?s the price|"
    r"price of|cost of|order|grab|looking for|find me|recommend me|"
    r"suggest me|under ₹|below ₹|budget of|show me\b"
    r")\b",
    re.IGNORECASE,
)

TABLE_HEADER_SKIP = frozenset({
    "feature", "features", "col1", "col2", "col3", "size", "sizes", "detail", "details",
})

GENERIC_NAME_TOKENS = frozenset({
    "boost", "prime", "adidas", "running", "training", "classic", "original",
    "performance", "sport", "sports", "comfort", "lightweight", "essential",
})

NEW_TOPIC_RE = re.compile(
    r"\b(shoes?|sneakers?|footwear|boots?|cleats?|studs?|trainers?|"
    r"shirt|tee|hoodie|jersey|jacket|leggings?|pants?|joggers?|shorts?|"
    r"ball|backpack|bag|racket|gloves?|equipment)\b",
    re.IGNORECASE,
)

AUDIENCE_KEYWORDS = {
    "men": ("men", "man's", "mens", "male", "guys", "him", "his"),
    "women": ("women", "woman", "womens", "female", "ladies", "her"),
    "kids": ("kids", "kid", "child", "children", "boys", "girls", "junior"),
}

CATEGORY_KEYWORDS = {
    "footwear": ("shoe", "shoes", "sneaker", "footwear", "trainer", "boot", "cleat", "stud"),
    "clothing": ("shirt", "tee", "hoodie", "jersey", "legging", "pant", "jogger", "apparel", "clothing", "bra", "shorts", "jacket"),
    "sports_equipment": ("ball", "backpack", "bag", "mat", "equipment", "shin", "glove", "cap"),
    "bundle": ("bundle", "kit", "pack", "combo"),
}


def is_greeting_only(query: str) -> bool:
    return bool(GREETING_ONLY.match(query.strip()))


def is_feedback_or_complaint(query: str) -> bool:
    """User pushing back on results — should talk, not show more tiles."""
    q = query.lower().strip()
    if re.search(
        r"\b(useless|terrible|awful|bad|hate|hated|don'?t like|do not like|not good|"
        r"not what|wrong|garbage|trash|sucks|nah|no thanks|not interested|"
        r"waste of time|horrible|disappointing|disappointed|meh|ugh|rubbish|"
        r"too expensive|too pricey|not helpful|doesn'?t help)\b",
        q,
    ):
        return True
    if re.search(r"^(no|nope|nah)[\s!.,?]*$", q):
        return True
    return False


def is_conversational_turn(query: str) -> bool:
    """Greetings, thanks, complaints — not a catalog search."""
    q = query.lower().strip()
    if is_greeting_only(q) or is_feedback_or_complaint(q):
        return True
    if re.search(r"\b(thanks|thank you|got it|cool|nice|bye|goodbye)\b", q) and len(q.split()) <= 6:
        return True
    return False


def is_product_related(query: str) -> bool:
    q = query.lower().strip()
    if is_greeting_only(q):
        return False
    if len(q) < 3:
        return False
    return any(signal in q for signal in PRODUCT_SIGNALS)


def is_browse_refinement(query: str) -> bool:
    """Follow-up filters like 'lightweight', 'in black', 'cheaper'."""
    q = query.lower().strip()
    if is_feedback_or_complaint(q):
        return False
    if len(q) < 2:
        return False
    if any(signal in q for signal in REFINEMENT_SIGNALS):
        return True
    if re.search(r"\b(under|below|around|less than|max)\s*₹?\s*[\d,]+", q):
        return True
    if len(q.split()) <= 5 and not NEW_TOPIC_RE.search(q):
        if any(w in q.split() for w in FOLLOW_UP_WORDS):
            return True
    return False


def infer_category_from_query(query: str) -> Optional[str]:
    q = query.lower()
    scores: dict[str, int] = {}
    for cat, keywords in CATEGORY_KEYWORDS.items():
        for k in keywords:
            if k in q:
                scores[cat] = scores.get(cat, 0) + 1
    if not scores:
        return None
    return max(scores, key=scores.get)


def categories_conflict(query_a: str, query_b: str) -> bool:
    cat_a = infer_category_from_query(query_a)
    cat_b = infer_category_from_query(query_b)
    return bool(cat_a and cat_b and cat_a != cat_b)


def merge_browse_queries(base: str, addition: str) -> str:
    return f"{base.strip()} {addition.strip()}".strip()


def is_comparison_query(query: str) -> bool:
    """User is comparing specific products — not a browse or best-pick request."""
    if is_best_recommendation_query(query):
        return False
    return bool(COMPARE_RE.search(query.strip()))


def is_best_recommendation_query(query: str) -> bool:
    """'What is the best…' → angle picks, never a comparison table."""
    q = query.strip()
    if not q:
        return False
    if re.search(r"\b(better|versus|vs\.?|compare|difference between)\b", q, re.IGNORECASE):
        if not BEST_REC_RE.search(q):
            return False
    if BEST_REC_RE.search(q):
        return True
    if re.search(r"\bbest\b", q, re.IGNORECASE) and "?" in q and not COMPARE_RE.search(q):
        return True
    return False


def is_buying_signal(query: str) -> bool:
    """Clear intent to browse, price-check, or purchase."""
    return bool(BUYING_SIGNAL_RE.search(query.strip()))


def is_show_explicit_request(query: str) -> bool:
    return bool(SHOW_EXPLICIT_RE.search(query.strip()))


def needs_full_information(query: str) -> bool:
    """
    User genuinely wants to understand or get advice — warrants a complete answer.
    Default for everything else is sharp summary.
    """
    q = query.strip()
    if not q or is_greeting_only(q) or is_feedback_or_complaint(q):
        return False
    if BRIEF_FACT_RE.search(q) and not FULL_INFO_RE.search(q) and not is_comparison_query(q):
        return False
    if FULL_INFO_RE.search(q):
        return True
    if is_best_recommendation_query(q):
        return True
    if is_comparison_query(q):
        return True
    if re.search(r"\b(which .+ for|recommend .+ for)\b", q, re.IGNORECASE):
        return True
    return False


def get_discussed_product_names(
    conversation_history: dict,
    session_id: str,
    max_names: int = 10,
) -> list[str]:
    """Product names already covered this session — agent should not re-describe."""
    names: list[str] = []
    seen: set[str] = set()
    for msg in conversation_history.get(session_id, []):
        content = msg.get("content", "")
        if not content:
            continue
        for card in find_products_by_mention(content, max_results=6):
            name = str(card.get("name", "")).strip()
            if name and name not in seen:
                seen.add(name)
                names.append(name)
    return names[:max_names]


def is_informational_query(query: str) -> bool:
    """
    Non-shopping exchange — no browse tiles / upsell.
    Includes both full-info and brief factual questions.
    """
    q = query.strip()
    if not q or is_greeting_only(q) or is_feedback_or_complaint(q):
        return False
    if is_buying_signal(q) and not needs_full_information(q):
        return False
    if needs_full_information(q):
        return True
    if BRIEF_FACT_RE.search(q):
        return True
    return False


def informational_allowed_tiles(
    user_query: str,
    response_text: str = "",
    agent_tiles: Optional[list[dict]] = None,
) -> list[dict]:
    """
    Tiles permitted during informational exchanges — usually none.
    Show tiles only when user explicitly asks to see, or names one product.
    """
    agent_tiles = agent_tiles or []
    q = user_query.strip()

    if is_show_explicit_request(q):
        from_mention = find_products_by_mention(
            " ".join([q, response_text, *_extract_table_header_names(response_text)]),
            max_results=3,
        )
        if from_mention:
            return from_mention
        return agent_tiles[:3]

    if is_comparison_query(q):
        return []

    mentioned = find_products_by_mention(q, max_results=5)
    if mentioned:
        return [mentioned[0]]

    return []


def should_use_browse_flow(query: str, previous_browse: str = "") -> bool:
    try:
        from .prior_items import is_describe_prior_items_query
    except ImportError:
        from prior_items import is_describe_prior_items_query
    if is_best_recommendation_query(query):
        return False
    if is_describe_prior_items_query(query):
        return False
    if is_conversational_turn(query):
        return False
    if is_comparison_query(query):
        return False
    # If they mention a product category at all, default to showing tiles.
    if NEW_TOPIC_RE.search(query):
        return True
    if is_informational_query(query):
        return False
    if is_buying_signal(query):
        return True
    if is_show_explicit_request(query):
        return True
    if is_product_related(query):
        return True
    if is_browse_refinement(query) and previous_browse:
        return True
    return False


def _tokenize(query: str) -> list[str]:
    return [t for t in re.findall(r"[a-z0-9]+", query.lower()) if len(t) > 1]


def _haystack(product: dict) -> str:
    parts = [
        product.get("name", ""),
        product.get("category", ""),
        product.get("audience", ""),
        product.get("sport", ""),
        product.get("type", ""),
        " ".join(product.get("tags", [])),
        " ".join(product.get("features", [])),
        " ".join(product.get("items", [])),
    ]
    return " ".join(parts).lower()


def _display_category(product: dict) -> str:
    category = product.get("category", "")
    audience = product.get("audience", "")
    labels = {
        "footwear": "Footwear",
        "clothing": "Apparel",
        "sports_equipment": "Sports Equipment",
        "bundle": "Bundle",
    }
    base = labels.get(category, category.replace("_", " ").title())
    if audience and audience != "unisex":
        return f"{audience.title()}'s {base}"
    return base


def _icon_for(product: dict) -> str:
    category = product.get("category", "")
    sport = str(product.get("sport", product.get("type", ""))).lower()
    if category == "footwear":
        return "footsteps" if "running" in sport else "walk"
    if category == "clothing":
        if "jersey" in sport or "jersey" in _haystack(product):
            return "shirt"
        if "legging" in _haystack(product) or "bra" in _haystack(product):
            return "body"
        return "shirt"
    if category == "bundle":
        return "bag"
    if "football" in _haystack(product):
        return "football"
    if "basketball" in _haystack(product):
        return "basketball"
    if "backpack" in _haystack(product) or "bag" in _haystack(product):
        return "bag"
    return "football"


def _short_phrase(text: str, max_len: int = 48) -> str:
    text = re.sub(r"\s+", " ", str(text).strip())
    if len(text) <= max_len:
        return text
    cut = text[:max_len].rsplit(" ", 1)[0]
    return cut or text[:max_len]


def _description(product: dict) -> str:
    features = product.get("features", [])
    if features:
        first = _short_phrase(features[0], 36)
        if len(features) > 1:
            return f"{first} — {_short_phrase(features[1], 28)}"
        return first
    items = product.get("items", [])
    if items:
        return f"Incl: {', '.join(items[:2])}"
    sport = product.get("sport", product.get("type", ""))
    return f"{sport} gear" if sport else "Adidas gear"


try:
    from .product_images import get_product_image
except ImportError:
    from product_images import get_product_image


def format_product_card(product: dict) -> dict:
    raw_features = product.get("features", product.get("items", []))
    features = [_short_phrase(f, 32) for f in raw_features[:2]]
    return {
        "id": product["id"],
        "name": product["name"],
        "price": product["price"],
        "category": _display_category(product),
        "description": _description(product),
        "features": features,
        "icon": _icon_for(product),
        "img": get_product_image(product),
        "url": f"https://www.adidas.co.in/{re.sub(r'[^a-z0-9]+', '-', product['name'].lower()).strip('-')}",
        "sport": product.get("sport", product.get("type", "")),
        "audience": product.get("audience", "unisex"),
        "sizes": product.get("sizes", []),
        "colors": product.get("colors", []),
    }


def _contains_keyword(text: str, keyword: str) -> bool:
    return re.search(rf"\b{re.escape(keyword)}\b", text) is not None


def score_product(product: dict, query: str, tokens: list[str], category_lock: Optional[str] = None) -> int:
    haystack = _haystack(product)
    score = 0
    q = query.lower()

    if category_lock and product.get("category") != category_lock:
        score -= 25

    for token in tokens:
        if token in haystack:
            score += 2
        if token in product.get("name", "").lower():
            score += 6

    for audience, keywords in AUDIENCE_KEYWORDS.items():
        if any(_contains_keyword(q, k) for k in keywords):
            if product.get("audience") == audience:
                score += 8
            elif product.get("audience") not in (audience, "unisex"):
                score -= 5

    for category, keywords in CATEGORY_KEYWORDS.items():
        if any(k in q for k in keywords):
            if product.get("category") == category:
                score += 7

    if "running" in q and product.get("sport") == "running":
        score += 10
    if any(x in q for x in ("trek", "trekking", "hike", "hiking", "trail")):
        if product.get("sport") == "outdoor" or any(
            x in haystack for x in ("hiking", "trail", "terrex", "outdoor", "gore-tex")
        ):
            score += 14
    if "football" in q and product.get("sport") == "football":
        score += 10
    if "lifestyle" in q and product.get("sport") == "lifestyle":
        score += 10
    if "legging" in q or "leggings" in q:
        if "legging" in haystack:
            score += 12
    if "lightweight" in q or "light weight" in q or "light-weight" in q:
        if any(x in haystack for x in ("lightweight", "light strike", "lightstrike", "ultralight")):
            score += 18
        if product.get("category") == "footwear" and "light" in haystack:
            score += 8
    if "waterproof" in q or "water resistant" in q or "gore-tex" in q:
        if any(x in haystack for x in ("waterproof", "water-repellent", "rain", "gore-tex", "gore tex")):
            score += 15
    if "budget" in q or "cheap" in q or "affordable" in q or "cheaper" in q:
        price_num = int(re.sub(r"[^\d]", "", product.get("price", "0")) or "0")
        if price_num and price_num < 5000:
            score += 6
    price_match = re.search(r"\b(under|below|around|less than|max)\s*₹?\s*([\d,]+)", q)
    if price_match:
        cap = int(re.sub(r"[^\d]", "", price_match.group(2)) or "0")
        price_num = int(re.sub(r"[^\d]", "", product.get("price", "0")) or "0")
        if cap and price_num and price_num <= cap:
            score += 12

    return score


def match_products(
    query: str,
    max_results: int = 4,
    category_lock: Optional[str] = None,
) -> list[dict]:
    lock = category_lock or infer_category_from_query(query)
    if not is_product_related(query) and not is_browse_refinement(query) and not lock:
        return []

    tokens = _tokenize(query)
    scored: list[tuple[int, dict]] = []

    for product in all_products():
        score = score_product(product, query, tokens, category_lock=lock)
        if score > 0:
            scored.append((score, product))

    scored.sort(key=lambda x: x[0], reverse=True)
    top = [p for _, p in scored[:max_results]]

    if not top and (is_product_related(query) or is_browse_refinement(query) or lock):
        for product in all_products():
            if lock and product.get("category") != lock:
                continue
            haystack = _haystack(product)
            if any(t in haystack for t in tokens):
                top.append(product)
            if len(top) >= max_results:
                break

    return [format_product_card(p) for p in top[:max_results]]


def get_product_by_id(product_id: str) -> Optional[dict]:
    for product in all_products():
        if product["id"] == product_id:
            return format_product_card({**product, "features": product.get("features", product.get("items", []))})
    return None


def _raw_product_by_id(product_id: str) -> Optional[dict]:
    for product in all_products():
        if product["id"] == product_id:
            return product
    return None


def find_products_by_mention(text: str, max_results: int = 5) -> list[dict]:
    """Match catalogue products whose names (or distinctive tokens) appear in text."""
    text_l = text.lower()
    hits: list[tuple[int, dict]] = []

    for product in all_products():
        name_l = product.get("name", "").lower()
        if len(name_l) < 4:
            continue
        score = 0
        if name_l in text_l:
            score = len(name_l) + 100
        else:
            for token in re.findall(r"[a-z0-9]+", name_l):
                if (
                    len(token) >= 5
                    and token not in GENERIC_NAME_TOKENS
                    and re.search(rf"\b{re.escape(token)}\b", text_l)
                ):
                    score = max(score, len(name_l) + len(token))
        if score > 0:
            if "kids" in name_l or "junior" in name_l:
                if not re.search(r"\b(kids?|children|junior|boys?|girls?)\b", text_l):
                    score -= 80
            hits.append((score, product))

    hits.sort(key=lambda x: x[0], reverse=True)
    seen: set[str] = set()
    cards: list[dict] = []
    for _, product in hits:
        pid = product["id"]
        if pid in seen:
            continue
        seen.add(pid)
        cards.append(
            format_product_card({**product, "features": product.get("features", product.get("items", []))})
        )
        if len(cards) >= max_results:
            break
    return cards


def _extract_table_header_names(response_text: str) -> list[str]:
    names: list[str] = []
    for block in re.finditer(r"<TABLE>[\s\S]*?</TABLE>", response_text, re.IGNORECASE):
        for th in re.finditer(r"<th[^>]*>([^<]+)</th>", block.group(0), re.IGNORECASE):
            label = th.group(1).strip()
            if label and label.lower() not in TABLE_HEADER_SKIP:
                names.append(label)
    return names


def resolve_comparison_tiles(
    user_query: str,
    response_text: str,
    agent_tiles: Optional[list[dict]] = None,
) -> list[dict]:
    """Tiles for compared products only — same category, no random catalogue picks."""
    agent_tiles = agent_tiles or []
    candidates: list[dict] = []
    seen: set[str] = set()

    def _add(card: dict) -> None:
        pid = str(card.get("id", ""))
        if pid and pid not in seen:
            seen.add(pid)
            candidates.append(card)

    for tile in agent_tiles:
        _add(tile)

    mention_text = " ".join([user_query, response_text, *_extract_table_header_names(response_text)])
    for card in find_products_by_mention(mention_text, max_results=6):
        _add(card)

    if not candidates:
        return []

    lock = infer_category_from_query(user_query)
    if not lock and candidates:
        raw = _raw_product_by_id(str(candidates[0].get("id", "")))
        lock = raw.get("category") if raw else None

    if lock:
        filtered: list[dict] = []
        for card in candidates:
            raw = _raw_product_by_id(str(card.get("id", "")))
            if raw and raw.get("category") == lock:
                filtered.append(card)
        candidates = filtered or candidates

    return candidates[:3]
