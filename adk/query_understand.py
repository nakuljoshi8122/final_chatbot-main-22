"""Understand buyer queries before catalog search.

Flow:
  raw query → structured intent (domain / type / audience / terms)
           → search wrapper string + filters
           → scored KB lookup

Heuristic first (fast, offline). Optional LLM refine for typos / slang.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Optional

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent / ".env", override=False)

logger = logging.getLogger(__name__)

_STOP = frozenset(
    (
        "a an the and or for to of in on is it my me with can you what how much please "
        "any some else also no yes just looking want need show something get give me "
        "have has do does did that this those these i im i'm"
    ).split()
)

# product_type → synonyms shoppers type
_TYPE_SYNONYMS: dict[str, list[str]] = {
    "t-shirt": ["t-shirt", "tshirt", "tshirts", "tee", "tees", "shirt", "shirts"],
    "shirt": ["shirt", "shirts", "button-down", "button down"],
    "shorts": ["short", "shorts"],
    "pants": ["pant", "pants", "chino", "chinos", "trouser", "trousers"],
    "hoodie": ["hoodie", "hoodies", "sweatshirt"],
    "jacket": ["jacket", "jackets", "blazer"],
    "dress": ["dress", "dresses"],
    "skirt": ["skirt", "skirts"],
    "earrings": ["earring", "earrings", "jhumka", "jhumkas", "studs"],
    "bracelet": ["bracelet", "bracelets", "bangle", "bangles"],
    "necklace": ["necklace", "necklaces", "pendant", "chain"],
    "ring": ["ring", "rings"],
    "serum": ["serum", "serums"],
    "moisturizer": ["moisturizer", "moisturiser", "moisturizers", "cream", "lotion"],
    "cleanser": ["cleanser", "cleanser", "face wash", "facewash"],
    "toner": ["toner", "toners"],
    "vase": ["vase", "vases", "pot", "pottery"],
}

_DOMAIN_HINTS: dict[str, frozenset[str]] = {
    "apparel": frozenset(
        "apparel clothing clothes wear outfit fashion shirt shirts tee tees tshirt tshirts "
        "t-shirt shorts pants chino hoodie jacket dress skirt denim linen menswear "
        "womenswear top tops bottom bottoms".split()
    ),
    "jewellery": frozenset(
        "jewellery jewelry jewelery earring earrings bracelet necklace pendant ring "
        "rings jhumka accessory accessories".split()
    ),
    "skincare": frozenset(
        "skincare skin serum moisturizer moisturiser cleanser toner spf beauty "
        "brightening acne glow face".split()
    ),
    "handicrafts": frozenset(
        "handicraft handicrafts craft crafts handmade vase pottery ceramic decor "
        "home decor artisanal".split()
    ),
}

_AUDIENCE_HINTS = {
    "men": frozenset("men mens male man him dad father husband boyfriend bro".split()),
    "women": frozenset("women womens female woman her mom mother wife girlfriend ladies".split()),
    "kids": frozenset("kids kid children child boy girl toddler baby".split()),
}

BOUTIQUE_EXTRACTION_PROMPT = """You understand shopper messages for a multi-category boutique
(apparel, jewellery, skincare, handicrafts).

Return ONLY valid JSON. No markdown. No backticks.
{
  "corrected_input": "typo-fixed clean version of what they want",
  "domain": "one of: apparel | jewellery | skincare | handicrafts | unknown",
  "product_types": ["zero or more: t-shirt, shirt, shorts, pants, hoodie, jacket, dress, skirt, earrings, bracelet, necklace, ring, serum, moisturizer, cleanser, toner, vase, or other short type"],
  "audience": "one of: men | women | kids | unisex | unknown",
  "attributes": ["colors, materials, styles as short lowercase words"],
  "search_terms": ["5-12 keywords that should match product titles/tags/specs"],
  "intent": "one of: browse | product_lookup | price | availability | size | care | other"
}

Rules:
- "shirts" / "tshirts" / "tees" → domain apparel, product_types include t-shirt and shirt, search_terms include t-shirt tee shirt
- Fix typos: shrit→shirt, tshrt→t-shirt, earings→earrings, moisturzer→moisturizer
- Do NOT invent a domain if unclear — use unknown
- search_terms must include the canonical product type words buyers and sellers use
- Keep attributes only if clearly mentioned (pink, cotton, gold, vitamin c)
"""


@dataclass
class QueryIntent:
    raw: str
    corrected: str
    domain: str = "unknown"  # apparel | jewellery | skincare | handicrafts | unknown
    product_types: list[str] = field(default_factory=list)
    audience: str = "unknown"  # men | women | kids | unisex | unknown
    attributes: list[str] = field(default_factory=list)
    search_terms: list[str] = field(default_factory=list)
    intent: str = "browse"
    source: str = "heuristic"  # heuristic | llm | hybrid

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _tokens(text: str) -> set[str]:
    return {
        t
        for t in re.findall(r"[a-z0-9]+(?:-[a-z0-9]+)?", (text or "").lower())
        if t not in _STOP and len(t) > 1
    }


def _store_domain_prior() -> Optional[str]:
    """If buyer is inside a category shop, prefer that domain."""
    try:
        try:
            from .store_scope import get_current_store, STORE_CATALOG
        except ImportError:
            from store_scope import get_current_store, STORE_CATALOG
        key = get_current_store()
        if not key:
            return None
        meta = STORE_CATALOG.get(key) or {}
        domains = meta.get("domains") or frozenset()
        if "apparel" in domains:
            return "apparel"
        if "skincare" in domains:
            return "skincare"
        if "jewellery" in domains or "handicrafts" in domains:
            # handicrafts shop may sell jewellery + crafts — don't force
            return "handicrafts" if "handicrafts" in domains else "jewellery"
    except Exception:
        return None
    return None


def understand_query_heuristic(raw_query: str) -> QueryIntent:
    raw = (raw_query or "").strip()
    # Typo-fix first so type detection sees clean words
    corrected = raw
    for pat, repl in (
        (r"\btshrits?\b", "t-shirts"),
        (r"\btshrt\b", "t-shirt"),
        (r"\btshirts?\b", "t-shirts"),
        (r"\bshrits?\b", "shirts"),
        (r"\bearings?\b", "earrings"),
        (r"\bmoisturzer\b", "moisturizer"),
        (r"\bjewelery\b", "jewellery"),
        (r"\bjewelry\b", "jewellery"),
    ):
        corrected = re.sub(pat, repl, corrected, flags=re.I)
    corrected = corrected.strip() or raw

    q = corrected.lower()
    toks = _tokens(q)
    expanded = set(toks)
    for t in list(toks):
        if t.endswith("s") and len(t) > 3:
            expanded.add(t[:-1])
        if t in ("tshirts", "tshirt"):
            expanded.update({"t-shirt", "tee", "shirt"})
        if t == "shirts":
            expanded.update({"shirt", "tee", "t-shirt"})

    domain = "unknown"
    scores = {d: len(expanded & hints) for d, hints in _DOMAIN_HINTS.items()}
    if scores:
        best_d, best_s = max(scores.items(), key=lambda x: x[1])
        if best_s > 0:
            domain = best_d

    # Store category is a prior only when the query didn't name another domain
    prior = _store_domain_prior()
    if domain == "unknown" and prior:
        domain = prior

    product_types: list[str] = []
    search_terms: list[str] = []
    expanded_flat = {e.replace("-", "") for e in expanded}
    for ptype, syns in _TYPE_SYNONYMS.items():
        syn_set = set(syns)
        hit = bool(expanded & syn_set) or bool(
            expanded_flat & {s.replace("-", "") for s in syns}
        )
        # Multi-word phrases only — never substring-match "ring" inside "earrings"
        if not hit:
            for s in syns:
                if " " in s and s in q:
                    hit = True
                    break
        if hit:
            product_types.append(ptype)
            search_terms.extend(syns[:4])

    product_types = list(dict.fromkeys(product_types))

    audience = "unknown"
    for aud, hints in _AUDIENCE_HINTS.items():
        if expanded & hints:
            audience = aud
            break

    attributes: list[str] = []
    for attr in (
        "pink red blue green black white yellow beige brown gold silver "
        "cotton linen silk striped soft leather wool denim".split()
    ):
        if attr in expanded:
            attributes.append(attr)
    attributes = list(dict.fromkeys(attributes))[:8]

    if not search_terms:
        search_terms = [t for t in sorted(expanded) if t not in _STOP][:10]
    else:
        search_terms = list(dict.fromkeys(search_terms + list(expanded)))[:14]

    if domain == "apparel" and not product_types and any(
        t in expanded for t in ("clothes", "clothing", "apparel", "outfit", "wear")
    ):
        search_terms = list(dict.fromkeys(["apparel", "clothing"] + search_terms))

    return QueryIntent(
        raw=raw,
        corrected=corrected,
        domain=domain,
        product_types=product_types,
        audience=audience,
        attributes=attributes,
        search_terms=search_terms,
        intent="browse",
        source="heuristic",
    )


def build_search_wrapper(intent: QueryIntent) -> str:
    """Flatten structured intent into a search string for scorer."""
    parts: list[str] = []
    if intent.corrected:
        parts.append(intent.corrected)
    if intent.domain and intent.domain != "unknown":
        parts.append(intent.domain)
    parts.extend(intent.product_types)
    parts.extend(intent.search_terms)
    parts.extend(intent.attributes)
    if intent.audience and intent.audience not in ("unknown", "unisex"):
        parts.append(intent.audience)
    seen: set[str] = set()
    out: list[str] = []
    for p in parts:
        for w in re.findall(r"[a-z0-9]+(?:-[a-z0-9]+)?", str(p).lower()):
            if w in _STOP or w in seen or len(w) < 2:
                continue
            seen.add(w)
            out.append(w)
    return " ".join(out) if out else intent.raw


def intent_to_score_flags(intent: QueryIntent) -> dict[str, bool]:
    """Compat flags for existing _score_chunk filters."""
    return {
        "jewellery": intent.domain == "jewellery",
        "apparel": intent.domain == "apparel",
        "skincare": intent.domain == "skincare",
        "handicrafts": intent.domain == "handicrafts",
        "men": intent.audience == "men",
        "women": intent.audience == "women",
    }


def format_intent_header(intent: QueryIntent) -> str:
    """Human-readable wrapper for search_kb / agent context."""
    types = ", ".join(intent.product_types) or "null"
    attrs = ", ".join(intent.attributes) or "null"
    return (
        f"[QUERY INTENT | domain={intent.domain} | types={types} | "
        f"audience={intent.audience} | attrs={attrs} | "
        f"intent={intent.intent} | via={intent.source}]\n"
        f"[SEARCH WRAPPER: {build_search_wrapper(intent)}]\n"
        f"[CLEANED: {intent.corrected}]"
    )


def _strip_json_fence(text: str) -> str:
    text = (text or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.I)
        text = re.sub(r"\s*```$", "", text)
    return text.strip()


def _parse_llm_intent(text: str, raw: str) -> Optional[QueryIntent]:
    cleaned = _strip_json_fence(text)
    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError:
        m = re.search(r"\{[\s\S]*\}", cleaned)
        if not m:
            return None
        try:
            data = json.loads(m.group(0))
        except json.JSONDecodeError:
            return None
    if not isinstance(data, dict):
        return None

    domain = str(data.get("domain") or "unknown").lower().strip()
    if domain in ("jewelry", "jewelery"):
        domain = "jewellery"
    if domain not in ("apparel", "jewellery", "skincare", "handicrafts", "unknown"):
        domain = "unknown"

    types = data.get("product_types") or []
    if isinstance(types, str):
        types = [types]
    types = [str(t).lower().strip() for t in types if str(t).strip()]

    terms = data.get("search_terms") or []
    if isinstance(terms, str):
        terms = [terms]
    terms = [str(t).lower().strip() for t in terms if str(t).strip()]

    attrs = data.get("attributes") or []
    if isinstance(attrs, str):
        attrs = [attrs]
    attrs = [str(a).lower().strip() for a in attrs if str(a).strip()]

    audience = str(data.get("audience") or "unknown").lower().strip()
    if audience not in ("men", "women", "kids", "unisex", "unknown"):
        audience = "unknown"

    corrected = str(data.get("corrected_input") or raw).strip() or raw
    intent_name = str(data.get("intent") or "browse").lower().strip()

    return QueryIntent(
        raw=raw,
        corrected=corrected,
        domain=domain,
        product_types=list(dict.fromkeys(types))[:8],
        audience=audience,
        attributes=list(dict.fromkeys(attrs))[:8],
        search_terms=list(dict.fromkeys(terms))[:14],
        intent=intent_name,
        source="llm",
    )


def _call_openai(raw_query: str) -> str:
    from openai import OpenAI

    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise ValueError("OPENAI_API_KEY not set")
    client = OpenAI(api_key=api_key)
    model = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
    if model.startswith("openai/"):
        model = model.split("/", 1)[1]
    resp = client.chat.completions.create(
        model=model,
        temperature=0,
        max_tokens=280,
        messages=[
            {"role": "system", "content": BOUTIQUE_EXTRACTION_PROMPT},
            {"role": "user", "content": raw_query},
        ],
    )
    return (resp.choices[0].message.content or "").strip()


def _call_gemini(raw_query: str) -> str:
    api_key = os.getenv("GOOGLE_API_KEY")
    if not api_key:
        raise ValueError("GOOGLE_API_KEY not set")
    try:
        from .llm_config import get_llm_provider
    except ImportError:
        from llm_config import get_llm_provider

    _ = get_llm_provider()  # keep provider wiring consistent
    model_name = os.getenv("GEMINI_MODEL", "gemini-2.5-flash-lite")
    try:
        import google.generativeai as genai  # type: ignore

        genai.configure(api_key=api_key)
        model = genai.GenerativeModel(model_name)
        response = model.generate_content(
            f"{BOUTIQUE_EXTRACTION_PROMPT}\n\nUser message: {raw_query}",
            generation_config={"temperature": 0, "max_output_tokens": 280},
        )
        return (response.text or "").strip()
    except ImportError:
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=api_key)
        response = client.models.generate_content(
            model=model_name,
            contents=f"{BOUTIQUE_EXTRACTION_PROMPT}\n\nUser message: {raw_query}",
            config=types.GenerateContentConfig(temperature=0, max_output_tokens=280),
        )
        return (response.text or "").strip()


def _llm_refine(raw_query: str) -> Optional[QueryIntent]:
    try:
        try:
            from .llm_config import get_llm_provider
        except ImportError:
            from llm_config import get_llm_provider
        provider = get_llm_provider()
        text = _call_gemini(raw_query) if provider == "gemini" else _call_openai(raw_query)
        return _parse_llm_intent(text, raw_query)
    except Exception as exc:
        logger.warning("query understand LLM failed: %s", exc)
        return None


def _merge_intents(base: QueryIntent, llm: QueryIntent) -> QueryIntent:
    """Prefer LLM corrections; keep heuristic domain/type if LLM is unknown."""
    domain = llm.domain if llm.domain != "unknown" else base.domain
    types = llm.product_types or base.product_types
    audience = llm.audience if llm.audience != "unknown" else base.audience
    terms = list(dict.fromkeys((llm.search_terms or []) + (base.search_terms or [])))[:14]
    attrs = list(dict.fromkeys((llm.attributes or []) + (base.attributes or [])))[:8]
    return QueryIntent(
        raw=base.raw,
        corrected=llm.corrected or base.corrected,
        domain=domain,
        product_types=types,
        audience=audience,
        attributes=attrs,
        search_terms=terms,
        intent=llm.intent or base.intent,
        source="hybrid",
    )


def _needs_llm(intent: QueryIntent) -> bool:
    """Skip LLM when heuristic already has a clear product type."""
    if os.getenv("QUERY_UNDERSTAND_LLM", "1").strip() in ("0", "false", "no"):
        return False
    if intent.product_types and intent.domain != "unknown":
        return False
    # short / slang / likely typo
    raw = intent.raw.lower()
    if len(intent.raw.split()) <= 6:
        return True
    if intent.domain == "unknown":
        return True
    if re.search(r"(shrit|tshrt|earing|moisturz|jewl|apparell)", raw):
        return True
    return False


async def understand_query(raw_query: str, *, use_llm: bool = True) -> QueryIntent:
    """Full pipeline: heuristic → optional LLM refine → structured intent."""
    base = understand_query_heuristic(raw_query)
    if not use_llm or not _needs_llm(base):
        return base
    try:
        llm = await asyncio.wait_for(asyncio.to_thread(_llm_refine, raw_query.strip()), timeout=4.0)
    except Exception:
        llm = None
    if not llm:
        return base
    return _merge_intents(base, llm)


def score_boost_for_intent(chunk: str, intent: QueryIntent) -> int:
    """Extra score from structured intent (domain / type / audience)."""
    if not intent:
        return 0
    c = (chunk or "").lower()
    title = chunk.splitlines()[0].lstrip("# ").strip().lower() if chunk.startswith("##") else ""
    title_compact = re.sub(r"[^a-z0-9]+", "", title)
    c_compact = re.sub(r"[^a-z0-9]+", "", c)
    boost = 0

    if intent.domain != "unknown":
        if f"domain: {intent.domain}" in c or f"category: {intent.domain}" in c:
            boost += 6
        elif intent.domain == "apparel" and "category: apparel" in c:
            boost += 6
        elif intent.domain == "jewellery" and any(x in c for x in ("jewellery", "jewelry", "earring")):
            boost += 6
        elif intent.domain == "skincare" and "skincare" in c:
            boost += 6

        # hard mismatch — large penalty handled by caller via return negative
        if intent.domain == "apparel" and ("domain: jewellery" in c or "domain: skincare" in c):
            return -100
        if intent.domain == "jewellery" and ("domain: apparel" in c or "domain: skincare" in c):
            return -100
        if intent.domain == "skincare" and ("domain: apparel" in c or "domain: jewellery" in c):
            return -100

    for ptype in intent.product_types:
        p = ptype.lower()
        pc = p.replace("-", "")
        if p in title or pc in title_compact or f"type: {p}" in c or pc in c_compact:
            boost += 14
        elif p in c or pc in c_compact:
            boost += 8
        # synonym overlap
        for syn in _TYPE_SYNONYMS.get(p, []):
            sc = syn.replace("-", "")
            if syn in title or sc in title_compact:
                boost += 12
                break

    if intent.audience in ("men", "women"):
        if f"audience: {intent.audience}" in c:
            boost += 4
        elif intent.audience == "men" and "audience: women" in c:
            boost -= 8
        elif intent.audience == "women" and "audience: men" in c:
            boost -= 8

    for attr in intent.attributes:
        if attr in c:
            boost += 2

    return boost
