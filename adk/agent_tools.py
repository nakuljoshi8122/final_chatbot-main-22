"""Customer-support tools for the artisan boutique agent.

Includes mock RAG over fake_kb.md (handicrafts, apparel, skincare) plus Postgres CRM helpers.
Docstrings are part of the tool schema the LLM sees — keep them precise.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Optional

from sqlalchemy import select

try:
    from .crm_models import (
        AsyncSessionLocal,
        Contact,
        Note,
        get_or_create_contact,
        _utcnow,
    )
except ImportError:
    from crm_models import (
        AsyncSessionLocal,
        Contact,
        Note,
        get_or_create_contact,
        _utcnow,
    )

KB_PATH = Path(__file__).resolve().parent / "fake_kb.md"

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
    "apparel clothing shirt tee t-shirt chino pant pants short shorts hoodie jacket dress skirt linen denim".split()
)
_SKINCARE_MARKERS = frozenset(
    "skincare serum moisturizer moisturiser cleanser toner spf beauty brightening".split()
)


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


def _expand_query(query: str) -> str:
    q = query.lower().strip()
    extras: list[str] = []
    tokens = re.findall(r"[a-z0-9]+", q)
    for key, vals in _QUERY_EXPANSIONS.items():
        if key in q or key in tokens:
            extras.extend(vals)
    seen = set()
    out = []
    for w in tokens + extras:
        if w not in seen and w not in _STOPWORDS:
            seen.add(w)
            out.append(w)
    return " ".join(out) if out else query


def _detect_intent(query: str) -> dict[str, bool]:
    q = query.lower()
    tokens = set(re.findall(r"[a-z0-9]+", q))
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
            from .seller_catalog import seller_kb_chunks, list_seller_products
        except ImportError:
            from seller_catalog import seller_kb_chunks, list_seller_products

        if list_seller_products(active_only=True):
            seller_chunks = seller_kb_chunks(active_only=True)
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

    # auto: seed (Pinterest catalog) + seller uploads; seller wins on same title
    seller_titles = {
        c.splitlines()[0].lstrip("# ").strip().lower()
        for c in seller_chunks
        if c.startswith("##")
    }
    merged = [
        c
        for c in seed_chunks
        if c.splitlines()[0].lstrip("# ").strip().lower() not in seller_titles
    ]
    merged.extend(seller_chunks)
    return merged


def _score_chunk(query: str, chunk: str, intent: Optional[dict] = None) -> int:
    q_raw = query.lower().strip()
    q_tokens = {
        t for t in re.findall(r"[a-z0-9]+", q_raw) if t not in _STOPWORDS and len(t) > 2
    }
    if not q_tokens and len(q_raw) < 3:
        return 0
    c_lower = chunk.lower()
    score = sum(1 for t in q_tokens if re.search(rf"\b{re.escape(t)}\b", c_lower) or (len(t) > 4 and t in c_lower))
    title = chunk.splitlines()[0].lstrip("# ").strip().lower() if chunk.startswith("##") else ""
    if q_raw and (q_raw in title or q_raw in c_lower):
        score += 5
    if title and (title in q_raw or q_raw == title):
        score += 8
    if score > 0 and "seller_listed" in c_lower:
        score += 2

    intent = intent or {}
    domain = _chunk_domain(chunk)
    audience = _chunk_audience(chunk)

    # Hard domain filters — stop earrings showing for menswear, etc.
    if intent.get("jewellery") and not intent.get("apparel"):
        if domain in ("apparel", "skincare"):
            return 0
        # Must actually look like jewellery (not random handicrafts / 'fringed')
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
        # Prefer exact garment when asked (shorts, shirt, tee)
        for garment in ("short", "shorts", "shirt", "tee", "chino", "hoodie", "jacket"):
            if garment in q_tokens and garment in c_lower:
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
    intent = _detect_intent(query)
    search_query = _expand_query(query)
    chunks = _load_kb_chunks(mode="auto")
    if not chunks:
        return "Error: knowledge base is empty."

    ranked = sorted(
        ((_score_chunk(search_query, c, intent), c) for c in chunks),
        key=lambda x: x[0],
        reverse=True,
    )
    hits = [c for score, c in ranked if score > 0][:5]

    if not hits:
        # Fallback: return all product titles so the model can ask which one
        titles = [c.splitlines()[0].lstrip("# ").strip() for c in chunks]
        return (
            "No strong KB match for that query. Available products: "
            + ", ".join(titles[:40])
            + ("…" if len(titles) > 40 else "")
            + ". Ask the customer which product they mean, then search again."
        )

    body = "KNOWLEDGE BASE RESULTS:\n\n" + "\n\n---\n\n".join(hits)

    # Attach IMAGE + TILES metadata (from Pinterest fetch manifest) when available
    try:
        try:
            from .boutique_catalog import enrich_product, format_tiles_block, parse_kb_products
        except ImportError:
            from boutique_catalog import enrich_product, format_tiles_block, parse_kb_products

        hit_names = {
            h.splitlines()[0].lstrip("# ").strip().lower()
            for h in hits
            if h.startswith("##")
        }
        tiles = []
        for p in parse_kb_products():
            if p["name"].lower() in hit_names:
                tile = enrich_product(p)
                tiles.append(tile)

        if tiles:
            lines = ["", "PRODUCT MEDIA (use these exact img/url values in TILES):"]
            for t in tiles:
                lines.append(
                    f"- {t['name']} | sku={t['sku']} | img={t.get('img') or '(missing — run fetch_boutique_images.py)'} "
                    f"| link={t.get('url') or ''}"
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
