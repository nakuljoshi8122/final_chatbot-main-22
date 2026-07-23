"""Seller AI features — Tier 1 (Smart Assistant) + Tier 2 (Store Manager).

Uses OpenAI when OPENAI_API_KEY is set; rule-based fallbacks otherwise.
"""

from __future__ import annotations

import json
import logging
import os
import re
from collections import Counter
from datetime import datetime, timezone
from typing import Any, Optional

logger = logging.getLogger(__name__)

try:
    from catalog.seller_catalog import list_seller_products, get_seller_product
    from stores.store_registry import get_store, list_store_queries
    from commerce.buyer_cart import notify_subscriber_count
except ImportError:
    from adk.catalog.seller_catalog import list_seller_products, get_seller_product  # type: ignore
    from adk.stores.store_registry import get_store, list_store_queries  # type: ignore
    from adk.commerce.buyer_cart import notify_subscriber_count  # type: ignore

try:
    from paths import BUYER_ORDERS_JSON, RESTOCK_NOTIFY_JSON
except ImportError:
    from adk.paths import BUYER_ORDERS_JSON, RESTOCK_NOTIFY_JSON  # type: ignore


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _price_float(val: Any) -> float:
    try:
        return float(str(val or "").replace("$", "").replace(",", "").strip() or 0)
    except (TypeError, ValueError):
        return 0.0


def _load_json(path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _openai_client():
    key = os.getenv("OPENAI_API_KEY")
    if not key:
        return None
    try:
        from openai import OpenAI

        return OpenAI(api_key=key)
    except Exception:
        return None


def _llm_text(system: str, user: str, *, max_tokens: int = 400) -> Optional[str]:
    client = _openai_client()
    if not client:
        return None
    model = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
    if model.startswith("openai/"):
        model = model.split("/", 1)[1]
    try:
        resp = client.chat.completions.create(
            model=model,
            temperature=0.3,
            max_tokens=max_tokens,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        )
        return (resp.choices[0].message.content or "").strip()
    except Exception as e:
        logger.warning("seller_ai llm failed: %s", e)
        return None


def _active_products(store_id: str) -> list[dict[str, Any]]:
    return [
        r
        for r in list_seller_products(active_only=False, store_id=store_id)
        if str(r.get("status") or "active").lower() != "trash"
    ]


def _category_avg_price(rows: list[dict[str, Any]], category: str) -> float:
    prices = [_price_float(r.get("price")) for r in rows if str(r.get("category") or "") == category]
    prices = [p for p in prices if p > 0]
    return round(sum(prices) / len(prices), 2) if prices else 24.0


# ── Tier 1: Query auto-reply ─────────────────────────────────────────────


def draft_query_reply(
    store_id: str,
    question: str,
    *,
    notes: str = "",
    target_language: str = "",
) -> dict[str, Any]:
    """Draft a buyer query reply using live inventory context."""
    shop = get_store(store_id) or {}
    rows = [r for r in _active_products(store_id) if str(r.get("status") or "active") == "active"]
    inv_lines = []
    for r in rows[:20]:
        inv_lines.append(
            f"- {r.get('name')} (${_price_float(r.get('price')):.0f}, qty {r.get('quantity', 0)})"
        )
    inv_block = "\n".join(inv_lines) or "(empty catalog)"

    system = (
        f"You draft short seller replies for {shop.get('name', 'a boutique')}. "
        "Use ONLY facts from the inventory list. Be friendly, under 2 sentences. "
        "If unsure, say you'll check and get back."
    )
    user = f"Buyer question: {question.strip()}\nNotes: {notes.strip()}\n\nInventory:\n{inv_block}"
    draft = _llm_text(system, user, max_tokens=180)

    if not draft:
        q = question.lower()
        if any(w in q for w in ("stock", "available", "have", "in stock")):
            draft = "Yes, we have items in stock — check the product cards in chat or tell me which item you mean."
        elif any(w in q for w in ("ship", "delivery", "when")):
            draft = "We typically ship in 2–3 business days. I'll confirm exact timing for your order."
        elif any(w in q for w in ("price", "cost", "how much")):
            draft = "Prices are listed on each product card. Tell me which item and I can confirm."
        else:
            draft = "Thanks for asking! I'll check and get back to you shortly."

    english = draft
    localized = draft
    if target_language and target_language.lower() not in ("en", "english", ""):
        translated = _llm_text(
            "Translate the seller reply accurately. Output ONLY the translation.",
            f"Target language: {target_language}\n\nReply:\n{draft}",
            max_tokens=200,
        )
        if translated:
            localized = translated

    return {
        "ok": True,
        "draft": localized,
        "draft_en": english,
        "language": target_language or "en",
    }


# ── Tier 1: AI morning brief ─────────────────────────────────────────────


def generate_morning_brief(store_id: str) -> dict[str, Any]:
    """Prioritized narrative + stats for empty chat."""
    rows = _active_products(store_id)
    queries = list_store_queries(store_id, "open")
    low = [r for r in rows if str(r.get("status") or "active") == "active" and int(r.get("quantity") or 0) < 3]
    drafts = [r for r in rows if str(r.get("status") or "active") == "draft"]
    priorities = compute_restock_priorities(store_id)

    stats = {
        "lowStock": len(low),
        "drafts": len(drafts),
        "queries": len(queries),
    }

    lines = []
    if priorities:
        top = priorities[0]
        lines.append(
            f"Restock {top['name']} first — {top.get('reason', 'high priority')}."
        )
    if drafts:
        lines.append(f"Publish {len(drafts)} draft{'s' if len(drafts) != 1 else ''} when ready.")
    if queries:
        themes = analyze_buyer_intent(store_id).get("themes") or []
        if themes:
            lines.append(
                f"{len(queries)} buyer question{'s' if len(queries) != 1 else ''} — top theme: {themes[0]['label']}."
            )
        else:
            lines.append(f"{len(queries)} buyer question{'s' if len(queries) != 1 else ''} waiting.")
    if not lines:
        lines.append("All clear — no urgent tasks today.")

    narrative = " ".join(lines[:3])
    llm_narrative = _llm_text(
        "Rewrite as 1-2 ultra-brief bullet sentences for a busy seller. No fluff.",
        f"Stats: {json.dumps(stats)}\nPriorities: {json.dumps(priorities[:3])}\nDraft: {narrative}",
        max_tokens=120,
    )

    return {
        "ok": True,
        "stats": stats,
        "narrative": llm_narrative or narrative,
        "priorities": priorities[:5],
    }


# ── Tier 1: Full auto-draft listing ──────────────────────────────────────


def suggest_full_listing(
    image_base64: str,
    *,
    store_id: str = "",
    category_hint: str = "",
) -> dict[str, Any]:
    """Vision + suggested price/qty for one-tap listing."""
    try:
        from catalog.product_vision_guess import guess_product_from_image
    except ImportError:
        from adk.catalog.product_vision_guess import guess_product_from_image  # type: ignore

    vision = guess_product_from_image(image_base64, category_hint=category_hint)
    if not vision.get("ok") and not vision.get("name"):
        return {"ok": False, "error": vision.get("error") or "vision failed"}

    cat = str(vision.get("category") or category_hint or "Handicrafts")
    rows = _active_products(store_id) if store_id else []
    avg = _category_avg_price(rows, cat)
    suggested_price = round(avg, 2)

    return {
        "ok": True,
        "name": vision.get("name") or "New Product",
        "description": vision.get("description") or "",
        "category": cat,
        "product_type": vision.get("product_type") or "",
        "search_keywords": vision.get("search_keywords") or [],
        "suggested_price": suggested_price,
        "suggested_quantity": 10,
        "ready_to_list": True,
    }


# ── Tier 1: Restock notify message ───────────────────────────────────────


def generate_restock_notify_message(
    sku: str,
    *,
    store_id: str = "",
) -> dict[str, Any]:
    row = get_seller_product(sku) or {}
    name = str(row.get("name") or sku)
    price = str(row.get("price") or "")
    qty = int(row.get("quantity") or 0)
    count = notify_subscriber_count(sku)
    shop = get_store(store_id or str(row.get("store_id") or "")) or {}

    msg = _llm_text(
        "Write a 1-sentence restock alert SMS for a buyer. Friendly, under 120 chars.",
        f"Store: {shop.get('name')}\nProduct: {name}\nPrice: {price}\nStock: {qty}",
        max_tokens=80,
    )
    if not msg:
        msg = f"{name} is back in stock{f' at {price}' if price else ''} — {qty} available at {shop.get('name', 'our shop')}!"

    return {"ok": True, "message": msg, "subscriber_count": count, "sku": sku}


def broadcast_restock_with_message(sku: str, *, store_id: str = "") -> dict[str, Any]:
    """Notify waitlist with AI message; persist inbox entries for buyers."""
    try:
        from commerce.buyer_cart import notify_broadcast
        from paths import DATA_DIR
    except ImportError:
        from adk.commerce.buyer_cart import notify_broadcast  # type: ignore
        from adk.paths import DATA_DIR  # type: ignore

    gen = generate_restock_notify_message(sku, store_id=store_id)
    message = gen.get("message") or "Item back in stock!"

    notify_data = _load_json(RESTOCK_NOTIFY_JSON)
    key = str(sku or "").strip().upper()
    subs = list(notify_data.get(key) or [])

    inbox_path = DATA_DIR / "buyer_notifications.json"
    inbox = _load_json(inbox_path)
    sent = 0
    for sub in subs:
        bid = str(sub.get("buyer_id") or "")
        if not bid:
            continue
        entries = list(inbox.get(bid) or [])
        entries.insert(
            0,
            {
                "id": f"n_{key}_{sent}",
                "type": "restock",
                "sku": key,
                "store_id": store_id or sub.get("store_id") or "",
                "message": message,
                "created_at": _now(),
                "read": False,
            },
        )
        inbox[bid] = entries[:50]
        sent += 1

    if sent:
        inbox_path.parent.mkdir(parents=True, exist_ok=True)
        inbox_path.write_text(json.dumps(inbox, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    result = notify_broadcast(sku)
    return {
        "ok": True,
        "notified": result.get("notified", sent),
        "message": message,
    }


# ── Tier 2: Restock priority ─────────────────────────────────────────────


def compute_restock_priorities(store_id: str) -> list[dict[str, Any]]:
    rows = [r for r in _active_products(store_id) if str(r.get("status") or "active") == "active"]
    notify_data = _load_json(RESTOCK_NOTIFY_JSON)
    scored: list[tuple[float, dict[str, Any]]] = []

    for r in rows:
        sku = str(r.get("sku") or "").upper()
        qty = int(r.get("quantity") or 0)
        waitlist = len(list(notify_data.get(sku) or []))
        score = 0.0
        reasons = []
        if qty <= 0:
            score += 50
            reasons.append("out of stock")
        elif qty < 3:
            score += 25
            reasons.append("low stock")
        elif waitlist <= 0:
            continue
        if waitlist > 0:
            score += waitlist * 15
            reasons.append(f"{waitlist} buyer{'s' if waitlist != 1 else ''} waiting")
        if score <= 0:
            continue
        scored.append(
            (
                score,
                {
                    "sku": sku,
                    "name": str(r.get("name") or sku),
                    "quantity": qty,
                    "waitlist": waitlist,
                    "price": r.get("price"),
                    "score": round(score, 1),
                    "reason": ", ".join(reasons),
                },
            )
        )

    scored.sort(key=lambda x: -x[0])
    return [item for _, item in scored[:10]]


# ── Tier 2: Smart pricing ────────────────────────────────────────────────


def suggest_pricing(store_id: str, sku: str) -> dict[str, Any]:
    row = get_seller_product(sku)
    if not row:
        return {"ok": False, "error": "product not found"}
    rows = _active_products(store_id)
    cat = str(row.get("category") or "")
    cat_prices = [_price_float(r.get("price")) for r in rows if str(r.get("category") or "") == cat]
    cat_prices = [p for p in cat_prices if p > 0]
    avg = sum(cat_prices) / len(cat_prices) if cat_prices else 24.0
    current = _price_float(row.get("price"))
    qty = int(row.get("quantity") or 0)

    suggestion = current
    rationale = "Price looks aligned with your category average."
    if qty <= 0 and current > 0:
        suggestion = current
        rationale = "Item is sold out — restock before changing price."
    elif qty < 3 and current < avg * 0.9:
        suggestion = round(min(current * 1.15, avg * 1.1), 2)
        rationale = "Low stock + below average — demand may support a small increase."
    elif qty >= 15 and current > avg * 1.2:
        suggestion = round(avg * 1.05, 2)
        rationale = "High stock + above average — consider a modest decrease to move units."
    elif current < avg * 0.75:
        suggestion = round(avg * 0.95, 2)
        rationale = "Priced well below category average — room to increase margin."

    llm = _llm_text(
        "Give ONE short pricing tip (max 15 words) for a boutique seller.",
        f"Product: {row.get('name')}, current ${current}, avg ${avg:.0f}, qty {qty}, suggest ${suggestion}",
        max_tokens=40,
    )

    return {
        "ok": True,
        "sku": sku,
        "current_price": current,
        "category_average": round(avg, 2),
        "suggested_price": suggestion,
        "rationale": llm or rationale,
    }


# ── Tier 2: Promo copy ───────────────────────────────────────────────────


def generate_promo_copy(
    *,
    name: str,
    category: str = "",
    store_name: str = "",
    promo: str = "10% off",
) -> dict[str, Any]:
    system = "Generate short promo copy for a boutique. Return JSON: {\"tagline\",\"description\",\"social\"}"
    user = f"Store: {store_name}\nProduct: {name}\nCategory: {category}\nPromo: {promo}"
    raw = _llm_text(system, user, max_tokens=200)
    parsed: dict[str, Any] = {}
    if raw:
        try:
            text = re.sub(r"^```(?:json)?\s*", "", raw.strip())
            text = re.sub(r"\s*```$", "", text)
            parsed = json.loads(text)
        except Exception:
            parsed = {}

    tagline = str(parsed.get("tagline") or f"{promo} on {name}")
    description = str(parsed.get("description") or f"Limited time {promo.lower()} — shop {name} at {store_name}.")
    social = str(parsed.get("social") or f"✨ {promo} on {name}! Tap to shop. #{category.replace(' ', '')}")

    return {"ok": True, "tagline": tagline, "description": description, "social": social}


# ── Tier 2: Buyer intent insights ────────────────────────────────────────


def analyze_buyer_intent(store_id: str) -> dict[str, Any]:
    open_q = list_store_queries(store_id, "open")
    answered = list_store_queries(store_id, "all")
    answered = [q for q in answered if str(q.get("status") or "") == "answered"]

    all_q = open_q + answered[-30:]
    texts = [str(q.get("question") or "") + " " + str(q.get("notes") or "") for q in all_q]
    blob = " ".join(texts).lower()

    theme_rules = [
        ("shipping", ["ship", "delivery", "arrive", "when will"]),
        ("sizing", ["size", "fit", "medium", "large", "small", "xl"]),
        ("stock", ["stock", "available", "have this", "in stock", "sold out"]),
        ("pricing", ["price", "cost", "how much", "discount"]),
        ("custom", ["custom", "personalize", "order"]),
    ]
    themes = []
    for label, keys in theme_rules:
        hits = sum(1 for k in keys if k in blob)
        if hits:
            themes.append({"label": label, "count": hits})

    themes.sort(key=lambda x: -x["count"])

    tip = "Review open questions weekly to spot product gaps."
    if themes:
        t = themes[0]["label"]
        tips = {
            "shipping": "Add shipping time to your pinned quick replies.",
            "sizing": "Add size info to top apparel listings.",
            "stock": "Enable restock alerts and notify waitlisted buyers.",
            "pricing": "Pin a price-confirmation chip in Queries.",
            "custom": "Consider a custom-order note in product descriptions.",
        }
        tip = tips.get(t, tip)

    return {
        "ok": True,
        "open_count": len(open_q),
        "themes": themes[:5],
        "tip": tip,
        "sample_questions": [str(q.get("question") or "")[:120] for q in open_q[:5]],
    }


# ── Tier 2: Store analytics (conversational) ─────────────────────────────


def answer_store_analytics(store_id: str, question: str) -> dict[str, Any]:
    rows = _active_products(store_id)
    active = [r for r in rows if str(r.get("status") or "active") == "active"]
    drafts = [r for r in rows if str(r.get("status") or "active") == "draft"]
    low = [r for r in active if int(r.get("quantity") or 0) < 3]
    orders = _load_json(BUYER_ORDERS_JSON)
    q = (question or "").strip()
    ql = q.lower()

    # Browse / status / catalog dumps belong on product cards — not prose analytics.
    browse_needles = (
        "status update",
        "status on",
        "active listing",
        "active product",
        "show my",
        "list my",
        "list all",
        "all items",
        "all listing",
        "my inventory",
        "my products",
        "my items",
        "my listing",
        "browse",
        "what do i have",
        "what's in my",
        "whats in my",
        "catalog",
        "summarize the active",
        "summarise the active",
        "review my listing",
        "go through my",
    )
    query_needles = (
        "open quer",
        "open question",
        "buyer quer",
        "buyer question",
        "inbox",
        "list them",
        "list my open",
        "show my open",
        "what are my open",
        "open it",
    )
    if any(n in ql for n in query_needles):
        return {
            "ok": True,
            "redirect": "list_open_buyer_queries",
            "answer": "Show open buyer questions in chat.",
        }
    if any(n in ql for n in browse_needles) and not (
        ql.startswith("how many") and "draft" in ql
    ):
        status = "draft" if "draft" in ql else "trash" if "trash" in ql else "active"
        if any(n in ql for n in ("low stock", "out of stock", "restock list")):
            return {
                "ok": True,
                "redirect": "list_low_stock_items",
                "answer": "Show low-stock cards.",
            }
        return {
            "ok": True,
            "redirect": "list_my_inventory",
            "status": status,
            "answer": f"Show {status} listings as cards.",
        }
    if any(n in ql for n in ("low stock", "out of stock", "running low")) and not ql.startswith(
        "how many"
    ):
        return {
            "ok": True,
            "redirect": "list_low_stock_items",
            "answer": "Show low-stock cards.",
        }

    order_lines: Counter[str] = Counter()
    for buyer_orders in orders.values():
        if not isinstance(buyer_orders, list):
            continue
        for order in buyer_orders:
            for it in order.get("items") or []:
                if str(it.get("store_id") or "") == store_id:
                    order_lines[str(it.get("name") or it.get("sku") or "")] += int(it.get("qty") or 1)

    top_sellers = [{"name": n, "units": c} for n, c in order_lines.most_common(5)]
    ctx = {
        "active_listings": len(active),
        "drafts": len(drafts),
        "low_stock": len(low),
        "top_sellers": top_sellers,
        "open_queries": len(list_store_queries(store_id, "open")),
        "restock_priorities": [
            {"name": p.get("name"), "reason": p.get("reason")}
            for p in compute_restock_priorities(store_id)[:3]
        ],
    }

    answer = _llm_text(
        "Answer the seller's business question using ONLY the JSON counts/insights. "
        "1-2 short sentences. NEVER list every product, price, or stock line — "
        "counts and top 1-3 names max.",
        f"Question: {q}\n\nData:\n{json.dumps(ctx, indent=2)}",
        max_tokens=120,
    )

    if not answer:
        if "draft" in ql:
            answer = f"You have {len(drafts)} draft{'s' if len(drafts) != 1 else ''} waiting to publish."
        elif "low" in ql or "stock" in ql:
            answer = f"{len(low)} active item{'s' if len(low) != 1 else ''} are low on stock."
        elif "best" in ql or "sell" in ql or "top" in ql:
            if top_sellers:
                answer = f"Top seller: {top_sellers[0]['name']} ({top_sellers[0]['units']} units ordered)."
            else:
                answer = "No orders recorded yet — focus on publishing drafts and promoting listings."
        else:
            answer = (
                f"You have {len(active)} active listings, {len(drafts)} drafts, "
                f"and {len(low)} low-stock items."
            )

    return {"ok": True, "answer": answer, "context": ctx}


def translate_text(text: str, target_language: str) -> dict[str, Any]:
    if not text.strip():
        return {"ok": False, "error": "text required"}
    if not target_language or target_language.lower() in ("en", "english"):
        return {"ok": True, "translated": text, "language": "en"}
    translated = _llm_text(
        "Translate accurately for a boutique customer. Output ONLY the translation.",
        f"Target language: {target_language}\n\nText:\n{text}",
        max_tokens=250,
    )
    return {
        "ok": True,
        "translated": translated or text,
        "language": target_language,
    }


# ── Tier 2: Batch photo intelligence ─────────────────────────────────────


def analyze_batch_photos(
    images: list[dict[str, Any]],
    *,
    category_hint: str = "",
) -> dict[str, Any]:
    """Group batch photos; flag likely duplicates."""
    try:
        from catalog.product_vision_guess import guess_product_from_image
    except ImportError:
        from adk.catalog.product_vision_guess import guess_product_from_image  # type: ignore

    items: list[dict[str, Any]] = []
    for i, img in enumerate(images[:12]):
        b64 = str(img.get("base64") or img.get("image_base64") or "")
        if not b64:
            continue
        v = guess_product_from_image(b64, category_hint=category_hint)
        items.append(
            {
                "index": i,
                "name": v.get("name") or f"Item {i + 1}",
                "product_type": v.get("product_type") or "",
                "category": v.get("category") or category_hint,
                "keywords": v.get("search_keywords") or [],
            }
        )

    groups: dict[str, list[int]] = {}
    for it in items:
        key = (it.get("product_type") or it.get("name") or "other").lower()
        groups.setdefault(key, []).append(it["index"])

    duplicate_groups = [
        {"product_type": k, "indices": v}
        for k, v in groups.items()
        if len(v) > 1
    ]

    tip = "List each unique product once; skip duplicates in the batch."
    if duplicate_groups:
        tip = (
            f"Found {len(duplicate_groups)} possible duplicate group(s) — "
            "review before listing to avoid double entries."
        )

    return {
        "ok": True,
        "items": items,
        "duplicate_groups": duplicate_groups,
        "tip": tip,
        "queue_count": len(items),
    }


# ── Chat next-action suggestions (Assist quick chips) ────────────────────


def _parse_suggestion_list(raw: Optional[str]) -> list[dict[str, str]]:
    if not raw:
        return []
    try:
        text = re.sub(r"^```(?:json)?\s*", "", raw.strip())
        text = re.sub(r"\s*```$", "", text)
        data = json.loads(text)
    except Exception:
        return []
    rows = data if isinstance(data, list) else data.get("suggestions") if isinstance(data, dict) else []
    if not isinstance(rows, list):
        return []
    out: list[dict[str, str]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        message = str(row.get("message") or row.get("text") or "").strip()
        label = str(row.get("label") or message).strip()
        if not message:
            continue
        # Keep chip short; full prompt goes to the agent.
        if len(label) > 48:
            label = label[:45].rstrip() + "…"
        out.append({"label": label, "message": message[:240]})
        if len(out) >= 6:
            break
    return out


def _stats_fallback_suggestions(
    *,
    low: list[dict[str, Any]],
    drafts: list[dict[str, Any]],
    queries: list[dict[str, Any]],
    priorities: list[dict[str, Any]],
    store_name: str,
) -> list[dict[str, str]]:
    """Day-start / empty-chat suggestions from shop stats."""
    out: list[dict[str, str]] = []
    if priorities:
        name = str(priorities[0].get("name") or "top item")
        out.append(
            {
                "label": f"Restock {name}?",
                "message": f"What should I restock first? Focus on {name}.",
            }
        )
    elif low:
        name = str(low[0].get("name") or "low-stock items")
        out.append(
            {
                "label": "Check low stock",
                "message": f"Which items are low on stock? Start with {name}.",
            }
        )
    if drafts:
        out.append(
            {
                "label": f"Publish {len(drafts)} draft{'s' if len(drafts) != 1 else ''}",
                "message": "Show my draft items so I can publish them.",
            }
        )
    if queries:
        out.append(
            {
                "label": f"List {len(queries)} buyer Qs",
                "message": "List my open buyer questions.",
            }
        )
    out.append(
        {
            "label": "Morning priorities",
            "message": f"What should I focus on first today for {store_name or 'my store'}?",
        }
    )
    out.append(
        {
            "label": "Add a product",
            "message": "I want to add a new product — walk me through it.",
        }
    )
    out.append(
        {
            "label": "Top sellers",
            "message": "What sold best in my store recently?",
        }
    )
    # Dedupe by message
    seen: set[str] = set()
    unique: list[dict[str, str]] = []
    for s in out:
        key = s["message"].lower()
        if key in seen:
            continue
        seen.add(key)
        unique.append(s)
    return unique[:6]


def _chat_fallback_suggestions(messages: list[dict[str, Any]]) -> list[dict[str, str]]:
    """Heuristic next steps from recent chat keywords."""
    blob = " ".join(
        str(m.get("text") or "") for m in messages[-8:]
    ).lower()
    out: list[dict[str, str]] = []
    if any(k in blob for k in ("draft", "publish")):
        out.append(
            {
                "label": "Publish drafts",
                "message": "Publish all my draft items to active.",
            }
        )
    if any(
        k in blob
        for k in ("low stock", "low on stock", "restock", "quantity", "qty", "units")
    ):
        out.append(
            {
                "label": "Restock plan",
                "message": "What should I restock first based on my inventory?",
            }
        )
    if any(k in blob for k in ("price", "pricing", "discount")):
        out.append(
            {
                "label": "Pricing tip",
                "message": "Which of my items should I reprice, and why?",
            }
        )
    if any(k in blob for k in ("buyer", "question", "inbox", "query", "open quer")):
        out.append(
            {
                "label": "List open questions",
                "message": "List my open buyer questions.",
            }
        )
        out.append(
            {
                "label": "Draft a reply",
                "message": "Draft a reply for my first open buyer question.",
            }
        )
    if any(k in blob for k in ("add", "list", "new product", "photo")):
        out.append(
            {
                "label": "Finish listing",
                "message": "Help me finish listing the product we were working on.",
            }
        )
    if any(k in blob for k in ("trash", "delete", "restore")):
        out.append(
            {
                "label": "Check trash",
                "message": "Show items in trash that I might want to restore.",
            }
        )
    out.extend(
        [
            {
                "label": "Show my items",
                "message": "Show my active items.",
            },
            {
                "label": "What's next?",
                "message": "Based on what we just did, what should I do next in my store?",
            },
            {
                "label": "Morning priorities",
                "message": "What else should I tackle in the store today?",
            },
        ]
    )
    seen: set[str] = set()
    unique: list[dict[str, str]] = []
    for s in out:
        key = s["message"].lower()
        if key in seen:
            continue
        seen.add(key)
        unique.append(s)
    return unique[:6]


def generate_chat_suggestions(
    store_id: str,
    messages: Optional[list[dict[str, Any]]] = None,
) -> dict[str, Any]:
    """Predict next seller actions for Assist chips.

    Empty chat → day-start / shop-stats suggestions.
    Ongoing chat → suggestions grounded in the latest turns.
    """
    sid = str(store_id or "").strip()
    store = get_store(sid) or {}
    store_name = str(store.get("name") or "your store")
    rows = _active_products(sid)
    queries = list_store_queries(sid, "open")
    low = [
        r
        for r in rows
        if str(r.get("status") or "active") == "active" and int(r.get("quantity") or 0) < 3
    ]
    drafts = [r for r in rows if str(r.get("status") or "active") == "draft"]
    priorities = compute_restock_priorities(sid) if sid else []

    msgs = [m for m in (messages or []) if isinstance(m, dict)]
    # Keep only short transcript for the model
    transcript = [
        {
            "role": "user" if m.get("isUser") or m.get("role") == "user" else "assistant",
            "text": str(m.get("text") or "")[:400],
        }
        for m in msgs[-10:]
        if str(m.get("text") or "").strip()
    ]
    has_chat = len(transcript) > 0

    stats = {
        "store": store_name,
        "category": store.get("category") or "",
        "lowStock": len(low),
        "drafts": len(drafts),
        "openQueries": len(queries),
        "topRestock": [
            {"name": p.get("name"), "reason": p.get("reason")} for p in priorities[:3]
        ],
        "lowNames": [str(r.get("name") or "") for r in low[:3]],
        "draftNames": [str(r.get("name") or "") for r in drafts[:3]],
    }

    fallback = (
        _chat_fallback_suggestions(msgs)
        if has_chat
        else _stats_fallback_suggestions(
            low=low,
            drafts=drafts,
            queries=queries,
            priorities=priorities,
            store_name=store_name,
        )
    )

    if has_chat:
        system = (
            "You help a boutique seller in Assist chat. "
            "Given recent chat + shop stats, propose 4-5 SHORT next actions the seller "
            "would likely tap next. Each suggestion must be a natural message the seller "
            "would send to their store agent (imperative or question). "
            "Prefer 'Show my active items' / 'Show drafts' / 'Which items are low on stock?' "
            "over 'summarize listings' (cards show inventory — no text catalogs). "
            "Return JSON only: "
            '[{"label":"chip text ≤6 words","message":"full prompt to agent"}]. '
            "No fluff. Ground in the conversation — do not repeat the last user message."
        )
        user = (
            f"Stats: {json.dumps(stats)}\n"
            f"Recent chat:\n{json.dumps(transcript, ensure_ascii=False)}"
        )
    else:
        system = (
            "You help a boutique seller starting their day in Assist. "
            "Given shop stats, propose 4-5 SHORT first actions a seller would take "
            "(restock, publish drafts, answer buyers, list a product, check sales). "
            "Each suggestion is a message they send to their store agent. "
            "Return JSON only: "
            '[{"label":"chip text ≤6 words","message":"full prompt to agent"}]. '
            "Prioritize urgent stats. No fluff."
        )
        user = f"Stats: {json.dumps(stats)}"

    llm_rows = _parse_suggestion_list(_llm_text(system, user, max_tokens=320))
    suggestions = llm_rows or fallback
    if len(suggestions) < 3:
        # Pad with fallback without duplicates
        seen = {s["message"].lower() for s in suggestions}
        for s in fallback:
            if s["message"].lower() in seen:
                continue
            suggestions.append(s)
            seen.add(s["message"].lower())
            if len(suggestions) >= 5:
                break

    return {
        "ok": True,
        "mode": "chat" if has_chat else "day_start",
        "suggestions": suggestions[:6],
        "stats": {
            "lowStock": len(low),
            "drafts": len(drafts),
            "queries": len(queries),
        },
    }
