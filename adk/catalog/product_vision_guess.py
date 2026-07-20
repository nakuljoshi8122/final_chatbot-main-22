"""Guess product name + description from a photo (OpenAI vision)."""

from __future__ import annotations

import base64
import json
import logging
import os
import re
from typing import Any

logger = logging.getLogger(__name__)

GUESS_PROMPT = """You help a boutique seller list a product from a photo.

Look at the image and return ONLY valid JSON (no markdown):
{
  "name": "short retail product title, Title Case, 2-6 words",
  "description": "1-2 friendly listing sentences for shoppers",
  "category": "one of: Handicrafts | Apparel | Skincare",
  "generalized": true
}

Rules:
- Prefer a clear, sellable name. If brand/model is unclear, use a generalized name
  (e.g. "Ceramic Mug", "Cotton T-Shirt", "Vitamin C Serum", "Woven Basket").
- Do NOT invent fake brand names or SKUs.
- Description should mention visible material/color/use when obvious; stay generic if not.
- Match category to what the item IS (clothes → Apparel, beauty → Skincare, craft/home → Handicrafts).
- Keep name under 50 characters. Description under 220 characters.
- Set generalized=true when you are unsure of specifics.
"""


def _strip_data_url(image_base64: str) -> tuple[str, str]:
    raw = str(image_base64 or "").strip()
    mime = "image/jpeg"
    m = re.match(r"^data:(image/[^;]+);base64,(.+)$", raw, re.I | re.S)
    if m:
        mime = m.group(1).lower()
        raw = m.group(2)
    else:
        raw = re.sub(r"^data:image/[^;]+;base64,", "", raw)
    return mime, raw


def _parse_json(raw: str) -> dict[str, Any]:
    text = (raw or "").strip()
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    try:
        parsed = json.loads(text)
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        return {}


def _fallback(category: str = "") -> dict[str, Any]:
    cat = category if category in ("Handicrafts", "Apparel", "Skincare") else "Handicrafts"
    defaults = {
        "Handicrafts": ("Handmade Item", "Handcrafted piece ready to list. Edit details as needed."),
        "Apparel": ("Apparel Item", "Wearable piece ready to list. Edit size and details as needed."),
        "Skincare": ("Skincare Product", "Beauty product ready to list. Edit ingredients and details as needed."),
    }
    name, description = defaults[cat]
    return {
        "ok": True,
        "name": name,
        "description": description,
        "category": cat,
        "generalized": True,
        "source": "fallback",
    }


def guess_product_from_image(
    image_base64: str,
    *,
    category_hint: str = "",
) -> dict[str, Any]:
    """Return name/description/category guessed from a product photo."""
    if not image_base64 or not str(image_base64).strip():
        return {**_fallback(category_hint), "ok": False, "error": "image required"}

    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        out = _fallback(category_hint)
        out["ok"] = False
        out["error"] = "OPENAI_API_KEY not configured"
        return out

    mime, b64 = _strip_data_url(image_base64)
    # Guard huge payloads
    try:
        raw_bytes = base64.b64decode(b64)
    except Exception:
        return {**_fallback(category_hint), "ok": False, "error": "invalid image"}
    if len(raw_bytes) < 200:
        return {**_fallback(category_hint), "ok": False, "error": "image too small"}
    if len(raw_bytes) > 4_500_000:
        return {**_fallback(category_hint), "ok": False, "error": "image too large"}

    try:
        from openai import OpenAI

        client = OpenAI(api_key=api_key)
        model = os.getenv("OPENAI_VISION_MODEL") or os.getenv("OPENAI_MODEL", "gpt-4o-mini")
        if model.startswith("openai/"):
            model = model.split("/", 1)[1]

        hint = ""
        if category_hint in ("Handicrafts", "Apparel", "Skincare"):
            hint = f"\nSeller's store category hint: {category_hint}."

        resp = client.chat.completions.create(
            model=model,
            temperature=0.2,
            max_tokens=350,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": GUESS_PROMPT + hint},
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:{mime};base64,{b64}",
                                "detail": "low",
                            },
                        },
                    ],
                }
            ],
        )
        content = (resp.choices[0].message.content or "").strip()
        parsed = _parse_json(content)
        name = str(parsed.get("name") or "").strip()
        description = str(parsed.get("description") or "").strip()
        category = str(parsed.get("category") or category_hint or "Handicrafts").strip()
        if category not in ("Handicrafts", "Apparel", "Skincare"):
            # Map common vision synonyms
            low = category.lower()
            if any(k in low for k in ("apparel", "cloth", "wear", "shirt", "dress")):
                category = "Apparel"
            elif any(k in low for k in ("skin", "beauty", "serum", "cosmetic")):
                category = "Skincare"
            else:
                category = "Handicrafts"

        if not name:
            return {**_fallback(category), "source": "fallback_empty_name"}

        # Title-ish cleanup
        name = re.sub(r"\s+", " ", name)[:50]
        description = re.sub(r"\s+", " ", description)[:220]
        if not description:
            description = f"{name} ready to list. Edit details as needed."

        return {
            "ok": True,
            "name": name,
            "description": description,
            "category": category,
            "generalized": bool(parsed.get("generalized", True)),
            "source": "vision",
        }
    except Exception as e:
        logger.warning("product vision guess failed: %s", e)
        out = _fallback(category_hint)
        out["ok"] = False
        out["error"] = str(e)
        return out
