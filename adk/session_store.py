"""MongoDB-backed chat session memory — survives server restarts."""

from __future__ import annotations

from collections.abc import MutableMapping
from datetime import datetime, timezone
from typing import Any, Optional

from pymongo import MongoClient

try:
    from .tile_validator import strip_agent_markup
except ImportError:
    from tile_validator import strip_agent_markup

client = MongoClient("mongodb://127.0.0.1:27017/?directConnection=true")
_db = client.adidas_marketplace_db
_sessions = _db.chat_sessions
try:
    _sessions.create_index("session_id", unique=True)
except Exception:
    pass

MAX_STORED_MESSAGES = 50
MAX_LLM_TURNS = 20


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _empty_doc(session_id: str) -> dict:
    return {
        "session_id": session_id,
        "messages": [],
        "cart": [],
        "active_product_id": None,
        "updated_at": _utcnow(),
    }


def load_session(session_id: str) -> dict:
    if not session_id:
        return _empty_doc("")
    doc = _sessions.find_one({"session_id": session_id})
    if not doc:
        return _empty_doc(session_id)
    doc.pop("_id", None)
    return doc


def save_session(session_id: str, doc: dict) -> None:
    if not session_id:
        return
    payload = {
        "session_id": session_id,
        "messages": doc.get("messages", [])[-MAX_STORED_MESSAGES:],
        "cart": doc.get("cart", []),
        "active_product_id": doc.get("active_product_id"),
        "updated_at": _utcnow(),
    }
    _sessions.update_one({"session_id": session_id}, {"$set": payload}, upsert=True)


def delete_session(session_id: str) -> None:
    if session_id:
        _sessions.delete_one({"session_id": session_id})


def load_messages(session_id: str) -> list[dict]:
    return list(load_session(session_id).get("messages", []))


def append_message(session_id: str, role: str, content: str) -> list[dict]:
    if not session_id or not content:
        return []
    doc = load_session(session_id)
    messages = doc.setdefault("messages", [])
    messages.append({"role": role, "content": content, "ts": _utcnow().isoformat()})
    if len(messages) > MAX_STORED_MESSAGES:
        doc["messages"] = messages[-MAX_STORED_MESSAGES:]
    save_session(session_id, doc)
    return doc["messages"]


def save_cart(session_id: str, cart: list[dict]) -> None:
    if not session_id:
        return
    doc = load_session(session_id)
    doc["cart"] = cart
    save_session(session_id, doc)


def save_active_product_id(session_id: str, product_id: Optional[str]) -> None:
    if not session_id:
        return
    doc = load_session(session_id)
    doc["active_product_id"] = product_id
    save_session(session_id, doc)


def build_llm_history_block(session_id: str, current_query: str) -> str:
    """ChatGPT-style alternating turns for the LLM (excludes current query)."""
    messages = load_messages(session_id)
    if not messages:
        return ""

    recent = messages[-(MAX_LLM_TURNS * 2) :]
    lines: list[str] = []
    for msg in recent:
        role = "User" if msg.get("role") == "user" else "Assistant"
        content = msg.get("content", "")
        if msg.get("role") == "assistant":
            content = strip_agent_markup(content)
        content = " ".join(str(content).split())
        if content:
            lines.append(f"{role}: {content}")

    if not lines:
        return ""
    return "Conversation so far:\n" + "\n".join(lines) + f"\n\nUser: {current_query}"


class SessionHistory(MutableMapping):
    """
    Dict-like `{session_id: [messages]}` backed by MongoDB.
    Drop-in replacement for the old in-memory `conversation_history` dict.
    """

    def __init__(self) -> None:
        self._cache: dict[str, list[dict]] = {}

    def _hydrate(self, session_id: str) -> list[dict]:
        if session_id not in self._cache:
            self._cache[session_id] = load_messages(session_id)
        return self._cache[session_id]

    def __getitem__(self, session_id: str) -> list[dict]:
        return self._hydrate(session_id)

    def __setitem__(self, session_id: str, value: list[dict]) -> None:
        self._cache[session_id] = value
        doc = load_session(session_id)
        doc["messages"] = value[-MAX_STORED_MESSAGES:]
        save_session(session_id, doc)

    def __delitem__(self, session_id: str) -> None:
        self._cache.pop(session_id, None)
        delete_session(session_id)

    def __iter__(self):
        return iter(self._cache)

    def __len__(self) -> int:
        return len(self._cache)

    def get(self, session_id: str, default: Any = None) -> Any:
        if not session_id:
            return default if default is not None else []
        if session_id in self._cache:
            return self._cache[session_id]
        msgs = load_messages(session_id)
        if msgs:
            self._cache[session_id] = msgs
            return msgs
        return default if default is not None else []

    def pop(self, session_id: str, *args):  # type: ignore[no-untyped-def]
        default = args[0] if args else None
        if not session_id:
            if args:
                return default
            raise KeyError(session_id)
        old = self.get(session_id, default if args else [])
        self._cache.pop(session_id, None)
        delete_session(session_id)
        if session_id or args:
            return old
        raise KeyError(session_id)

    def __contains__(self, session_id: object) -> bool:
        if not isinstance(session_id, str) or not session_id:
            return False
        if session_id in self._cache:
            return bool(self._cache[session_id])
        return bool(load_messages(session_id))

    def invalidate(self, session_id: str) -> None:
        self._cache.pop(session_id, None)


def hydrate_session_state(session_id: str) -> None:
    """Restore cart + active product into in-memory commerce dicts."""
    if not session_id:
        return
    doc = load_session(session_id)
    try:
        from .session_commerce import session_cart, session_active_product, get_product_by_id
        from .tile_validator import product_to_tile, find_catalog_product
    except ImportError:
        from session_commerce import session_cart, session_active_product
        from tile_validator import product_to_tile, find_catalog_product

    cart = doc.get("cart") or []
    if cart:
        session_cart[session_id] = list(cart)

    pid = doc.get("active_product_id")
    if pid:
        product = find_catalog_product(str(pid))
        if product:
            session_active_product[session_id] = product_to_tile(product)


def persist_cart_from_memory(session_id: str) -> None:
    try:
        from .session_commerce import get_cart, session_active_product
    except ImportError:
        from session_commerce import get_cart, session_active_product

    cart = get_cart(session_id)
    doc = load_session(session_id)
    doc["cart"] = cart
    active = session_active_product.get(session_id)
    doc["active_product_id"] = str(active.get("id", "")) if active else None
    save_session(session_id, doc)
