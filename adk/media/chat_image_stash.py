"""Stash chat-uploaded images by session so the LLM never sees huge base64 blobs."""

from __future__ import annotations

from paths import ENV_FILE, DATA_DIR, STATIC_DIR, PRODUCT_IMAGES_DIR, PENDING_CHAT_IMAGES_DIR, FAKE_KB_PATH, SELLER_PRODUCTS_JSON, INVENTORY_VISIBILITY_JSON, STORES_JSON, STORE_QUERIES_DIR, PRODUCT_IMAGES_JSON, BOUTIQUE_PRODUCT_IMAGES_JSON

import base64
import json
import re
from pathlib import Path
from typing import Any, Optional

# ADK_DIR via paths
PENDING_DIR = PENDING_CHAT_IMAGES_DIR
PENDING_DIR.mkdir(parents=True, exist_ok=True)


def _safe_session(session_id: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_\-]", "_", session_id or "anon")[:120]


def save_pending_chat_image(session_id: str, image_base64: str) -> Optional[Path]:
    if not session_id or not image_base64:
        return None
    raw = re.sub(r"^data:image/[^;]+;base64,", "", str(image_base64).strip())
    try:
        data = base64.b64decode(raw)
    except Exception:
        return None
    if len(data) < 32:
        return None
    path = PENDING_DIR / f"{_safe_session(session_id)}.jpg"
    path.write_bytes(data)
    return path


def load_pending_chat_image_b64(session_id: str) -> Optional[str]:
    path = PENDING_DIR / f"{_safe_session(session_id)}.jpg"
    if not path.exists():
        return None
    try:
        return base64.b64encode(path.read_bytes()).decode("ascii")
    except Exception:
        return None


def consume_pending_chat_image_b64(session_id: str) -> Optional[str]:
    """Read pending image and delete the file (one-shot attach to a listing)."""
    path = PENDING_DIR / f"{_safe_session(session_id)}.jpg"
    if not path.exists():
        return None
    try:
        b64 = base64.b64encode(path.read_bytes()).decode("ascii")
        path.unlink(missing_ok=True)
        return b64
    except Exception:
        return None


def clear_pending_chat_image(session_id: str) -> None:
    path = PENDING_DIR / f"{_safe_session(session_id)}.jpg"
    path.unlink(missing_ok=True)
    vision_path = PENDING_DIR / f"{_safe_session(session_id)}.vision.json"
    vision_path.unlink(missing_ok=True)


def save_pending_vision_analysis(session_id: str, data: dict[str, Any]) -> None:
    if not session_id or not data:
        return
    path = PENDING_DIR / f"{_safe_session(session_id)}.vision.json"
    try:
        path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    except Exception:
        pass


def load_pending_vision_analysis(session_id: str) -> Optional[dict[str, Any]]:
    path = PENDING_DIR / f"{_safe_session(session_id)}.vision.json"
    if not path.exists():
        return None
    try:
        parsed = json.loads(path.read_text(encoding="utf-8"))
        return parsed if isinstance(parsed, dict) else None
    except Exception:
        return None
