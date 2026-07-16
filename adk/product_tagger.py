"""Auto-tag product photos with OpenAI vision for chat search."""

from __future__ import annotations

import base64
import json
import logging
import os
import re
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)

ADK_DIR = Path(__file__).resolve().parent
PRODUCT_IMAGES_DIR = ADK_DIR / "static" / "products"

TAG_PROMPT = """You tag boutique product photos for inventory search.

Return ONLY valid JSON (no markdown) with this shape:
{{
  "domain": "one of: jewellery|apparel|skincare|handicrafts|home",
  "audience": "one of: women|men|unisex|kids|all",
  "product_type": "short type e.g. earrings, t-shirt, serum, vase",
  "tags": ["8-16 short lowercase search tags"]
}}

Rules:
- domain must match what the product IS (earrings → jewellery, tee → apparel, serum → skincare).
- audience: traditional jhumka/earrings usually "women"; plain cotton tee often "unisex"; only use "men" if clearly menswear.
- tags should help shoppers find the item (materials, color, style, season) but MUST stay consistent with domain.
- Do NOT tag jewellery as apparel. Do NOT tag apparel as jewellery.
- Include domain word in tags (jewellery or apparel or skincare or handicraft).

Product name: {name}
Listed category: {category}
Description: {description}
"""


def _encode_image(path: Path) -> Optional[tuple[str, str]]:
    if not path.exists():
        return None
    data = path.read_bytes()
    if not data:
        return None
    ext = path.suffix.lower().lstrip(".") or "jpeg"
    mime = {
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "png": "image/png",
        "webp": "image/webp",
        "gif": "image/gif",
    }.get(ext, "image/jpeg")
    return mime, base64.b64encode(data).decode("ascii")


def _parse_tag_payload(raw: str) -> dict[str, Any]:
    text = (raw or "").strip()
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    try:
        parsed = json.loads(text)
        if isinstance(parsed, dict):
            tags = parsed.get("tags") or []
            if isinstance(tags, list):
                parsed["tags"] = sorted({str(t).strip().lower() for t in tags if str(t).strip()})
            return parsed
        if isinstance(parsed, list):
            return {"tags": sorted({str(t).strip().lower() for t in parsed if str(t).strip()})}
    except Exception:
        pass
    parts = re.split(r"[,;\n]+", text)
    tags = [p.strip().lower().strip("\"'") for p in parts if len(p.strip()) > 1]
    return {"tags": sorted(set(tags))[:24]}


def heuristic_meta(*, name: str, category: str = "", description: str = "") -> dict[str, Any]:
    blob = f"{name} {category} {description}".lower()
    domain = "handicrafts"
    audience = "all"
    product_type = (name or "item").strip().lower()
    tags: set[str] = set()

    cat = (category or "").lower()
    if "apparel" in cat or "cloth" in cat:
        domain = "apparel"
    elif "skincare" in cat or "beauty" in cat:
        domain = "skincare"
    elif "handicraft" in cat:
        domain = "handicrafts"

    jewellery_keys = ("earring", "earrings", "jhumka", "bracelet", "necklace", "pendant", "ring", "jewellery", "jewelry")
    apparel_keys = ("tee", "t-shirt", "shirt", "chino", "pant", "short", "hoodie", "jacket", "apparel", "clothing", "dress", "skirt")
    skincare_keys = ("serum", "moisturizer", "moisturiser", "cleanser", "skincare", "spf", "toner")

    if any(k in blob for k in jewellery_keys):
        domain = "jewellery"
        audience = "women"
        if "earring" in blob:
            product_type = "earrings"
        tags.update(["jewellery", "jewelry", "accessory", "wearable"])
    elif any(k in blob for k in apparel_keys):
        domain = "apparel"
        audience = "unisex"
        if "tee" in blob or "t-shirt" in blob:
            product_type = "t-shirt"
        tags.update(["apparel", "clothing", "wearable"])
    elif any(k in blob for k in skincare_keys):
        domain = "skincare"
        audience = "all"
        tags.update(["skincare", "beauty"])

    if category:
        tags.add(category.lower())
    for token in re.findall(r"[a-z0-9]+", blob):
        if len(token) > 2:
            tags.add(token)

    tags.add(domain)
    if audience != "all":
        tags.add(audience)

    # Map domain → store category label
    category_label = {
        "jewellery": "Handicrafts",
        "apparel": "Apparel",
        "skincare": "Skincare",
        "handicrafts": "Handicrafts",
        "home": "Handicrafts",
    }.get(domain, category or "Handicrafts")

    return {
        "domain": domain,
        "audience": audience,
        "product_type": product_type,
        "category_label": category_label,
        "tags": sorted(tags)[:24],
    }


def generate_product_tags(
    *,
    sku: str,
    name: str,
    category: str = "",
    description: str = "",
    image_path: Optional[Path] = None,
) -> dict[str, Any]:
    """Vision-tag a product; returns tags + domain + audience + category_label."""
    path = image_path or (PRODUCT_IMAGES_DIR / f"{sku}.jpg")
    encoded = _encode_image(path) if path else None
    fallback = heuristic_meta(name=name, category=category, description=description)

    api_key = os.getenv("OPENAI_API_KEY")
    if api_key and encoded:
        mime, b64 = encoded
        try:
            from openai import OpenAI

            client = OpenAI(api_key=api_key)
            model = os.getenv("OPENAI_VISION_MODEL") or os.getenv("OPENAI_MODEL", "gpt-4o-mini")
            if model.startswith("openai/"):
                model = model.split("/", 1)[1]
            prompt = TAG_PROMPT.format(
                name=name or sku,
                category=category or "unknown",
                description=(description or "")[:240],
            )
            resp = client.chat.completions.create(
                model=model,
                temperature=0.1,
                max_tokens=500,
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": prompt},
                            {
                                "type": "image_url",
                                "image_url": {"url": f"data:{mime};base64,{b64}", "detail": "low"},
                            },
                        ],
                    }
                ],
            )
            content = (resp.choices[0].message.content or "").strip()
            parsed = _parse_tag_payload(content)
            domain = str(parsed.get("domain") or fallback["domain"]).lower().strip()
            if domain in ("jewelry", "jewelery"):
                domain = "jewellery"
            audience = str(parsed.get("audience") or fallback["audience"]).lower().strip()
            product_type = str(parsed.get("product_type") or fallback["product_type"]).lower().strip()
            tags = set(parsed.get("tags") or [])
            tags.add(domain)
            if audience not in ("all", ""):
                tags.add(audience)
            if product_type:
                tags.add(product_type.replace(" ", "-"))
            category_label = {
                "jewellery": "Handicrafts",
                "apparel": "Apparel",
                "skincare": "Skincare",
                "handicrafts": "Handicrafts",
                "home": "Handicrafts",
            }.get(domain, category or "Handicrafts")
            # Prefer apparel/skincare store category when domain is clear
            if domain == "apparel":
                category_label = "Apparel"
            elif domain == "skincare":
                category_label = "Skincare"
            return {
                "domain": domain,
                "audience": audience or "all",
                "product_type": product_type,
                "category_label": category_label,
                "tags": sorted(tags)[:24],
            }
        except Exception as e:
            logger.warning("Vision tagging failed for %s: %s", sku, e)

    return fallback


def ensure_tags(row: dict[str, Any], *, force: bool = False) -> dict[str, Any]:
    """Return meta dict with tags/domain/audience; reuse existing tags unless force."""
    existing_tags = row.get("tags")
    if (
        not force
        and isinstance(existing_tags, list)
        and existing_tags
        and row.get("domain")
        and row.get("audience")
    ):
        return {
            "tags": [str(t).lower() for t in existing_tags],
            "domain": row.get("domain"),
            "audience": row.get("audience"),
            "product_type": row.get("product_type") or "",
            "category_label": row.get("category") or "",
        }
    return generate_product_tags(
        sku=str(row.get("sku") or ""),
        name=str(row.get("name") or ""),
        category=str(row.get("category") or ""),
        description=str(row.get("description") or row.get("category_notes") or ""),
    )


# Back-compat for callers expecting a list
def heuristic_tags(*, name: str, category: str = "", description: str = "") -> list[str]:
    return list(heuristic_meta(name=name, category=category, description=description)["tags"])
