"""Postgres-backed chat session memory — survives server restarts.

Stores conversation messages plus cart / active-product state
(formerly MongoDB `shopassist_marketplace_db.chat_sessions`).

Reads the same DATABASE_URL as ADK (postgresql+asyncpg://) and normalizes it
to a sync SQLAlchemy driver so the public APIs can stay synchronous for
main.py / session_commerce.py callers.
"""

from __future__ import annotations

from paths import ENV_FILE, DATA_DIR, STATIC_DIR, PRODUCT_IMAGES_DIR, PENDING_CHAT_IMAGES_DIR, FAKE_KB_PATH, SELLER_PRODUCTS_JSON, INVENTORY_VISIBILITY_JSON, STORES_JSON, STORE_QUERIES_DIR, PRODUCT_IMAGES_JSON, BOUTIQUE_PRODUCT_IMAGES_JSON

import os
from collections.abc import MutableMapping
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from dotenv import load_dotenv
from sqlalchemy import DateTime, ForeignKey, Integer, MetaData, String, Text, create_engine, delete, select
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, relationship, sessionmaker

try:
    from commerce.tile_validator import strip_agent_markup
except ImportError:
    from commerce.tile_validator import strip_agent_markup

load_dotenv(ENV_FILE)

MAX_STORED_MESSAGES = 50
MAX_LLM_TURNS = 20


def _sync_db_url(db_url: str) -> str:
    """ADK needs postgresql+asyncpg://; sync SQLAlchemy uses psycopg (v3)."""
    if db_url.startswith("postgresql+asyncpg://"):
        return "postgresql+psycopg://" + db_url.removeprefix("postgresql+asyncpg://")
    if db_url.startswith("postgresql://"):
        return "postgresql+psycopg://" + db_url.removeprefix("postgresql://")
    return db_url


def _require_database_url() -> str:
    db_url = os.getenv("DATABASE_URL", "").strip()
    if not db_url:
        raise RuntimeError(
            "DATABASE_URL is not set. Copy adk/.env.example and set "
            "DATABASE_URL=postgresql+asyncpg://..."
        )
    return db_url


_engine = create_engine(_sync_db_url(_require_database_url()), pool_pre_ping=True)
SessionLocal = sessionmaker(bind=_engine, expire_on_commit=False)
_metadata = MetaData()


class Base(DeclarativeBase):
    metadata = _metadata


class ChatSession(Base):
    __tablename__ = "chat_sessions"

    session_id: Mapped[str] = mapped_column(String(255), primary_key=True)
    cart: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    active_product_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )
    messages: Mapped[list["SessionMessage"]] = relationship(
        "SessionMessage",
        back_populates="session",
        cascade="all, delete-orphan",
        order_by="SessionMessage.id",
    )


class SessionMessage(Base):
    __tablename__ = "session_messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[str] = mapped_column(
        String(255),
        ForeignKey("chat_sessions.session_id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    role: Mapped[str] = mapped_column(String(32), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )

    session: Mapped[ChatSession] = relationship("ChatSession", back_populates="messages")


Base.metadata.create_all(_engine)


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


def _msg_to_dict(row: SessionMessage) -> dict:
    return {
        "role": row.role,
        "content": row.content,
        "ts": row.created_at.isoformat() if row.created_at else _utcnow().isoformat(),
    }


def _ensure_session_row(db: Session, session_id: str) -> ChatSession:
    row = db.get(ChatSession, session_id)
    if row is None:
        row = ChatSession(
            session_id=session_id, cart=[], active_product_id=None, updated_at=_utcnow()
        )
        db.add(row)
        db.flush()
    return row


def load_session(session_id: str) -> dict:
    if not session_id:
        return _empty_doc("")
    with SessionLocal() as db:
        row = db.get(ChatSession, session_id)
        if not row:
            return _empty_doc(session_id)
        messages = [
            _msg_to_dict(m)
            for m in db.scalars(
                select(SessionMessage)
                .where(SessionMessage.session_id == session_id)
                .order_by(SessionMessage.id.asc())
            ).all()
        ]
        cart = row.cart if isinstance(row.cart, list) else []
        return {
            "session_id": session_id,
            "messages": messages,
            "cart": cart,
            "active_product_id": row.active_product_id,
            "updated_at": row.updated_at or _utcnow(),
        }


def save_session(session_id: str, doc: dict) -> None:
    if not session_id:
        return
    messages = list(doc.get("messages", []))[-MAX_STORED_MESSAGES:]
    cart = doc.get("cart", []) or []
    active_product_id = doc.get("active_product_id")
    with SessionLocal() as db:
        row = _ensure_session_row(db, session_id)
        row.cart = cart
        row.active_product_id = active_product_id
        row.updated_at = _utcnow()
        db.execute(delete(SessionMessage).where(SessionMessage.session_id == session_id))
        for msg in messages:
            ts = msg.get("ts")
            created_at = _utcnow()
            if isinstance(ts, str):
                try:
                    created_at = datetime.fromisoformat(ts)
                except ValueError:
                    pass
            elif isinstance(ts, datetime):
                created_at = ts
            db.add(
                SessionMessage(
                    session_id=session_id,
                    role=str(msg.get("role", "user")),
                    content=str(msg.get("content", "")),
                    created_at=created_at,
                )
            )
        db.commit()


def delete_session(session_id: str) -> None:
    if not session_id:
        return
    with SessionLocal() as db:
        row = db.get(ChatSession, session_id)
        if row:
            db.delete(row)
            db.commit()


def load_messages(session_id: str) -> list[dict]:
    return list(load_session(session_id).get("messages", []))


def append_message(session_id: str, role: str, content: str) -> list[dict]:
    if not session_id or not content:
        return []
    with SessionLocal() as db:
        _ensure_session_row(db, session_id)
        db.add(
            SessionMessage(
                session_id=session_id,
                role=role,
                content=content,
                created_at=_utcnow(),
            )
        )
        db.flush()
        ids = list(
            db.scalars(
                select(SessionMessage.id)
                .where(SessionMessage.session_id == session_id)
                .order_by(SessionMessage.id.asc())
            ).all()
        )
        if len(ids) > MAX_STORED_MESSAGES:
            overflow = ids[: len(ids) - MAX_STORED_MESSAGES]
            db.execute(delete(SessionMessage).where(SessionMessage.id.in_(overflow)))
        row = db.get(ChatSession, session_id)
        if row:
            row.updated_at = _utcnow()
        db.commit()
        return [
            _msg_to_dict(m)
            for m in db.scalars(
                select(SessionMessage)
                .where(SessionMessage.session_id == session_id)
                .order_by(SessionMessage.id.asc())
            ).all()
        ]


def save_cart(session_id: str, cart: list[dict]) -> None:
    if not session_id:
        return
    with SessionLocal() as db:
        row = _ensure_session_row(db, session_id)
        row.cart = cart
        row.updated_at = _utcnow()
        db.commit()


def save_active_product_id(session_id: str, product_id: Optional[str]) -> None:
    if not session_id:
        return
    with SessionLocal() as db:
        row = _ensure_session_row(db, session_id)
        row.active_product_id = product_id
        row.updated_at = _utcnow()
        db.commit()


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
    Dict-like `{session_id: [messages]}` backed by Postgres.
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
        from commerce.session_commerce import session_cart, session_active_product
        from commerce.tile_validator import product_to_tile, find_catalog_product
    except ImportError:
        from commerce.session_commerce import session_cart, session_active_product
        from commerce.tile_validator import product_to_tile, find_catalog_product

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
        from commerce.session_commerce import get_cart, session_active_product
    except ImportError:
        from commerce.session_commerce import get_cart, session_active_product

    cart = get_cart(session_id)
    doc = load_session(session_id)
    doc["cart"] = cart
    active = session_active_product.get(session_id)
    doc["active_product_id"] = str(active.get("id", "")) if active else None
    save_session(session_id, doc)
